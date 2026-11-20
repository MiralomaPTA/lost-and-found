"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { changeTagsAction, undoAddAction } from "@/app/actions/items";
import { uploadItem } from "@/lib/upload";

/**
 * Bulk add's uploads (spec: *Saving doesn't wait*). Each saved photo joins a
 * queue and uploads in the background, one at a time and in order, while the
 * person carries on. The strip shows each one's progress; a failed one waits
 * for *Retry*. Tags can still change, and *Undo* still works, at any point.
 */

export interface QueueTags {
  type: string;
  color: string;
  hasName: boolean;
}

export type QueueState = "waiting" | "uploading" | "saved" | "failed" | "undone";

export interface QueueEntry {
  key: string;
  clientRef: string;
  /** An object URL of the thumbnail, for the strip. */
  preview: string;
  tags: QueueTags;
  state: QueueState;
  progress: number;
  itemId: string | null;
  message: string | null;
}

interface Pending {
  photo: Blob;
  thumb: Blob;
  /** Undo was tapped while it was uploading: take it back off the list once it's saved. */
  undoWhenSaved: boolean;
}

const sameTags = (a: QueueTags, b: QueueTags) => a.type === b.type && a.color === b.color && a.hasName === b.hasName;

export function useUploadQueue() {
  const [entries, setEntries] = useState<QueueEntry[]>([]);
  const latest = useRef(entries);
  const blobs = useRef(new Map<string, Pending>());
  const running = useRef(false);

  const update = useCallback((key: string, change: Partial<QueueEntry>) => {
    setEntries((all) => {
      const next = all.map((entry) => (entry.key === key ? { ...entry, ...change } : entry));
      latest.current = next;
      return next;
    });
  }, []);

  const finishUndo = useCallback(
    async (entry: QueueEntry, itemId: string) => {
      const result = await undoAddAction(itemId).catch(() => ({ ok: false as const, message: "Couldn't reach the lost and found to undo. Try again." }));
      update(entry.key, result.ok ? { state: "undone", message: null } : { message: result.message });
    },
    [update],
  );

  const run = useCallback(
    async (entry: QueueEntry) => {
      const pending = blobs.current.get(entry.key);
      if (!pending) return;
      const sent = entry.tags;
      update(entry.key, { state: "uploading", progress: 0, message: null });
      const result = await uploadItem({ photo: pending.photo, thumb: pending.thumb, ...sent, clientRef: entry.clientRef }, (progress) =>
        update(entry.key, { progress }),
      );
      if (!result.ok) {
        update(entry.key, { state: "failed", message: result.message });
        return;
      }
      blobs.current.delete(entry.key);
      update(entry.key, { state: "saved", progress: 1, itemId: result.id });
      const now = latest.current.find((e) => e.key === entry.key);
      if (pending.undoWhenSaved) {
        await finishUndo(entry, result.id);
      } else if (now && !sameTags(now.tags, sent)) {
        // The tags changed while it was uploading.
        const fixed = await changeTagsAction(result.id, { type: now.tags.type, color: now.tags.color, has_name: now.tags.hasName }).catch(() => null);
        if (!fixed?.ok) update(entry.key, { message: fixed?.message ?? "Couldn't save the new tags. Tap to try again." });
      }
    },
    [update, finishUndo],
  );

  // One upload at a time, in the order they were taken.
  useEffect(() => {
    if (running.current) return;
    const next = entries.find((entry) => entry.state === "waiting");
    if (!next || entries.some((entry) => entry.state === "uploading")) return;
    running.current = true;
    void run(next).finally(() => {
      running.current = false;
      // Kick the effect again for the next one.
      setEntries((all) => [...all]);
    });
  }, [entries, run]);

  const unsaved = entries.some((entry) => entry.state === "waiting" || entry.state === "uploading" || entry.state === "failed");

  // Closing the page now would lose photos that haven't reached the server.
  useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);

  // Free the previews when the page goes.
  useEffect(() => () => latest.current.forEach((entry) => URL.revokeObjectURL(entry.preview)), []);

  const add = useCallback((images: { photo: Blob; thumb: Blob }, tags: QueueTags, clientRef: string) => {
    const key = clientRef;
    blobs.current.set(key, { ...images, undoWhenSaved: false });
    const entry: QueueEntry = { key, clientRef, preview: URL.createObjectURL(images.thumb), tags, state: "waiting", progress: 0, itemId: null, message: null };
    setEntries((all) => {
      const next = [...all, entry];
      latest.current = next;
      return next;
    });
  }, []);

  const retry = useCallback((key: string) => update(key, { state: "waiting", message: null }), [update]);

  const setTags = useCallback(
    async (key: string, tags: QueueTags) => {
      const entry = latest.current.find((e) => e.key === key);
      if (!entry || entry.state === "undone") return;
      update(key, { tags, message: null });
      // Not saved yet: the upload (or the fix after it) sends the new tags.
      if (entry.state !== "saved" || !entry.itemId) return;
      const result = await changeTagsAction(entry.itemId, { type: tags.type, color: tags.color, has_name: tags.hasName }).catch(() => null);
      if (!result?.ok) update(key, { tags: entry.tags, message: result?.message ?? "Couldn't save the new tags. Try again." });
    },
    [update],
  );

  const undo = useCallback(
    async (key: string) => {
      const entry = latest.current.find((e) => e.key === key);
      if (!entry) return;
      const pending = blobs.current.get(key);
      if (entry.state === "waiting" || entry.state === "failed") {
        // Never reached the list: just drop it.
        blobs.current.delete(key);
        update(key, { state: "undone", message: null });
      } else if (entry.state === "uploading" && pending) {
        pending.undoWhenSaved = true;
        update(key, { message: "Taking it back off once it's saved…" });
      } else if (entry.state === "saved" && entry.itemId) {
        await finishUndo(entry, entry.itemId);
      }
    },
    [update, finishUndo],
  );

  return { entries, add, retry, setTags, undo, unsaved };
}
