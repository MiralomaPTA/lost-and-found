"use client";

import { useActionState, useState } from "react";
import { resetTotalAction } from "@/app/actions/settings";
import { SubmitButton } from "@/components/SubmitButton";
import { NO_STATE } from "@/lib/form-state";
import type { TotalName } from "@/server/totals";

const LABELS: Record<TotalName, string> = { posted: "Items posted", claimed: "Claimed", donated: "Donated" };

export interface TotalRowView {
  name: TotalName;
  value: number;
  /** When it was last reset, as "Nov 21", or null. */
  since: string | null;
}

/** The totals families see on the code screen and in the footer, each with *Reset* (and a second tap to confirm). */
export function TotalsEditor({ rows }: { rows: TotalRowView[] }) {
  return (
    <ul className="flex flex-col divide-y divide-line">
      {rows.map((row) => (
        <TotalRow key={row.name} {...row} />
      ))}
    </ul>
  );
}

function TotalRow({ name, value, since }: TotalRowView) {
  const [state, run, pending] = useActionState(resetTotalAction, NO_STATE);
  const [confirming, setConfirming] = useState(false);
  // The confirmation goes once the answer is back, not on the tap: the form has to stay for the action to run.
  const [answered, setAnswered] = useState(state.attempt);
  if (state.attempt !== answered) {
    setAnswered(state.attempt);
    setConfirming(false);
  }
  const label = LABELS[name];
  return (
    <li className="flex flex-col gap-1.5 py-2.5 first:pt-0 last:pb-0">
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 flex-col">
          <span className="text-[15px] font-bold">
            {label}: {value.toLocaleString("en-US")}
          </span>
          {since && <span className="text-xs text-muted">Counting since {since}</span>}
        </span>
        {confirming ? (
          <form action={run} className="flex flex-none gap-2">
            <input type="hidden" name="total" value={name} />
            {/* Focus lands on Cancel, so a stray Enter doesn't reset anything. */}
            <button type="button" autoFocus onClick={() => setConfirming(false)} className="btn-secondary btn-small" disabled={pending}>
              Cancel
            </button>
            <SubmitButton pending={pending} className="btn-primary btn-small">
              {pending ? "Resetting…" : "Reset to 0"}
            </SubmitButton>
          </form>
        ) : (
          <button type="button" onClick={() => setConfirming(true)} aria-label={`Reset ${label.toLowerCase()}`} className="btn-secondary btn-small flex-none">
            Reset
          </button>
        )}
      </div>
      {/* Always on the page, so a screen reader hears the answer when it appears. */}
      <p role="status" className="text-sm font-semibold text-ok empty:sr-only">
        {state.saved && !pending ? state.saved : ""}
      </p>
      {state.error && (
        <p key={`e${state.attempt}`} role="alert" className="text-sm font-semibold text-bad">
          {state.error}
        </p>
      )}
    </li>
  );
}
