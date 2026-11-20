import { describe, expect, it } from "vitest";
import { clearOutDates, secondFriday, showReminder, upcomingClearOut } from "@/lib/clear-out";
import { ageLabel, dateLabel, dayLabel, daysBetween, relativeDayLabel } from "@/lib/dates";

describe("ages", () => {
  const now = new Date("2026-12-07T18:00:00Z"); // Mon, Dec 7, 10am Pacific

  it.each([
    ["2026-12-07T16:00:00Z", "Today"],
    ["2026-12-07T08:30:00Z", "Today"], // 12:30am Pacific, same day
    ["2026-12-07T07:30:00Z", "1 day"], // 11:30pm Pacific the day before
    ["2026-12-01T18:00:00Z", "6 days"],
    ["2026-11-30T18:00:00Z", "1 week"],
    ["2026-11-24T18:00:00Z", "1 week"],
    ["2026-11-23T18:00:00Z", "2 weeks"],
    ["2026-11-16T18:00:00Z", "3 weeks"],
  ])("added %s is %s old", (added, label) => {
    expect(ageLabel(added, now)).toBe(label);
  });

  it("counts Pacific days across the change from daylight time", () => {
    expect(daysBetween("2026-10-31T19:00:00Z", "2026-11-01T19:00:00Z")).toBe(1);
  });

  it("labels days", () => {
    expect(dayLabel("2026-12-11")).toBe("Fri, Dec 11");
    expect(dateLabel("2026-12-12T06:00:00Z")).toBe("Fri, Dec 11"); // 10pm Pacific
    expect(relativeDayLabel("2026-12-07T16:00:00Z", now)).toBe("today");
    expect(relativeDayLabel("2026-12-06T16:00:00Z", now)).toBe("yesterday");
    expect(relativeDayLabel("2026-12-03T16:00:00Z", now)).toBe("Thu, Dec 3");
  });
});

describe("clear-out dates", () => {
  it.each([
    [2026, 11, "2026-11-13"],
    [2026, 12, "2026-12-11"],
    [2027, 1, "2027-01-08"], // the month starts on a Friday
    [2026, 5, "2026-05-08"],
    [2026, 2, "2026-02-13"],
  ])("the second Friday of %i-%i is %s", (year, month, date) => {
    expect(secondFriday(year, month)).toBe(date);
  });

  it("applies moves and skips", () => {
    const changes = [
      { date: "2026-12-11", change: "moved" as const, moved_to: "2026-12-18" },
      { date: "2027-01-08", change: "skipped" as const, moved_to: null },
    ];
    expect(clearOutDates({ year: 2026, month: 11 }, 4, changes)).toEqual(["2026-11-13", "2026-12-18", "2027-02-12"]);
  });

  const done = (date: string, doneAt = `${date}T23:00:00Z`) => ({ date, done_at: doneAt });

  it("finds the next one", () => {
    expect(upcomingClearOut("2026-12-07", [], null)).toEqual({ date: "2026-12-11", overdue: false });
    // On the day, until it's done.
    expect(upcomingClearOut("2026-12-11", [], done("2026-11-13"))).toEqual({ date: "2026-12-11", overdue: false });
    expect(upcomingClearOut("2026-12-11", [], done("2026-12-11"))).toEqual({ date: "2027-01-08", overdue: false });
  });

  it("keeps a date that slipped as due until the clear-out runs", () => {
    expect(upcomingClearOut("2026-12-14", [], done("2026-11-13"))).toEqual({ date: "2026-12-11", overdue: true });
    // Run late, on Monday: it counted for Dec 11, so January is next.
    expect(upcomingClearOut("2026-12-14", [], done("2026-12-11", "2026-12-15T01:00:00Z"))).toEqual({ date: "2027-01-08", overdue: false });
  });

  it("never calls a date from before the first clear-out overdue", () => {
    expect(upcomingClearOut("2026-11-20", [], null)).toEqual({ date: "2026-12-11", overdue: false });
  });

  it("handles a moved date before and after its clear-out", () => {
    const moved = [{ date: "2026-12-11", change: "moved" as const, moved_to: "2026-12-18" }];
    expect(upcomingClearOut("2026-12-14", moved, done("2026-11-13"))).toEqual({ date: "2026-12-18", overdue: false });
    // Done on the moved-to day, recorded as that date…
    expect(upcomingClearOut("2026-12-18", moved, done("2026-12-18"))).toEqual({ date: "2027-01-08", overdue: false });
    // …or recorded as the original second Friday: the day it ran still counts.
    expect(upcomingClearOut("2026-12-18", moved, done("2026-12-11", "2026-12-18T23:00:00Z"))).toEqual({ date: "2027-01-08", overdue: false });
  });

  it("finds a date moved in from last month", () => {
    const changes = [{ date: "2026-11-13", change: "moved" as const, moved_to: "2026-12-02" }];
    expect(upcomingClearOut("2026-12-01", changes, null)).toEqual({ date: "2026-12-02", overdue: false });
  });

  it("has none when a whole year is skipped", () => {
    const changes = Array.from({ length: 15 }, (_, i) => ({
      date: secondFriday(2026 + Math.floor((10 + i) / 12), ((10 + i) % 12) + 1),
      change: "skipped" as const,
      moved_to: null,
    }));
    expect(upcomingClearOut("2026-12-01", changes, null)).toBeNull();
  });

  it("shows the donation reminder in the last 7 days, the day itself included, and while overdue", () => {
    const dec11 = { date: "2026-12-11", overdue: false };
    expect(showReminder("2026-12-04", dec11)).toBe(false);
    expect(showReminder("2026-12-05", dec11)).toBe(true);
    expect(showReminder("2026-12-11", dec11)).toBe(true);
    expect(showReminder("2026-12-14", { date: "2026-12-11", overdue: true })).toBe(true);
    expect(showReminder("2026-12-05", null)).toBe(false);
  });
});
