import type { Metadata } from "next";
import { after } from "next/server";
import { ClearOutButton, type ClearOutConfirmation } from "@/components/admin/ClearOutButton";
import { ComingDates, type ComingDateRow } from "@/components/admin/ComingDates";
import { doneThrough, untilLabel, upcomingClearOut } from "@/lib/clear-out";
import { dateLabel, dayFromNumber, dayLabel, dayNumber, pacificDate, shortDayLabel } from "@/lib/dates";
import {
  clearOutCounts,
  clearOutPlan,
  comingDates,
  countingFrom,
  finishClearOut,
  MOVE_DAYS,
  pastClearOuts,
  type ClearOutCounts,
  type ClearOutPlan,
  type ComingDate,
} from "@/server/clear-out";
import { getDeps } from "@/server/deps";
import { loadItems, sweepReplacedPhotos } from "@/server/items";
import { requireAdmin } from "@/server/session";

export const metadata: Metadata = { title: "Clear out · Admin · Lost & Found" };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Admin *Clear out* (spec section 7): the button and the next date, the coming dates, and the past clear-outs with their CSVs. */
export default async function ClearOutPage() {
  const { settings } = await requireAdmin();
  const deps = await getDeps();
  const file = await loadItems(deps, { fresh: true });
  after(async () => {
    // A clear-out that stopped partway gets finished; old photos past their Undo time go.
    await finishClearOut(deps).catch((error) => console.error("Couldn't finish the last clear-out", error));
    await sweepReplacedPhotos(deps).catch((error) => console.error("Couldn't sweep replaced photos", error));
  });
  const today = pacificDate(deps.now());
  const plan = clearOutPlan(today, settings.clear_out_changes, file);
  const counts = clearOutCounts(file);
  const next = upcomingClearOut(today, settings.clear_out_changes, countingFrom(file));
  const rows = comingDates(today, settings.clear_out_changes, file).map((row) => dateRow(row, today, doneThrough(file.last_clear_out)));
  const past = pastClearOuts(file);

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-3">
      <h1 tabIndex={-1} className="sr-only">
        Clear out
      </h1>

      <section aria-labelledby="h-next" className="card flex flex-col gap-3.5 p-4.5">
        <Heading plan={plan} next={next?.date ?? null} today={today} />
        {plan.kind === "done" ? (
          <p className="text-sm leading-snug text-body">
            {next ? `The next one is ${dayLabel(next.date)}.` : "Every date in the coming year is skipped."} Anything added from now on goes on the new list.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Tile count={counts.available} text="available now, would be donated" />
              <Tile count={counts.claimed} text={counts.claimed === 1 ? "open claim, would close as picked up" : "open claims, would close as picked up"} />
            </div>
            <p className="text-sm leading-snug text-body">
              On the day, volunteers bag up everything in the bin and donate it. Then tap Clear out here. Nothing happens on its own.
              {counts.removed === 1 ? " The removed item's photo is deleted too." : counts.removed > 1 ? ` The photos of the ${counts.removed} removed items are deleted too.` : ""}
            </p>
            {plan.kind === "extra" && (
              <p className="notice bg-warn-soft text-warn">
                {plan.next
                  ? `Nothing is due this week, so clearing out now is an extra one. The ${shortDayLabel(plan.next)} clear-out stays on the calendar.`
                  : "Nothing is due, so clearing out now is an extra one."}
              </p>
            )}
            <ClearOutButton confirmation={confirmation(plan, counts)} />
          </>
        )}
      </section>

      <section aria-labelledby="h-dates" className="card flex flex-col gap-1 p-4">
        <h2 id="h-dates" className="text-[17px] font-extrabold">
          Coming dates
        </h2>
        <p className="mb-2 text-[13px] leading-snug text-muted">The second Friday of each month. Move or skip one when school is closed.</p>
        {rows.length > 0 ? <ComingDates rows={rows} /> : <p className="text-sm text-muted">No dates in the coming months.</p>}
      </section>

      <section aria-labelledby="h-past" className="card flex flex-col gap-1 p-4">
        <h2 id="h-past" className="mb-1.5 text-[17px] font-extrabold">
          Past clear-outs
        </h2>
        {past.length === 0 ? (
          <p className="text-sm text-muted">None yet. After each one, its items are here as a CSV.</p>
        ) : (
          <ul className="flex flex-col">
            {past.map((entry) => {
              const ranOn = pacificDate(entry.done_at);
              return (
                <li key={`${entry.date}-${entry.done_at}`} className="flex items-center gap-2.5 border-t border-rule py-2.5">
                  <div className="flex min-w-0 flex-1 flex-col gap-px">
                    <span className="text-[15px] font-bold">{dayLabel(entry.date)}</span>
                    <span className="text-xs text-muted">
                      {ranOn !== entry.date ? `Done ${dateLabel(entry.done_at)} by ` : "Done by "}
                      {entry.done_by_name} · {entry.donated} donated · {entry.picked_up} picked up
                      {entry.removed ? ` · ${entry.removed} removed` : ""}
                    </span>
                  </div>
                  <a
                    href={`/admin/clear-out/${entry.date}.csv`}
                    download
                    aria-label={`Download the ${dayLabel(entry.date)} clear-out as CSV`}
                    className="inline-flex h-10 flex-none items-center gap-1.5 rounded-[10px] border border-field bg-white px-3 text-sm font-bold text-ink no-underline hover:bg-page hover:text-ink"
                  >
                    <DownloadIcon />
                    CSV
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function Heading({ plan, next, today }: { plan: ClearOutPlan; next: string | null; today: string }) {
  const [title, date, when, warn] =
    plan.kind === "done"
      ? ["Last clear-out", plan.date, plan.ranOn === today ? "done today" : `done ${dayLabel(plan.ranOn)}`, false]
      : plan.kind === "due"
        ? ["Next clear-out", plan.date, plan.overdue ? "hasn't been done yet" : untilLabel(today, plan.date), plan.overdue]
        : ["Next clear-out", next, next ? untilLabel(today, next) : "", false];
  return (
    <div className="flex flex-col gap-0.5">
      <h2 id="h-next" className="text-xs font-bold tracking-[0.04em] text-muted uppercase">
        {title}
      </h2>
      <div className="flex flex-wrap items-baseline gap-x-2.5">
        <span className="text-[28px] leading-tight font-extrabold">{date ? dayLabel(date) : "None planned"}</span>
        {when && <span className={`text-[15px] font-bold ${warn ? "text-warn" : "text-muted"}`}>{when}</span>}
      </div>
    </div>
  );
}

function Tile({ count, text }: { count: number; text: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-xl bg-page px-3 py-2.5">
      <span className="text-[22px] font-extrabold">{count}</span>
      <span className="text-xs leading-snug text-body">{text}</span>
    </div>
  );
}

/** The confirmation's words, in the spec's: "This marks the 214 items still on the list as donated, closes 37 claims as picked up, and removes all their photos." */
function confirmation(plan: Exclude<ClearOutPlan, { kind: "done" }>, counts: ClearOutCounts): ClearOutConfirmation {
  const title = plan.kind === "due" ? `Clear out the ${shortDayLabel(plan.date)} bin?` : "Clear out the bin now?";
  const parts = [
    counts.available > 0 ? `marks the ${plural(counts.available, "item")} still on the list as donated` : null,
    counts.claimed > 0 ? `closes ${plural(counts.claimed, "claim")} as picked up` : null,
    counts.total > 0 ? `removes all their photos` : null,
  ].filter((part): part is string => Boolean(part));
  const sentence =
    parts.length === 0
      ? `The list is empty, so this only marks the ${shortDayLabel(plan.date)} clear-out as done.`
      : `This ${parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")}${parts.length > 2 ? "," : ""} and ${parts.at(-1)}`}.`;
  const rows =
    counts.total === 0
      ? []
      : [
          { label: "Still available", value: `${counts.available} → Donated` },
          { label: "Open claims", value: `${counts.claimed} → Picked up` },
          ...(counts.removed > 0 ? [{ label: "Removed", value: `${counts.removed} → Off the list` }] : []),
          { label: "Photos", value: "All deleted" },
        ];
  return { date: plan.date, title, sentence, rows, button: counts.available > 0 ? `Clear out ${plural(counts.available, "item")}` : "Clear out" };
}

function dateRow(row: ComingDate, today: string, through: string | null): ComingDateRow {
  const by = row.byName ? ` by ${row.byName}` : "";
  const note = row.overdue
    ? "Hasn't been done yet"
    : row.change === "skipped"
      ? `Skipped${by}`
      : row.change === "moved"
        ? `Moved from ${dayLabel(row.scheduled)}${by}`
        : row.next
          ? "Next"
          : "Second Friday";
  const offset = (days: number) => dayFromNumber(dayNumber(row.scheduled) + days);
  const earliest = [today, offset(-MOVE_DAYS), through ? dayFromNumber(dayNumber(through) + 1) : today].sort().at(-1)!;
  return {
    scheduled: row.scheduled,
    label: dayLabel(row.date ?? row.scheduled),
    scheduledLabel: dayLabel(row.scheduled),
    note,
    flagged: row.overdue || row.change !== null,
    skipped: row.change === "skipped",
    changed: row.change !== null,
    min: earliest,
    max: offset(MOVE_DAYS),
  };
}

function DownloadIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
    </svg>
  );
}
