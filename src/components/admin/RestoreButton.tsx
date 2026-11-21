"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { restoreItemAction } from "@/app/actions/admin";
import { useUndo } from "@/components/admin/UndoProvider";

/** *Restore*: a removed item goes back on the grid (spec section 6). */
export function RestoreButton({ itemId, label, className = "" }: { itemId: string; label: string; className?: string }) {
  const router = useRouter();
  const { notify } = useUndo();
  const [busy, setBusy] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);
  const waiting = busy || refreshing;
  return (
    <>
      <button
        type="button"
        aria-disabled={waiting}
        onClick={async () => {
          if (waiting) return;
          setBusy(true);
          setProblem(null);
          const result = await restoreItemAction(itemId).catch(() => ({ ok: false as const, message: "Couldn't reach the lost and found. Try again." }));
          setBusy(false);
          if (!result.ok) {
            setProblem(result.message);
            return;
          }
          notify(`${itemId} is back on the grid.`);
          // This button goes once the page refreshes: keep keyboard focus on the page.
          document.querySelector<HTMLElement>("main h1")?.focus();
          startRefresh(() => router.refresh());
        }}
        className={`h-10 cursor-pointer rounded-[10px] border border-field bg-white px-3 text-sm font-bold text-ink hover:bg-page aria-disabled:cursor-wait aria-disabled:opacity-60 ${className}`}
      >
        {waiting ? "Restoring…" : "Restore"}
        <span className="sr-only">, {label}</span>
      </button>
      {problem && (
        <p role="alert" className="text-xs font-semibold text-bad">
          {problem}
        </p>
      )}
    </>
  );
}
