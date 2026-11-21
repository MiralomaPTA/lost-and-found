"use client";

import { useEffect, useRef, useState } from "react";
import { moveClearOutAction, putBackClearOutAction, skipClearOutAction } from "@/app/actions/clear-out";
import { useUndo } from "@/components/admin/UndoProvider";
import { dayLabel } from "@/lib/dates";

export interface ComingDateRow {
  /** The second Friday it's about: what the actions name. */
  scheduled: string;
  /** "Fri, Dec 11": when it's due, or for a skipped one, when it would have been. */
  label: string;
  /** "Fri, Dec 11": the second Friday itself. */
  scheduledLabel: string;
  /** "Next", "Second Friday", "Moved from Fri, Jan 8 by Dana", "Hasn't been done yet". */
  note: string;
  /** Moved, skipped or overdue: the note is worth noticing. */
  flagged: boolean;
  skipped: boolean;
  changed: boolean;
  /** The range *Move* takes, YYYY-MM-DD. */
  min: string;
  max: string;
}

const OFFLINE = "Couldn't reach the lost and found. Try again.";
const ROW_BUTTON =
  "h-10 flex-none cursor-pointer rounded-[10px] border border-field bg-white px-3 text-sm font-bold text-ink hover:bg-page aria-disabled:cursor-wait aria-disabled:opacity-60";

/** The *Clear out* tab's coming dates (spec section 7): *Move* or *Skip* one, or *Put back* one that was. */
export function ComingDates({ rows }: { rows: ComingDateRow[] }) {
  const { offer, notify } = useUndo();
  const [moving, setMoving] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ scheduled: string; text: string } | null>(null);
  const focusOn = useRef<string | null>(null);

  // A row's buttons change after a change: once the new dates arrive, keep keyboard focus on that row.
  useEffect(() => {
    if (!focusOn.current) return;
    document.getElementById(`date-${focusOn.current}`)?.focus();
    focusOn.current = null;
  }, [rows]);

  async function run(row: ComingDateRow, change: () => Promise<{ ok: true } | { ok: false; message: string }>, done: () => void) {
    if (busy) return;
    setBusy(row.scheduled);
    setProblem(null);
    const result = await change().catch(() => ({ ok: false as const, message: OFFLINE }));
    setBusy(null);
    if (!result.ok) {
      setProblem({ scheduled: row.scheduled, text: result.message });
      return;
    }
    setMoving(null);
    focusOn.current = row.scheduled;
    done();
  }

  const putBack = async (scheduled: string) => {
    const back = await putBackClearOutAction(scheduled);
    return back.ok ? null : back.message;
  };

  return (
    <ul className="flex flex-col">
      {rows.map((row) => {
        const rowBusy = busy === row.scheduled;
        return (
          <li key={row.scheduled} className="flex flex-col gap-2 border-t border-rule py-2.5">
            <div className="flex items-center gap-2">
              <div id={`date-${row.scheduled}`} tabIndex={-1} className="flex min-w-0 flex-1 flex-col gap-px outline-none">
                <span className={`text-[15px] font-bold ${row.skipped ? "text-muted line-through" : ""}`}>{row.label}</span>
                <span className={`text-xs ${row.flagged ? "font-semibold text-warn" : "text-muted"}`}>{row.note}</span>
              </div>
              {row.changed ? (
                <button
                  type="button"
                  aria-disabled={rowBusy}
                  aria-label={`Put back the ${row.label} clear-out`}
                  className={ROW_BUTTON}
                  onClick={() => run(row, () => putBackClearOutAction(row.scheduled), () => notify(`The clear-out is back on ${row.scheduledLabel}.`))}
                >
                  {rowBusy ? "Putting back…" : "Put back"}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    aria-expanded={moving === row.scheduled}
                    aria-controls={`move-${row.scheduled}`}
                    aria-label={`Move the ${row.label} clear-out`}
                    className={ROW_BUTTON}
                    onClick={() => {
                      setProblem(null);
                      setMoving(moving === row.scheduled ? null : row.scheduled);
                    }}
                  >
                    Move
                  </button>
                  <button
                    type="button"
                    aria-disabled={rowBusy}
                    aria-label={`Skip the ${row.label} clear-out`}
                    className={ROW_BUTTON}
                    onClick={() =>
                      run(row, () => skipClearOutAction(row.scheduled), () => offer(`The ${row.label} clear-out is skipped.`, () => putBack(row.scheduled)))
                    }
                  >
                    {rowBusy && moving !== row.scheduled ? "Skipping…" : "Skip"}
                  </button>
                </>
              )}
            </div>
            {moving === row.scheduled && (
              <form
                id={`move-${row.scheduled}`}
                className="flex flex-wrap items-end gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  const to = String(new FormData(event.currentTarget).get("to") ?? "");
                  void run(row, () => moveClearOutAction(row.scheduled, to), () =>
                    offer(`The ${row.label} clear-out is moved to ${dayLabel(to)}.`, () => putBack(row.scheduled)),
                  );
                }}
              >
                <label className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-[13px] font-bold">New date for the {row.label} clear-out</span>
                  <input type="date" name="to" required min={row.min} max={row.max} defaultValue={row.min} className="field h-11" />
                </label>
                <button type="submit" aria-disabled={rowBusy} className="btn-primary btn-small aria-disabled:cursor-wait aria-disabled:opacity-60">
                  {rowBusy ? "Moving…" : "Move"}
                </button>
                <button type="button" className="btn-secondary btn-small" onClick={() => setMoving(null)}>
                  Cancel
                </button>
              </form>
            )}
            {problem?.scheduled === row.scheduled && (
              <p role="alert" className="text-sm font-semibold text-bad">
                {problem.text}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
