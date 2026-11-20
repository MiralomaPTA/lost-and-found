"use client";

import type { ReactNode } from "react";

/**
 * A submit button that stays focusable while its form is saving. A truly
 * disabled button would drop keyboard focus to the page; this one is marked
 * aria-disabled and ignores extra presses instead.
 */
export function SubmitButton({ pending, className, children }: { pending: boolean; className: string; children: ReactNode }) {
  return (
    <button
      type="submit"
      aria-disabled={pending}
      className={`${className} aria-disabled:cursor-wait aria-disabled:opacity-60`}
      onClick={(event) => {
        if (pending) event.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
