"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { resetTotalAction } from "@/app/actions/settings";
import { SubmitButton } from "@/components/SubmitButton";
import { longDate } from "@/lib/dates";
import { NO_STATE } from "@/lib/form-state";
import { TOTAL_LABELS, type TotalName } from "@/server/totals";

export interface TotalRowView {
  name: TotalName;
  value: number;
  /** When it was last reset (ISO), or null. */
  since: string | null;
}

/** The totals families see on the code screen and in the footer, each with *Reset*, which asks first. */
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
  const [asking, setAsking] = useState(false);
  // The question goes once the answer is back, not on the tap: the form has to stay for the action to run.
  const [answered, setAnswered] = useState(state.attempt);
  if (state.attempt !== answered) {
    setAnswered(state.attempt);
    setAsking(false);
  }
  // When the question goes (Cancel, or the answer), keyboard focus goes back to Reset rather than the top of the page.
  const resetButton = useRef<HTMLButtonElement>(null);
  const wasAsking = useRef(false);
  useEffect(() => {
    if (wasAsking.current && !asking) resetButton.current?.focus();
    wasAsking.current = asking;
  }, [asking]);

  const label = TOTAL_LABELS[name];
  return (
    <li className="flex flex-col gap-2 py-2.5 first:pt-0 last:pb-0">
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 flex-col">
          <span className="text-[15px] font-bold">
            {label}: {value.toLocaleString("en-US")}
          </span>
          {since && <span className="text-xs text-muted">Counting since {longDate(since)}</span>}
        </span>
        {!asking && (
          <button ref={resetButton} type="button" onClick={() => setAsking(true)} aria-label={`Reset ${label.toLowerCase()}`} className="btn-secondary btn-small flex-none">
            Reset
          </button>
        )}
      </div>
      {asking && (
        <form action={run} role="group" aria-label={`Reset ${label.toLowerCase()}`} className="flex flex-col gap-2.5 rounded-xl bg-page px-3.5 py-3">
          <input type="hidden" name="total" value={name} />
          <p className="text-sm font-semibold">
            Set &ldquo;{label}&rdquo; back to 0 for everyone? It counts again from now.
          </p>
          <div className="flex justify-end gap-2">
            {/* Focus lands on Cancel, so a stray Enter doesn't reset anything. */}
            <button type="button" autoFocus onClick={() => setAsking(false)} className="btn-secondary btn-small" disabled={pending}>
              Cancel
            </button>
            <SubmitButton pending={pending} className="btn-primary btn-small">
              {pending ? "Resetting…" : "Reset to 0"}
            </SubmitButton>
          </div>
        </form>
      )}
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
