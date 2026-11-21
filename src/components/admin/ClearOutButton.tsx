"use client";

import { useState } from "react";
import { clearOutAction } from "@/app/actions/clear-out";
import { Sheet } from "@/components/admin/Sheet";
import { useUndo } from "@/components/admin/UndoProvider";

export interface ClearOutConfirmation {
  /** The date the clear-out counts for: the action checks it's still the one. */
  date: string;
  title: string;
  /** "This marks the 214 items still on the list as donated, …" */
  sentence: string;
  rows: { label: string; value: string }[];
  button: string;
}

/**
 * *Clear out* and its confirmation (spec section 7). There's no undo, so
 * the confirmation gives the numbers and says to empty the bin first.
 */
export function ClearOutButton({ confirmation }: { confirmation: ClearOutConfirmation }) {
  const { notify } = useUndo();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function clearOut() {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    const result = await clearOutAction(confirmation.date).catch(() => ({ ok: false as const, message: "Couldn't reach the lost and found. Reload the page to see whether it was done." }));
    setBusy(false);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    setOpen(false);
    notify(result.message);
    document.querySelector<HTMLElement>("main h1")?.focus();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setProblem(null);
          setOpen(true);
        }}
        className="btn bg-bad text-lg font-extrabold text-white hover:bg-bad hover:text-white"
      >
        Clear out
      </button>
      <Sheet open={open} onClose={() => !busy && setOpen(false)} busy={busy} labelledBy="clear-out-title">
        <div className="flex flex-col gap-4 px-4 pt-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
          <div className="flex flex-col gap-1.5">
            <h2 id="clear-out-title" className="text-xl font-extrabold">
              {confirmation.title}
            </h2>
            <p className="text-[15px] leading-snug text-body">{confirmation.sentence}</p>
          </div>
          {confirmation.rows.length > 0 && (
            <dl className="flex flex-col divide-y divide-rule rounded-xl border border-line">
              {confirmation.rows.map((row) => (
                <div key={row.label} className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-[15px]">
                  <dt className="text-body">{row.label}</dt>
                  <dd className="font-bold">{row.value}</dd>
                </div>
              ))}
            </dl>
          )}
          <p className="notice bg-bad-soft text-bad">Only do this after the bin has been emptied. There&apos;s no undo.</p>
          {problem && (
            <p role="alert" className="text-sm font-semibold text-bad">
              {problem}
            </p>
          )}
          <div className="flex flex-col gap-2">
            <button
              type="button"
              aria-disabled={busy}
              onClick={clearOut}
              className="btn bg-bad font-extrabold text-white hover:bg-bad hover:text-white aria-disabled:cursor-wait aria-disabled:opacity-60"
            >
              {busy ? "Clearing out…" : confirmation.button}
            </button>
            <button type="button" aria-disabled={busy} onClick={() => !busy && setOpen(false)} className="btn-secondary aria-disabled:cursor-wait aria-disabled:opacity-50">
              Cancel
            </button>
          </div>
        </div>
      </Sheet>
    </>
  );
}
