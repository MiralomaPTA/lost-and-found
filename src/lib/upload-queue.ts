import type { ItemUpload, UploadResult } from "@/lib/upload";

/**
 * Bulk add's uploads (spec: *Saving doesn't wait*). Each saved photo joins
 * the queue and uploads in the background, one at a time and in order,
 * while the person carries on. Tags can still change, and *Undo* still
 * works, at any point.
 *
 * It lives outside React, for the whole visit, so uploads carry on when the
 * person leaves bulk add (by *Done*, the back button or the bottom bar) and
 * are still in the strip when they come back. React reads it through
 * subscribe/getSnapshot. Its effects arrive through `QueueDeps`, so it can
 * be tested without a browser or a server.
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
  /** A URL of the thumbnail, for the strip. */
  preview: string;
  tags: QueueTags;
  state: QueueState;
  progress: number;
  itemId: string | null;
  message: string | null;
  /** For a failed upload: whether trying again could help (not if the server refused it as it is). */
  retryable: boolean;
}

export type ChangeAnswer = { ok: true } | { ok: false; message: string };

export interface QueueDeps {
  upload(input: ItemUpload, onProgress: (fraction: number) => void): Promise<UploadResult>;
  changeTags(itemId: string, tags: { type: string; color: string; has_name: boolean }): Promise<ChangeAnswer>;
  undoAdd(itemId: string): Promise<ChangeAnswer>;
  /** Takes back whatever item an upload made, by its reference, if it made one. */
  undoUpload(clientRef: string): Promise<ChangeAnswer>;
  preview(thumb: Blob): string;
  release(preview: string): void;
}

interface Pending {
  photo: Blob;
  thumb: Blob;
  /** *Undo* was tapped while it was uploading. */
  undoWhenDone: boolean;
}

const OFFLINE = "Couldn't reach the lost and found. Try again.";
const sameTags = (a: QueueTags, b: QueueTags) => a.type === b.type && a.color === b.color && a.hasName === b.hasName;
const serverTags = (tags: QueueTags) => ({ type: tags.type, color: tags.color, has_name: tags.hasName });

export class UploadQueue {
  private entries: QueueEntry[] = [];
  private pending = new Map<string, Pending>();
  private listeners = new Set<() => void>();
  private running = false;

  constructor(private deps: QueueDeps) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): readonly QueueEntry[] => this.entries;

  /** Photos that haven't reached the server: waiting, uploading, or failed. */
  get unsaved(): boolean {
    return this.entries.some((entry) => entry.state === "waiting" || entry.state === "uploading" || entry.state === "failed");
  }

  /**
   * Bulk add opened again. The strip shows what's been saved since it was
   * opened, so items settled on an earlier visit leave it (and with them the
   * adder's *Undo*, as the spec has it); any still uploading or failed stay.
   */
  startSession(): void {
    const settled = this.entries.filter((entry) => entry.state === "saved" || entry.state === "undone");
    if (!settled.length) return;
    settled.forEach((entry) => this.deps.release(entry.preview));
    this.entries = this.entries.filter((entry) => !settled.includes(entry));
    this.emit();
  }

  add(images: { photo: Blob; thumb: Blob }, tags: QueueTags, clientRef: string): void {
    this.pending.set(clientRef, { ...images, undoWhenDone: false });
    const entry: QueueEntry = {
      key: clientRef,
      clientRef,
      preview: this.deps.preview(images.thumb),
      tags,
      state: "waiting",
      progress: 0,
      itemId: null,
      message: null,
      retryable: true,
    };
    this.entries = [...this.entries, entry];
    this.emit();
    void this.pump();
  }

  retry(key: string): void {
    const entry = this.find(key);
    if (entry?.state !== "failed" || !entry.retryable) return;
    this.update(key, { state: "waiting", message: null });
    void this.pump();
  }

  async setTags(key: string, tags: QueueTags): Promise<void> {
    const entry = this.find(key);
    if (!entry || entry.state === "undone") return;
    this.update(key, { tags, message: null });
    // Not saved yet: the upload (or a retry, which the server applies to the item it made) sends the new tags.
    if (entry.state !== "saved" || !entry.itemId) return;
    const answer = await this.deps.changeTags(entry.itemId, serverTags(tags)).catch(() => ({ ok: false as const, message: OFFLINE }));
    // Back to what the server has, so the sheet can send the change again.
    if (!answer.ok) this.update(key, { tags: entry.tags, message: `The new tags weren't saved. ${answer.message}` });
  }

  async undo(key: string): Promise<void> {
    const entry = this.find(key);
    if (!entry) return;
    const pending = this.pending.get(key);
    if (entry.state === "waiting") {
      // Never sent: just drop it.
      this.drop(key, { state: "undone", message: null });
    } else if (entry.state === "uploading" && pending) {
      pending.undoWhenDone = true;
      this.update(key, { message: "Taking it back off the list once the upload finishes…" });
    } else if (entry.state === "failed") {
      // The server may have saved it even though the answer never came.
      await this.undoByRef(entry);
    } else if (entry.state === "saved" && entry.itemId) {
      const answer = await this.deps.undoAdd(entry.itemId).catch(() => ({ ok: false as const, message: OFFLINE }));
      this.update(key, answer.ok ? { state: "undone", message: null } : { message: answer.message });
    }
  }

  /** For tests: resolves once nothing is waiting or uploading. */
  async idle(): Promise<void> {
    while (this.running || this.entries.some((entry) => entry.state === "waiting")) await new Promise((resolve) => setTimeout(resolve, 1));
  }

  private async undoByRef(entry: QueueEntry): Promise<void> {
    const answer = await this.deps.undoUpload(entry.clientRef).catch(() => ({ ok: false as const, message: OFFLINE }));
    if (answer.ok) this.drop(entry.key, { state: "undone", message: null });
    else this.update(entry.key, { state: "failed", retryable: false, message: `Couldn't undo it. ${answer.message}` });
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    const next = this.entries.find((entry) => entry.state === "waiting");
    if (!next) return;
    this.running = true;
    try {
      await this.run(next.key);
    } finally {
      this.running = false;
    }
    void this.pump();
  }

  private async run(key: string): Promise<void> {
    const entry = this.find(key);
    const pending = this.pending.get(key);
    if (!entry || !pending) return;
    const sent = entry.tags;
    this.update(key, { state: "uploading", progress: 0, message: null });
    const result = await this.deps
      .upload({ photo: pending.photo, thumb: pending.thumb, ...sent, clientRef: entry.clientRef }, (progress) => this.update(key, { progress }))
      .catch(() => ({ ok: false as const, message: OFFLINE, retry: true }));
    if (!result.ok) {
      if (pending.undoWhenDone) await this.undoByRef(this.find(key)!);
      else this.update(key, { state: "failed", message: result.message, retryable: result.retry });
      return;
    }
    this.pending.delete(key);
    this.update(key, { state: "saved", progress: 1, itemId: result.id });
    if (pending.undoWhenDone) {
      const answer = await this.deps.undoAdd(result.id).catch(() => ({ ok: false as const, message: OFFLINE }));
      this.update(key, answer.ok ? { state: "undone", message: null } : { message: answer.message });
      return;
    }
    const now = this.find(key);
    if (now && !sameTags(now.tags, sent)) {
      // The tags changed while it was uploading.
      const answer = await this.deps.changeTags(result.id, serverTags(now.tags)).catch(() => ({ ok: false as const, message: OFFLINE }));
      if (!answer.ok) this.update(key, { tags: sent, message: `The new tags weren't saved. ${answer.message}` });
    }
  }

  private find(key: string): QueueEntry | undefined {
    return this.entries.find((entry) => entry.key === key);
  }

  private update(key: string, change: Partial<QueueEntry>): void {
    this.entries = this.entries.map((entry) => (entry.key === key ? { ...entry, ...change } : entry));
    this.emit();
  }

  /** Done with an entry's photos. */
  private drop(key: string, change: Partial<QueueEntry>): void {
    this.pending.delete(key);
    this.update(key, change);
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener());
  }
}
