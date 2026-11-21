"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { reopenClaimAction, undoClaimAction } from "@/app/actions/admin";
import { useUndo } from "@/components/admin/UndoProvider";

/**
 * *Undo claim*, with an optional note the family sees in My items (spec
 * section 6). The item goes back on the grid; the bar offers *Undo*.
 */
export function UndoClaimForm({ itemId, claimId, label }: { itemId: string; claimId: string; label: string }) {
  const router = useRouter();
  const { offer } = useUndo();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [, startRefresh] = useTransition();
  const refresh = () => startRefresh(() => router.refresh());

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="h-10 cursor-pointer self-start rounded-[10px] border border-field bg-white px-3 text-sm font-bold text-ink hover:bg-page"
      >
        Undo claim<span className="sr-only">, {label}</span>
      </button>
    );
  }
  return (
    <form
      className="flex flex-col gap-1.5 rounded-xl bg-page p-3"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        setBusy(true);
        setProblem(null);
        const result = await undoClaimAction(itemId, claimId, note).catch(() => ({ ok: false as const, message: "Couldn't reach the lost and found. Try again." }));
        setBusy(false);
        if (!result.ok) {
          setProblem(result.message);
          return;
        }
        setOpen(false);
        offer(`${itemId}: claim undone. It's back on the grid.`, async () => {
          const back = await reopenClaimAction(itemId, claimId);
          refresh();
          return back.ok ? null : back.message;
        });
        refresh();
      }}
    >
      <label htmlFor={`${id}-note`} className="text-[13px] font-bold">
        Note for the family <span className="font-normal text-muted">(optional)</span>
      </label>
      <input
        id={`${id}-note`}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        maxLength={300}
        placeholder="e.g. This belongs to another student."
        className="field h-11"
        aria-describedby={`${id}-hint`}
      />
      <span id={`${id}-hint`} className="text-xs text-muted">
        They&apos;ll see it in My items. The item goes back on the grid.
      </span>
      {problem && (
        <p role="alert" className="text-sm font-semibold text-bad">
          {problem}
        </p>
      )}
      <div className="mt-1 flex justify-end gap-2">
        <button type="button" onClick={() => setOpen(false)} className="h-10 cursor-pointer rounded-[10px] px-3 text-sm font-bold text-ink">
          Cancel
        </button>
        <button type="submit" aria-disabled={busy} className="h-10 cursor-pointer rounded-[10px] bg-bad px-3 text-sm font-bold text-white aria-disabled:opacity-60">
          {busy ? "Undoing…" : "Undo claim"}
        </button>
      </div>
    </form>
  );
}
