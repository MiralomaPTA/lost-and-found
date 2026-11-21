"use client";

import { useSyncExternalStore } from "react";
import { changeTagsAction, undoAddAction, undoUploadAction } from "@/app/actions/items";
import { uploadItem } from "@/lib/upload";
import { UploadQueue, type QueueEntry } from "@/lib/upload-queue";

/*
 * The one upload queue for this visit to the site (see UploadQueue). It
 * outlives the bulk add screen, so leaving it doesn't drop photos still on
 * their way; closing or reloading the page while any haven't reached the
 * server asks first.
 */

let queue: UploadQueue | null = null;
const NONE: readonly QueueEntry[] = [];

export function uploadQueue(): UploadQueue {
  if (queue) return queue;
  const created = new UploadQueue({
    upload: uploadItem,
    changeTags: changeTagsAction,
    undoAdd: undoAddAction,
    undoUpload: undoUploadAction,
    preview: (thumb) => URL.createObjectURL(thumb),
    release: (preview) => URL.revokeObjectURL(preview),
  });
  const warn = (event: BeforeUnloadEvent) => {
    event.preventDefault();
    event.returnValue = "";
  };
  let guarding = false;
  // Only while needed: a beforeunload listener stops some browsers keeping the page for the back button.
  created.subscribe(() => {
    if (created.unsaved === guarding) return;
    guarding = created.unsaved;
    if (guarding) window.addEventListener("beforeunload", warn);
    else window.removeEventListener("beforeunload", warn);
  });
  queue = created;
  return created;
}

const subscribe = (listener: () => void) => uploadQueue().subscribe(listener);
const snapshot = () => uploadQueue().getSnapshot();

/** The queue's entries, kept current. Empty while rendering on the server. */
export function useUploads(): readonly QueueEntry[] {
  return useSyncExternalStore(subscribe, snapshot, () => NONE);
}
