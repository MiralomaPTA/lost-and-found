const TIME_ZONE = "America/Los_Angeles";

const dateFormat = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });
const timeFormat = new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });

const DAY_MS = 24 * 60 * 60 * 1000;

/** The date in Pacific time, as YYYY-MM-DD. */
export function pacificDate(date: Date | string): string {
  return dateFormat.format(typeof date === "string" ? new Date(date) : date);
}

const shortDateFormat = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, month: "short", day: "numeric" });

/** "Aug 24", in Pacific time. */
export function shortDate(date: Date | string): string {
  return shortDateFormat.format(typeof date === "string" ? new Date(date) : date);
}

/** The time of day in Pacific time, as HHMMSS. */
export function pacificTime(date: Date): string {
  const parts = timeFormat.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${part("hour")}${part("minute")}${part("second")}`;
}

// --- Calendar days, written YYYY-MM-DD. They have no time of day or time zone. ---

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Days since 1970-01-01 for a YYYY-MM-DD day. */
export function dayNumber(day: string): number {
  const match = DAY_PATTERN.exec(day);
  if (!match) throw new Error(`Not a YYYY-MM-DD day: ${day}`);
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / DAY_MS;
}

/** The YYYY-MM-DD day for a day number. */
export function dayFromNumber(n: number): string {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

/** How many Pacific calendar days lie between two moments: 0 on the same day. */
export function daysBetween(earlier: Date | string, later: Date | string): number {
  return dayNumber(pacificDate(later)) - dayNumber(pacificDate(earlier));
}

const dayLabelFormat = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });

/** "Fri, Dec 11" for a YYYY-MM-DD day. */
export function dayLabel(day: string): string {
  return dayLabelFormat.format(new Date(dayNumber(day) * DAY_MS));
}

/** "Fri, Dec 11" for a moment, in Pacific time. */
export function dateLabel(date: Date | string): string {
  return dayLabel(pacificDate(date));
}

/** "Dec 11" for a YYYY-MM-DD day. */
export function shortDayLabel(day: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(new Date(dayNumber(day) * DAY_MS));
}

/**
 * How long an item has been in the bin, from the day it was added (spec:
 * *Age*): "Today", "1 day" … "6 days", then whole weeks. Never stored.
 */
export function ageLabel(addedAt: string, now: Date): string {
  const days = Math.max(0, daysBetween(addedAt, now));
  if (days === 0) return "Today";
  if (days < 7) return days === 1 ? "1 day" : `${days} days`;
  const weeks = Math.floor(days / 7);
  return weeks === 1 ? "1 week" : `${weeks} weeks`;
}

/** "today", "yesterday" or "Thu, Dec 3", for "Claimed …". */
export function relativeDayLabel(date: string, now: Date): string {
  const days = daysBetween(date, now);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  return dateLabel(date);
}

const clockFormat = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, hour: "numeric", minute: "2-digit", hour12: true });
const weekdayFormat = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, weekday: "short" });

/** "Today, 8:40 am", "Yesterday, 3:10 pm", "Fri, 3:10 pm" (this week), or "Nov 5, 3:10 pm", in Pacific time. */
export function whenLabel(moment: string, now: Date): string {
  const time = clockFormat.format(new Date(moment)).replace(" AM", " am").replace(" PM", " pm");
  const days = daysBetween(moment, now);
  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Yesterday, ${time}`;
  if (days > 1 && days < 7) return `${weekdayFormat.format(new Date(moment))}, ${time}`;
  return `${shortDate(moment)}, ${time}`;
}
