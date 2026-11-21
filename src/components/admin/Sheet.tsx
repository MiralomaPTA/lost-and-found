"use client";

import { useEffect, useRef, type ReactNode, type SyntheticEvent } from "react";

/** A bottom sheet on a phone, a centered box on a wider screen. */
export const SHEET =
  "m-0 mt-auto max-h-[94dvh] w-full max-w-none overflow-y-auto rounded-t-[22px] bg-white p-0 text-ink backdrop:bg-ink/55 sm:m-auto sm:max-w-md sm:rounded-[22px]";

/**
 * Opens and closes a `<dialog>` as a modal, following `open`. Opening it
 * focuses the element marked `data-autofocus`, if any, rather than the
 * first button (React doesn't put `autofocus` in the page for the browser).
 */
export function useModal(open: boolean) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      element.showModal();
      element.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    } else if (!open && element.open) element.close();
  }, [open]);
  return dialog;
}

/**
 * A modal sheet. Escape and the browser's back gesture close it through
 * `onClose`, unless `busy` (something is on its way to the server).
 */
export function Sheet({
  open,
  onClose,
  busy = false,
  labelledBy,
  describedBy,
  children,
}: {
  open: boolean;
  onClose: () => void;
  busy?: boolean;
  labelledBy: string;
  describedBy?: string;
  children: ReactNode;
}) {
  const dialog = useModal(open);
  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      onCancel={(event: SyntheticEvent) => {
        if (busy) event.preventDefault();
      }}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      className={SHEET}
    >
      {open && children}
    </dialog>
  );
}
