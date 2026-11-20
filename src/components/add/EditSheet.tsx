"use client";

import { useEffect, useRef, useState } from "react";
import { TagPicker, type ColorChoice } from "@/components/add/TagPicker";
import type { QueueEntry, QueueTags } from "@/components/add/useUploadQueue";

/**
 * Bulk add's strip, tapped (spec: *Fixing a mistake*): change an item's
 * tags, retry a failed upload, or *Undo* to take it back off the list.
 */
export function EditSheet({
  entry,
  types,
  colors,
  onClose,
  onSave,
  onRetry,
  onUndo,
}: {
  entry: QueueEntry | null;
  types: string[];
  colors: ColorChoice[];
  onClose: () => void;
  onSave: (tags: QueueTags) => void;
  onRetry: () => void;
  onUndo: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [tags, setTags] = useState<QueueTags | null>(null);
  const key = entry?.key ?? null;

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (key && !element.open) element.showModal();
    else if (!key && element.open) element.close();
  }, [key]);

  // Start from the entry's tags each time the sheet opens for it.
  const [openFor, setOpenFor] = useState<string | null>(null);
  if (entry && openFor !== entry.key) {
    setOpenFor(entry.key);
    setTags(entry.tags);
  }
  if (!entry && openFor !== null) setOpenFor(null);

  const changed = entry && tags && (tags.type !== entry.tags.type || tags.color !== entry.tags.color || tags.hasName !== entry.tags.hasName);

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      aria-labelledby="edit-sheet-title"
      className="m-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-y-auto rounded-t-[20px] bg-white p-0 text-ink backdrop:bg-black/60 sm:m-auto sm:max-w-md sm:rounded-[20px]"
    >
      {entry && tags && (
        <div className="flex flex-col gap-4 px-4 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <div className="flex items-center gap-3">
            <span className="h-16 w-16 flex-none overflow-hidden rounded-[10px] bg-tile">
              {/* eslint-disable-next-line @next/next/no-img-element -- a local preview of the thumbnail */}
              <img src={entry.preview} alt="" className="h-full w-full object-contain" />
            </span>
            <div className="flex min-w-0 flex-col gap-0.5">
              <h2 id="edit-sheet-title" className="text-lg font-extrabold">
                {entry.tags.type} · {entry.tags.color}
              </h2>
              <span className="text-[13px] text-muted">
                {entry.state === "saved" ? "On the grid" : entry.state === "failed" ? "Didn't upload" : "Uploading…"}
              </span>
            </div>
          </div>
          {entry.message && (
            <p role="alert" className="notice bg-warn-soft text-warn">
              {entry.message}
            </p>
          )}
          <TagPicker
            types={types}
            colors={colors}
            type={tags.type}
            color={tags.color}
            hasName={tags.hasName}
            onType={(type) => setTags({ ...tags, type })}
            onColor={(color) => setTags({ ...tags, color })}
            onHasName={(hasName) => setTags({ ...tags, hasName })}
          />
          <div className="flex flex-col gap-2">
            {entry.state === "failed" && (
              <button type="button" className="btn-primary" onClick={onRetry}>
                Retry the upload
              </button>
            )}
            <button
              type="button"
              className={entry.state === "failed" ? "btn-secondary" : "btn-primary"}
              aria-disabled={!changed}
              onClick={() => {
                if (!changed) return;
                onSave(tags);
                onClose();
              }}
            >
              Save tags
            </button>
            <button type="button" className="btn-secondary text-bad hover:text-bad" onClick={onUndo}>
              Undo: take it off the list
            </button>
            <button type="button" className="h-11 cursor-pointer text-[15px] font-bold text-brand" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
