"use client";

import { useEffect, useRef, type ReactNode, type SyntheticEvent } from "react";

/** A bottom sheet on a phone, a centered box on a wider screen. */
export const SHEET =
  "m-0 mt-auto max-h-[94dvh] w-full max-w-none overflow-y-auto rounded-t-[22px] bg-white p-0 text-ink backdrop:bg-ink/55 sm:m-auto sm:max-w-md sm:rounded-[22px]";

/** Opens and closes a `<dialog>` as a modal, following `open`. */
export function useModal(open: boolean) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    else if (!open && element.open) element.close();
  }, [open]);
  return dialog;
}

/**
 * A modal sheet. Escape and the browser's back gesture close it through
 * `onClose`, unless `busy` (something is on its way to the server).
 */
export function Sheet({ open, onClose, busy = false, labelledBy, children }: { open: boolean; onClose: () => void; busy?: boolean; labelledBy: string; children: ReactNode }) {
  const dialog = useModal(open);
  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      onCancel={(event: SyntheticEvent) => {
        if (busy) event.preventDefault();
      }}
      aria-labelledby={labelledBy}
      className={SHEET}
    >
      {open && children}
    </dialog>
  );
}
