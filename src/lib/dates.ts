const TIME_ZONE = "America/Los_Angeles";

const dateFormat = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });
const timeFormat = new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });

/** The date in Pacific time, as YYYY-MM-DD. */
export function pacificDate(date: Date): string {
  return dateFormat.format(date);
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
