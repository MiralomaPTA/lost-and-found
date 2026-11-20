import { dayFromNumber, dayNumber } from "@/lib/dates";

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

/**
 * The next clear-out on or after `today`, or null if every date in the
 * coming year is skipped. `lastDone` is the date the most recent clear-out
 * counted for: once it has run, that date is no longer "next", even later the
 * same day.
 */
export function nextClearOut(today: string, changes: readonly ClearOutChange[], lastDone: string | null): string | null {
  const [year, month] = today.split("-").map(Number);
  // Start a month back: last month's date may have been moved into this one.
  const start = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
  const due = clearOutDates(start, 14, changes).filter((date) => date >= today && (!lastDone || date > lastDone));
  return due[0] ?? null;
}

/** Whole days from `today` until `date` (both YYYY-MM-DD): 0 on the day itself. */
export function daysUntil(today: string, date: string): number {
  return dayNumber(date) - dayNumber(today);
}

/** The donation reminder shows on the grid in the last 7 days, the clear-out day included. */
export const REMINDER_DAYS = 7;

export function showReminder(today: string, date: string | null): date is string {
  if (!date) return false;
  const days = daysUntil(today, date);
  return days >= 0 && days < REMINDER_DAYS;
}
