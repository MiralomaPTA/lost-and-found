import { dayFromNumber, dayNumber, pacificDate } from "@/lib/dates";

/**
 * Clear-out dates (spec section 7). One is due on the second Friday of each
 * month. Admins can move a date or skip it (school closed, summer), which
 * settings.json records as a change against that month's second Friday.
 * Nothing runs on the date: an admin taps *Clear out*.
 */

export interface ClearOutChange {
  /** The second Friday this change is about, YYYY-MM-DD. */
  date: string;
  change: "moved" | "skipped";
  moved_to: string | null;
  /** The admin who moved or skipped it, as their phone was named then. */
  by_name?: string | null;
}

/** The second Friday of a month (1–12), as YYYY-MM-DD. */
export function secondFriday(year: number, month: number): string {
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const firstFriday = 1 + ((5 - firstWeekday + 7) % 7);
  return dayFromNumber(Date.UTC(year, month - 1, firstFriday + 7) / 86_400_000);
}

/**
 * The clear-out dates from `fromMonth` on, for `months` months, with moves
 * and skips applied, in order.
 */
export function clearOutDates(from: { year: number; month: number }, months: number, changes: readonly ClearOutChange[]): string[] {
  const dates: string[] = [];
  for (let i = 0; i < months; i++) {
    const year = from.year + Math.floor((from.month - 1 + i) / 12);
    const month = ((from.month - 1 + i) % 12) + 1;
    const scheduled = secondFriday(year, month);
    const change = changes.find((c) => c.date === scheduled);
    if (change?.change === "skipped") continue;
    dates.push(change?.change === "moved" && change.moved_to ? change.moved_to : scheduled);
  }
  return dates.sort();
}

/** The clear-out that last ran: the (moved-to) date it counted for, and when it actually ran. */
export interface LastClearOut {
  date: string;
  done_at: string;
}

/** The last day a clear-out covers: the date it counted for, or the day it ran if that was later. */
export function doneThrough(last: LastClearOut | null): string | null {
  return last ? [last.date, pacificDate(last.done_at)].sort()[1] : null;
}

export interface UpcomingClearOut {
  /** YYYY-MM-DD. */
  date: string;
  /** The date has passed and no clear-out has run since: the bin will be emptied any day. */
  overdue: boolean;
}

/**
 * The clear-out families should plan for, or null if every date in the
 * coming year is skipped.
 *
 * Usually that's the next date on or after `today`. If the most recent date
 * passed without a clear-out (it slipped, as the spec expects can happen), it
 * stays "due" until one runs, so families keep being warned rather than told
 * they have until next month. Once a clear-out has run, no date up to the one
 * it counted for, or the day it ran, is due any more. Before the first
 * clear-out ever (`last` is null) only coming dates count, so a date from
 * before the app started is never shown as overdue.
 */
export function upcomingClearOut(today: string, changes: readonly ClearOutChange[], last: LastClearOut | null): UpcomingClearOut | null {
  const [year, month] = today.split("-").map(Number);
  // Start a month back: last month's date may have been moved into this one, or be overdue.
  const start = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
  const through = doneThrough(last);
  const pending = clearOutDates(start, 14, changes).filter((date) => !through || date > through);
  const past = pending.filter((date) => date < today);
  if (last && past.length > 0) return { date: past[past.length - 1], overdue: true };
  const next = pending.find((date) => date >= today);
  return next ? { date: next, overdue: false } : null;
}

/** Whole days from `today` until `date` (both YYYY-MM-DD): 0 on the day itself. */
export function daysUntil(today: string, date: string): number {
  return dayNumber(date) - dayNumber(today);
}

/** "today", "tomorrow", "in 4 days"; for a past date, "2 days ago". */
export function untilLabel(today: string, date: string): string {
  const days = daysUntil(today, date);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

/** Whether a YYYY-MM-DD day is its month's second Friday. */
export function isSecondFriday(day: string): boolean {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(day);
  return Boolean(match) && secondFriday(Number(match![1]), Number(match![2])) === day;
}

/** The donation reminder shows on the grid in the last 7 days, the clear-out day included. */
export const REMINDER_DAYS = 7;

/** Whether to show the donation reminder: in the last week before a clear-out, or while one is overdue. */
export function showReminder(today: string, clearOut: UpcomingClearOut | null): clearOut is UpcomingClearOut {
  if (!clearOut) return false;
  if (clearOut.overdue) return true;
  const days = daysUntil(today, clearOut.date);
  return days >= 0 && days < REMINDER_DAYS;
}
