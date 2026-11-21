import { beforeEach, describe, expect, it, vi } from "vitest";

/* Clear-outs and the rest of Settings: the dates, the run itself, the CSVs, the types and colors lists, and their actions. */
const h = vi.hoisted(() => ({ jar: new Map<string, string>(), deps: { current: null as unknown } }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (h.jar.has(name) ? { name, value: h.jar.get(name)! } : undefined),
    has: (name: string) => h.jar.has(name),
    set: (name: string, value: string) => void h.jar.set(name, value),
    delete: (name: string) => void h.jar.delete(name),
  }),
  headers: async () => ({ get: () => "203.0.113.7" }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect to ${url}`);
  },
}));
vi.mock("next/cache", () => ({ refresh: () => {} }));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<object>()), after: (task: () => unknown) => void Promise.resolve().then(task) }));
vi.mock("@/server/deps", () => ({ getDeps: async () => (h.deps.current as { deps: unknown }).deps }));

import { NextRequest } from "next/server";
import { clearOutAction, moveClearOutAction, putBackClearOutAction, skipClearOutAction } from "@/app/actions/clear-out";
import { addTagAction, editTagAction, reorderTagsAction, saveBinDescriptionAction } from "@/app/actions/settings";
import { GET as archiveCsvRoute } from "@/app/admin/clear-out/[file]/route";
import { GET as itemsCsvRoute } from "@/app/admin/items.csv/route";
import { changeTagsAction } from "@/app/actions/items";
import { upcomingClearOut, type ClearOutChange } from "@/lib/clear-out";
import { archiveKey, lastArchive, pendingArchiveKey, readArchive } from "@/server/archives";
import {
  clearOutPlan,
  closeList,
  comingDates,
  countingFrom,
  moveClearOut,
  moveRange,
  putBackClearOut,
  runClearOut,
  skipClearOut,
  sweepOrphanPhotos,
  tidyBucket,
} from "@/server/clear-out";
import { CODE_COOKIE, PHONE_COOKIE } from "@/server/cookies";
import { itemsCsv } from "@/server/csv";
import { addItem, changeItems, claimItem, emptyItemsFile, ITEMS_KEY, loadItems, markNotThere, type ItemsFile } from "@/server/items";
import { phoneCode } from "@/server/phone-code";
import { becomeAdmin, deviceKey, forgetOldPhones, schoolCodeProof, setDeviceName } from "@/server/phones";
import { memoryObjectStore } from "@/server/storage/memory";
import type { ObjectStore } from "@/server/storage/types";
import { changeSchoolCode, loadSettings, startingSettings, type Settings } from "@/server/settings";
import { addEntry, cleanBinDescription, editEntry, renameOnList, reorderEntries } from "@/server/tag-lists";
import { activeColors, activeTypes, myItemsView, nextClearOutFor, tagChoices } from "@/server/views";
import { PHONE_A, PHONE_B, PHONE_C, photoNames, racingStore, testDeps } from "./helpers";

const ADMIN = PHONE_C;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const RUN = "0123456789abcdef";
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

/** Items added at `addedAt`, numbered from L-0001. */
function list(count: number, addedAt = "2026-12-01T18:00:00Z", type = "Jacket"): ItemsFile {
  const file = emptyItemsFile();
  for (let i = 0; i < count; i++) addItem(file, { type, color: "Navy", has_name: false, ...photoNames(), phoneId: PHONE_A, name: "Volunteer" }, new Date(addedAt));
  return file;
}

/** Three items: one available (with a replaced photo kept for Undo), one claimed by PHONE_B, one reported missing. */
function bin(): ItemsFile {
  const file = list(3);
  file.items[0].previous_photo = { ...photoNames(), replaced_at: "2026-12-07T15:58:00Z" };
  claimItem(file, { itemId: "L-0002", phoneId: PHONE_B, name: "Lee family", claimId: "c-0000000002" }, new Date("2026-12-02T18:00:00Z"));
  claimItem(file, { itemId: "L-0003", phoneId: PHONE_B, name: "Lee family", claimId: "c-0000000003" }, new Date("2026-12-02T18:00:00Z"));
  markNotThere(file, { itemId: "L-0003", claimId: "c-0000000003", phoneId: PHONE_B }, new Date("2026-12-03T18:00:00Z"));
  return file;
}

const moved = (date: string, to: string, by = "Dana"): ClearOutChange => ({ date, change: "moved", moved_to: to, by_name: by });
const skipped = (date: string, by = "Sam"): ClearOutChange => ({ date, change: "skipped", moved_to: null, by_name: by });

describe("which date a clear-out counts for", () => {
  it("counts for this week's date, early or on the day", () => {
    const file = list(1);
    expect(clearOutPlan("2026-12-07", [], file)).toEqual({ kind: "due", date: "2026-12-11", overdue: false });
    expect(clearOutPlan("2026-12-11", [], file)).toEqual({ kind: "due", date: "2026-12-11", overdue: false });
  });

  it("is an extra one when nothing is due this week, and the next date stays", () => {
    expect(clearOutPlan("2026-11-20", [], list(1, "2026-11-16T18:00:00Z"))).toEqual({ kind: "extra", date: "2026-11-20", next: "2026-12-11" });
  });

  it("before the first clear-out, a date that passed after the first add is overdue, for families too", () => {
    const file = list(1, "2026-11-20T18:00:00Z");
    const settings = startingSettings(new Date(), null);
    expect(clearOutPlan("2026-12-14", [], file)).toEqual({ kind: "due", date: "2026-12-11", overdue: true });
    expect(nextClearOutFor(settings, file, new Date("2026-12-14T18:00:00Z"))).toEqual({ date: "2026-12-11", overdue: true });
    // Nothing on the list, or nothing until after that date: not overdue.
    expect(nextClearOutFor(settings, emptyItemsFile(), new Date("2026-12-14T18:00:00Z"))).toEqual({ date: "2027-01-08", overdue: false });
    expect(clearOutPlan("2026-12-14", [], list(1, "2026-12-12T18:00:00Z"))).toEqual({ kind: "extra", date: "2026-12-14", next: "2027-01-08" });
    expect(countingFrom(file)).toEqual({ date: "2026-11-20", done_at: "2026-11-20T18:00:00.000Z" });
  });

  it("before the first clear-out, counts only from items still in the bin, not removed ones or undone test adds", () => {
    const file = list(2, "2026-11-02T18:00:00Z");
    file.items[0].added_at = "2026-11-20T18:00:00.000Z";
    file.items[1].status = "removed";
    file.items[1].removed_reason = "add undone";
    expect(countingFrom(file)).toEqual({ date: "2026-11-20", done_at: "2026-11-20T18:00:00.000Z" });
    expect(clearOutPlan("2026-11-21", [], file)).toEqual({ kind: "extra", date: "2026-11-21", next: "2026-12-11" });
  });

  it("after one ran early for a coming date, another waits until that date has passed", () => {
    const file = { ...emptyItemsFile(), last_clear_out: { date: "2026-12-11", done_at: "2026-12-09T20:00:00Z" } };
    expect(clearOutPlan("2026-12-10", [], file)).toEqual({ kind: "done", date: "2026-12-11", ranOn: "2026-12-09" });
    expect(clearOutPlan("2026-12-14", [], file)).toEqual({ kind: "extra", date: "2026-12-14", next: "2027-01-08" });
  });

  it("follows a move", () => {
    expect(clearOutPlan("2026-12-14", [moved("2026-12-11", "2026-12-16")], list(1))).toEqual({ kind: "due", date: "2026-12-16", overdue: false });
  });
});

describe("the coming dates", () => {
  it("lists moves where they moved to, skips where they were, and an overdue date first", () => {
    const rows = comingDates("2026-12-14", [moved("2027-01-08", "2027-01-15"), skipped("2027-02-12")], list(1, "2026-11-20T18:00:00Z"), 4);
    expect(rows.map((r) => [r.scheduled, r.date, r.change, r.byName, r.overdue, r.next])).toEqual([
      ["2026-12-11", "2026-12-11", null, null, true, true],
      ["2027-01-08", "2027-01-15", "moved", "Dana", false, false],
      ["2027-02-12", null, "skipped", "Sam", false, false],
      ["2027-03-12", "2027-03-12", null, null, false, false],
    ]);
  });

  it("shows only the latest of several overdue dates: one clear-out covers them all", () => {
    const rows = comingDates("2026-12-20", [], list(1, "2026-11-01T18:00:00Z"), 1);
    expect(rows.map((r) => [r.scheduled, r.overdue, r.next])).toEqual([["2026-12-11", true, true]]);
  });

  it("keeps an overdue date that was skipped, so the skip can be undone", () => {
    const settings = startingSettings(new Date(), null);
    const file = list(1, "2026-11-01T18:00:00Z");
    expect(skipClearOut(settings, file, { scheduled: "2026-11-13", today: "2026-11-20", byName: "Sam" })).toEqual({ ok: true });
    const rows = comingDates("2026-11-20", settings.clear_out_changes, file, 1);
    expect(rows[0]).toMatchObject({ scheduled: "2026-11-13", date: null, change: "skipped", overdue: false });
    expect(nextClearOutFor(settings, file, new Date("2026-11-20T18:00:00Z"))).toEqual({ date: "2026-12-11", overdue: false });
    expect(putBackClearOut(settings, file, { scheduled: "2026-11-13", today: "2026-11-20" })).toEqual({ ok: true });
    expect(nextClearOutFor(settings, file, new Date("2026-11-20T18:00:00Z"))).toEqual({ date: "2026-11-13", overdue: true });
  });

  it("offers Move from where each date is now, within what moveClearOut takes", () => {
    const file = list(1, "2026-11-01T18:00:00Z");
    const today = "2026-11-20";
    const rows = comingDates(today, [moved("2027-01-08", "2027-01-15")], file, 4);
    const ranges = rows.map((row) => [row.scheduled, moveRange(row, today, file)]);
    expect(ranges).toEqual([
      // Overdue: from today on.
      ["2026-11-13", { min: "2026-11-20", max: "2026-12-10", start: "2026-11-20" }],
      ["2026-12-11", { min: "2026-11-20", max: "2027-01-07", start: "2026-12-11" }],
      ["2027-01-08", { min: "2026-12-12", max: "2027-02-04", start: "2027-01-15" }],
      ["2027-02-12", { min: "2027-01-16", max: "2027-03-11", start: "2027-02-12" }],
    ]);
    for (const row of rows) {
      const range = moveRange(row, today, file)!;
      for (const to of [range.min, range.max]) {
        const settings = startingSettings(new Date(), null);
        const outcome = moveClearOut(settings, file, { scheduled: row.scheduled, to, today, byName: "Dana" });
        // Only a clash with another clear-out's day can refuse a day in range.
        if (!outcome.ok) expect(outcome.error).toMatch(/already a clear-out/);
      }
    }
    // Over four weeks after its date, an overdue date has no day left to move to.
    const late = comingDates("2026-12-11", [skipped("2026-12-11")], file, 0).find((r) => r.scheduled === "2026-11-13")!;
    expect(late.overdue).toBe(true);
    expect(moveRange(late, "2026-12-11", file)).toBeNull();
  });

  it("drops dates a clear-out covered", () => {
    const file = { ...emptyItemsFile(), last_clear_out: { date: "2026-12-11", done_at: "2026-12-14T20:00:00Z" } };
    expect(comingDates("2026-12-14", [], file, 3).map((r) => r.scheduled)).toEqual(["2027-01-08", "2027-02-12"]);
  });
});

describe("moving and skipping dates", () => {
  const today = "2026-12-07";
  const file = list(1);
  let settings: Settings;
  beforeEach(() => {
    settings = startingSettings(new Date(), null);
  });

  it("moves a date; moving it back to its Friday puts it back", () => {
    expect(moveClearOut(settings, file, { scheduled: "2026-12-11", to: "2026-12-16", today, byName: "Dana" })).toEqual({ ok: true });
    expect(settings.clear_out_changes).toEqual([{ date: "2026-12-11", change: "moved", moved_to: "2026-12-16", note: null, by_name: "Dana" }]);
    expect(upcomingClearOut(today, settings.clear_out_changes, countingFrom(file))?.date).toBe("2026-12-16");
    expect(moveClearOut(settings, file, { scheduled: "2026-12-11", to: "2026-12-11", today, byName: "Dana" })).toEqual({ ok: true });
    expect(settings.clear_out_changes).toEqual([]);
  });

  it.each([
    ["not a clear-out date", "2026-12-12", "2026-12-16", /isn't coming up/],
    ["not a real day", "2026-12-11", "2026-02-30", /Pick a date/],
    ["in the past", "2026-12-11", "2026-12-04", /from today on/],
    ["too far", "2026-12-11", "2027-01-09", /within four weeks of Fri, Dec 11/],
  ])("refuses a move %s", (_, scheduled, to, error) => {
    expect(moveClearOut(settings, file, { scheduled, to, today, byName: "Dana" })).toEqual({ ok: false, error: expect.stringMatching(error) });
    expect(settings.clear_out_changes).toEqual([]);
  });

  it("refuses a move onto another clear-out, or onto a day the last one covered", () => {
    expect(moveClearOut(settings, file, { scheduled: "2027-01-08", to: "2026-12-16", today, byName: "Dana" })).toEqual({ ok: true });
    expect(moveClearOut(settings, file, { scheduled: "2026-12-11", to: "2026-12-16", today, byName: "Dana" })).toEqual({
      ok: false,
      error: "There's already a clear-out on Wed, Dec 16.",
    });
    // December's moved to the 18th and ran early, on the 16th: the 17th and 18th are covered.
    const early = { ...file, last_clear_out: { date: "2026-12-18", done_at: "2026-12-16T20:00:00Z" } };
    expect(moveClearOut(startingSettings(new Date(), null), early, { scheduled: "2027-01-08", to: "2026-12-18", today: "2026-12-17", byName: "Dana" })).toEqual({
      ok: false,
      error: "Pick a date after the last clear-out, Fri, Dec 18.",
    });
  });

  it("skips a date and puts it back; a date a clear-out covered can't change", () => {
    expect(skipClearOut(settings, file, { scheduled: "2026-12-11", today, byName: "Sam" })).toEqual({ ok: true });
    expect(upcomingClearOut(today, settings.clear_out_changes, countingFrom(file))?.date).toBe("2027-01-08");
    expect(putBackClearOut(settings, file, { scheduled: "2026-12-11", today })).toEqual({ ok: true });
    expect(settings.clear_out_changes).toEqual([]);
    const done = { ...file, last_clear_out: { date: "2026-12-11", done_at: "2026-12-11T20:00:00Z" } };
    expect(skipClearOut(settings, done, { scheduled: "2026-12-11", today: "2026-12-11", byName: "Sam" })).toMatchObject({ ok: false });
  });
});

describe("closing the list", () => {
  it("donates what's available, closes open claims as picked up, keeps removed ones, and archives them all without photos", () => {
    const file = bin();
    const before = structuredClone(file);
    const now = new Date("2026-12-11T22:00:00Z");
    const closed = closeList(file, { date: "2026-12-11", adminId: ADMIN, adminName: "Dana", run: RUN }, now);
    expect(file).toEqual(before);
    expect(closed.summary).toEqual({ date: "2026-12-11", done_at: now.toISOString(), done_by_name: "Dana", donated: 1, picked_up: 1, removed: 1, run: RUN });
    expect(closed.archive.items.map((i) => [i.id, i.status, i.photo, i.thumb])).toEqual([
      ["L-0001", "donated", null, null],
      ["L-0002", "claimed", null, null],
      ["L-0003", "removed", null, null],
    ]);
    expect(closed.archive.items[0]).toMatchObject({ donated_at: now.toISOString(), updated_by: ADMIN });
    expect("previous_photo" in closed.archive.items[0] || "client_ref" in closed.archive.items[0]).toBe(false);
    expect(closed.archive.items[1].claims[0]).toMatchObject({ status: "picked up", ended_at: now.toISOString(), ended_by: ADMIN });
    expect(closed.archive.items[2].claims[0].status).toBe("not found");
    // Every photo and thumbnail, and the one kept for Undo.
    expect(closed.photos).toHaveLength(8);
    expect(closed.next).toEqual({
      version: 1,
      next_number: 4,
      last_clear_out: { date: "2026-12-11", done_at: now.toISOString(), run: RUN },
      clear_outs: [closed.summary],
      items: [],
    });
  });
});

describe("running a clear-out", () => {
  async function setUp(t: ReturnType<typeof testDeps>, file = bin()) {
    await changeItems(t.deps, (current) => {
      Object.assign(current, file);
      return { value: current, result: null };
    });
    const names = file.items.flatMap((item) => [item.photo, item.thumb, ...(item.previous_photo ? [item.previous_photo.photo, item.previous_photo.thumb] : [])]);
    for (const name of names) await t.store.put(`photos/${name}`, new Uint8Array([1]));
    return names;
  }

  const input = { adminId: ADMIN, adminName: "Dana", expectedDate: "2026-12-11", changes: [] };

  it("archives under its date, starts the list over and deletes every old photo, but not one still uploading", async () => {
    const t = testDeps();
    await setUp(t);
    const stray = photoNames();
    await t.store.put(`photos/${stray.photo}`, new Uint8Array([1]));
    t.advance(2 * HOUR);
    const uploading = photoNames();
    await t.store.put(`photos/${uploading.photo}`, new Uint8Array([1]));

    const result = await runClearOut(t.deps, input);
    expect(result).toEqual({ ok: true, summary: expect.objectContaining({ date: "2026-12-11", donated: 1, picked_up: 1, removed: 1 }), photosLeft: 0 });
    const now = await loadItems(t.deps, { fresh: true });
    expect(now).toMatchObject({ items: [], next_number: 4, last_clear_out: { date: "2026-12-11" }, clear_outs: [expect.objectContaining({ donated: 1 })] });
    expect(await t.store.list("photos/")).toEqual([`photos/${uploading.photo}`]);
    expect(await t.store.list("archive/")).toEqual([archiveKey("2026-12-11")]);
    expect((await readArchive(t.deps, "2026-12-11"))?.items).toHaveLength(3);

    // The family's My items shows the claim as picked up.
    const mine = myItemsView(now, await lastArchive(t.deps, now), PHONE_B, t.deps.now());
    expect(mine.pickedUp.map((c) => c.itemId)).toEqual(["L-0002"]);
    const actions = await Promise.all((await t.store.list("activity/")).map(async (key) => JSON.parse(decode((await t.store.get(key))!.body))));
    expect(actions).toEqual([expect.objectContaining({ action: "cleared_out", actor: ADMIN, detail: { date: "2026-12-11", donated: 1, picked_up: 1, removed: 1 } })]);
  });

  it("does nothing on a second tap, or when the date it counts for isn't the one shown", async () => {
    const t = testDeps();
    await setUp(t);
    expect(await runClearOut(t.deps, { ...input, expectedDate: "2027-01-08" })).toEqual({ ok: false, reason: "changed" });
    expect((await loadItems(t.deps, { fresh: true })).items).toHaveLength(3);
    expect((await runClearOut(t.deps, input)).ok).toBe(true);
    expect(await runClearOut(t.deps, input)).toEqual({ ok: false, reason: "done" });
    expect((await loadItems(t.deps, { fresh: true })).clear_outs).toHaveLength(1);
  });

  it("starts again from the new list when something changes on it partway, so the archive has it", async () => {
    const base = memoryObjectStore();
    const t = testDeps({ store: racingStore(base, ITEMS_KEY, 0) });
    await setUp(t);
    // Just before the reset is saved, someone adds an item.
    const busier = await loadItems(t.deps, { fresh: true });
    addItem(busier, { type: "Hoodie", color: "Red", has_name: false, ...photoNames(), phoneId: PHONE_A, name: "Volunteer" }, t.deps.now());
    const racing = racingStore(base, ITEMS_KEY, 1, JSON.stringify(busier));
    const r = testDeps({ store: racing });

    expect((await runClearOut(r.deps, input)).ok).toBe(true);
    expect((await readArchive(r.deps, "2026-12-11"))?.items.map((i) => i.id)).toEqual(["L-0001", "L-0002", "L-0003", "L-0004"]);
    expect(await base.list("archive/")).toEqual([archiveKey("2026-12-11")]);
    expect((await loadItems(r.deps, { fresh: true })).next_number).toBe(5);
  });

  it("if it stops after the reset, it's logged, the pending archive still answers, and the tidy-up finishes it", async () => {
    const inner = memoryObjectStore();
    let fail = true;
    const store: ObjectStore = {
      ...inner,
      async put(key, body, options) {
        if (key === archiveKey("2026-12-11") && fail) {
          fail = false;
          throw new Error("network down");
        }
        return inner.put(key, body, options);
      },
    };
    const t = testDeps({ store });
    await setUp(t);
    await expect(runClearOut(t.deps, input)).rejects.toThrow("network down");
    const logged = await Promise.all((await inner.list("activity/")).map(async (key) => JSON.parse(decode((await inner.get(key))!.body)).action));
    expect(logged).toEqual(["cleared_out"]);

    const now = await loadItems(t.deps, { fresh: true });
    expect(now.items).toEqual([]);
    const run = now.last_clear_out?.run;
    expect(run).toMatch(/^[0-9a-f]{16}$/);
    expect(await inner.list("archive/")).toEqual([pendingArchiveKey(run!)]);
    expect((await lastArchive(t.deps, now))?.items).toHaveLength(3);
    expect(await runClearOut(t.deps, input)).toEqual({ ok: false, reason: "done" });

    await tidyBucket(t.deps, { force: true });
    expect(await inner.list("archive/")).toEqual([archiveKey("2026-12-11")]);
    // The photos the run didn't get to go too (they're long past the hour).
    expect(await inner.list("photos/")).toEqual([]);
  });

  it("says how many photos are left when deletions fail, and later admin pages delete them", async () => {
    let failing = true;
    const t = testDeps();
    const names = await setUp(t);
    const store = t.store;
    const flaky: ObjectStore = { ...store, delete: async (key) => (failing && /[0-9a-f]{32}\.jpg$/.test(key) ? Promise.reject(new Error("R2 down")) : store.delete(key)) };
    const r = { ...t.deps, store: flaky };
    const result = await runClearOut(r, input);
    // Four photos (not thumbnails) failed twice; nothing is counted twice.
    expect(result).toMatchObject({ ok: true, photosLeft: 4 });
    expect((await store.list("photos/")).length).toBe(4);
    failing = false;
    // A later admin page, once they're over an hour old (as any photo uploading at the time would be by then).
    t.advance(2 * HOUR);
    await tidyBucket(r, { force: true });
    expect(await store.list("photos/")).toEqual([]);
    expect(names).toHaveLength(8);
  });

  it("the tidy-up deletes a failed run's pending archive after an hour, but names a finished run's", async () => {
    const t = testDeps();
    await setUp(t);
    // A run that failed before its reset left this behind.
    await t.store.put(pendingArchiveKey("aaaaaaaaaaaaaaaa"), new TextEncoder().encode("{}"));
    // A finished run whose archive never got its name, from an earlier clear-out still in the history.
    const earlier = closeList(list(1, "2026-10-01T18:00:00Z"), { date: "2026-10-09", adminId: ADMIN, adminName: "Dana", run: "bbbbbbbbbbbbbbbb" }, new Date("2026-10-09T22:00:00Z"));
    await t.store.put(pendingArchiveKey("bbbbbbbbbbbbbbbb"), new TextEncoder().encode(JSON.stringify(earlier.archive)));
    await changeItems(t.deps, (file) => ({ value: { ...file, clear_outs: [earlier.summary] }, result: null }));
    await tidyBucket(t.deps, { force: true });
    expect((await t.store.list("archive/")).sort()).toEqual([archiveKey("2026-10-09"), pendingArchiveKey("aaaaaaaaaaaaaaaa")]);
    t.advance(2 * HOUR);
    await tidyBucket(t.deps);
    expect(await t.store.list("archive/")).toEqual([archiveKey("2026-10-09")]);
    // At most every ten minutes per server, unless forced.
    await t.store.put(pendingArchiveKey("cccccccccccccccc"), new TextEncoder().encode("{}"));
    t.advance(2 * HOUR);
    await tidyBucket(t.deps);
    t.advance(5 * 60 * 1000);
    await tidyBucket(t.deps);
    expect(await t.store.list("archive/pending/")).toEqual([]);
  });

  it("two servers running it at once: one clears out, the other is told it's done", async () => {
    const store = memoryObjectStore();
    const a = testDeps({ store });
    await setUp(a);
    const b = testDeps({ store });
    const results = await Promise.all([runClearOut(a.deps, input), runClearOut(b.deps, input)]);
    expect(results.map((r) => (r.ok ? "ok" : r.reason)).sort()).toEqual(["done", "ok"]);
    expect(await store.list("archive/")).toEqual([archiveKey("2026-12-11")]);
    expect((await loadItems(a.deps, { fresh: true })).clear_outs).toHaveLength(1);
  });

  it("the orphan sweep leaves photos the list uses", async () => {
    const t = testDeps();
    const names = await setUp(t);
    t.advance(2 * HOUR);
    expect(await sweepOrphanPhotos(t.deps)).toEqual([]);
    expect((await t.store.list("photos/")).sort()).toEqual(names.map((n) => `photos/${n}`).sort());
  });
});

describe("old phones", () => {
  it("forgets phones not seen in a year", async () => {
    const t = testDeps();
    await setDeviceName(t.deps, PHONE_A, "Long gone");
    t.advance(400 * DAY);
    await setDeviceName(t.deps, PHONE_B, "Still here");
    expect(await forgetOldPhones(t.deps)).toBe(1);
    expect(await t.store.list("devices/")).toEqual([deviceKey(PHONE_B)]);
  });
});

describe("CSVs", () => {
  it("can't be turned into a formula, quotes what needs it, and shows phone codes, never phone IDs", () => {
    const file = list(2);
    file.items[1].added_by_name = 'Lee, "Rm 12"';
    claimItem(file, { itemId: "L-0001", phoneId: PHONE_B, name: '=HYPERLINK("http://x","click")', claimId: "c-0000000001" }, new Date("2026-12-02T18:00:00Z"));
    const csv = itemsCsv(file.items);
    expect(csv.startsWith("﻿Item,Status,Type,Color,Has a name,Added,")).toBe(true);
    expect(csv).toContain(`"'=HYPERLINK(""http://x"",""click"")"`);
    expect(csv).toContain(`"Lee, ""Rm 12"""`);
    expect(csv).toContain(`L-0001,Claimed,Jacket,Navy,No,2026-12-01 10:00,Volunteer,${phoneCode(PHONE_A)},`);
    expect(csv).toContain(phoneCode(PHONE_B));
    expect(csv).not.toContain(PHONE_A);
    expect(csv).not.toContain(PHONE_B);
    expect(csv.split("\r\n")).toHaveLength(4);
  });

  it("says how each archived item ended", () => {
    const closed = closeList(bin(), { date: "2026-12-11", adminId: ADMIN, adminName: "Dana", run: RUN }, new Date("2026-12-11T22:00:00Z"));
    const rows = itemsCsv(closed.archive.items).split("\r\n").slice(1, 4);
    expect(rows.map((row) => row.split(",")[1])).toEqual(["Donated", "Picked up", "Removed"]);
    // Archived items carry the admin's phone ID (ended_by, updated_by) and the families': none reach the CSV.
    const csv = itemsCsv(closed.archive.items);
    for (const id of [PHONE_A, PHONE_B, ADMIN]) expect(csv).not.toContain(id);
    expect(rows[2]).toContain("Not in the bin");
  });
});

describe("types and colors", () => {
  let settings: Settings;
  beforeEach(() => {
    settings = startingSettings(new Date(), null);
  });

  it("adds one at the end, refusing a name that's there already in any case", () => {
    expect(addEntry(settings, "types", { name: "  Umbrella  " })).toEqual({ ok: true, changed: true, renamed: null });
    expect(activeTypes(settings).at(-1)).toBe("Umbrella");
    expect(addEntry(settings, "types", { name: "umbrella" })).toEqual({ ok: false, error: "There's already a type called “Umbrella”." });
    expect(addEntry(settings, "types", { name: "x".repeat(41) })).toMatchObject({ ok: false });
    expect(addEntry(settings, "colors", { name: "Teal", swatch: "#00aaaa" })).toMatchObject({ ok: true });
    expect(settings.colors.at(-1)).toMatchObject({ name: "Teal", swatch: "#00AAAA", active: true });
    expect(addEntry(settings, "colors", { name: "Mauve", swatch: "url(x)" })).toEqual({ ok: false, error: "Pick the swatch's color." });
  });

  it("renames one, items on the list follow, and a retried rename still reports it", () => {
    const change = { name: "Hat/Gloves", newName: "Hats & gloves", active: true };
    expect(editEntry(settings, "types", change)).toEqual({ ok: true, changed: true, renamed: { from: "Hat/Gloves", to: "Hats & gloves" } });
    expect(editEntry(settings, "types", change)).toEqual({ ok: true, changed: false, renamed: { from: "Hat/Gloves", to: "Hats & gloves" } });
    expect(editEntry(settings, "types", { name: "Shirt", newName: "jacket", active: true })).toEqual({ ok: false, error: "There's already a type called “Jacket”." });
    const file = list(2, undefined, "Hat/Gloves");
    expect(renameOnList(file, "types", "Hat/Gloves", "Hats & gloves")).toBe(2);
    expect(file.items.map((i) => i.type)).toEqual(["Hats & gloves", "Hats & gloves"]);
  });

  it("hides one, but always keeps one showing", () => {
    expect(editEntry(settings, "colors", { name: "Tan", newName: "Tan", swatch: "#D2B48C", active: false })).toMatchObject({ ok: true, changed: true });
    expect(activeColors(settings).map((c) => c.name)).not.toContain("Tan");
    for (const type of settings.types.slice(1)) type.active = false;
    expect(editEntry(settings, "types", { name: "Jacket", newName: "Jacket", active: false })).toEqual({ ok: false, error: "Keep at least one type showing." });
  });

  it("reorders, keeping any it wasn't given in their place after", () => {
    expect(reorderEntries(settings, "types", ["Other", "Jacket", "Nope"])).toMatchObject({ ok: true, changed: true });
    expect(activeTypes(settings).slice(0, 4)).toEqual(["Other", "Jacket", "Shirt", "Hoodie"]);
    expect(reorderEntries(settings, "types", "Other")).toMatchObject({ ok: false });
  });

  it("cleans the bin description", () => {
    expect(cleanBinDescription("  by the   main office.  ")).toBe("by the main office");
    expect(cleanBinDescription("  ")).toBeNull();
    expect(cleanBinDescription("x".repeat(121))).toBeNull();
  });
});

describe("the actions and downloads", () => {
  let t: ReturnType<typeof testDeps>;

  async function asPhone(phoneId: string) {
    h.jar.clear();
    h.jar.set(PHONE_COOKIE, phoneId);
    h.jar.set(CODE_COOKIE, schoolCodeProof(phoneId, await loadSettings(t.deps)));
  }

  beforeEach(async () => {
    t = testDeps();
    h.deps.current = t;
    const changed = await changeSchoolCode(t.deps, "otters");
    if (!changed.ok) throw new Error(changed.error);
    await becomeAdmin(t.deps, ADMIN, changed.settings, "Dana K.");
    await changeItems(t.deps, (file) => {
      Object.assign(file, bin());
      return { value: file, result: null };
    });
    await asPhone(ADMIN);
  });

  it("refuse a phone that isn't an admin", async () => {
    await asPhone(PHONE_B);
    for (const result of [
      await clearOutAction("2026-12-11"),
      await moveClearOutAction("2026-12-11", "2026-12-16"),
      await skipClearOutAction("2026-12-11"),
      await putBackClearOutAction("2026-12-11"),
      await addTagAction("types", "Umbrella"),
      await editTagAction("types", "Jacket", { newName: "Coat", active: true }),
      await reorderTagsAction("types", ["Other"]),
    ]) {
      expect(result).toMatchObject({ ok: false, message: expect.stringMatching(/isn't an admin/) });
    }
    expect((await saveBinDescriptionAction({}, form({ bin: "by the gym" }))).error).toMatch(/isn't an admin/);
    expect((await loadItems(t.deps, { fresh: true })).items).toHaveLength(3);
    const response = await itemsCsvRoute();
    expect(response.status).toBe(403);
  });

  it("clear out, say what happened, and refuse a second tap", async () => {
    expect(await clearOutAction("2026-12-11")).toEqual({
      ok: true,
      message: "Cleared out: 1 item donated, 1 claim closed as picked up. All their photos are deleted.",
    });
    expect(await clearOutAction("2026-12-11")).toEqual({ ok: false, message: "That clear-out has already been done." });
    expect(h.jar.has("lf_fresh")).toBe(true);
  });

  it("download the current list and a past clear-out's items", async () => {
    const current = await itemsCsvRoute();
    expect(current.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(current.headers.get("content-disposition")).toBe('attachment; filename="lost-and-found-2026-12-07.csv"');
    expect(current.headers.get("cache-control")).toBe("private, no-store");
    expect((await current.text()).split("\r\n")).toHaveLength(5);

    const route = (file: string) => archiveCsvRoute(new NextRequest(`http://localhost/admin/clear-out/${file}`), { params: Promise.resolve({ file }) });
    expect((await route("2026-12-11.csv")).status).toBe(404);
    await clearOutAction("2026-12-11");
    const past = await route("2026-12-11.csv");
    expect(past.status).toBe(200);
    expect(await past.text()).toContain("L-0002,Picked up,");
    expect((await route("../items.json")).status).toBe(404);
  });

  it("move, skip and put back a date, logging each", async () => {
    expect(await moveClearOutAction("2026-12-11", "2026-12-16")).toEqual({ ok: true });
    expect((await loadSettings(t.deps)).clear_out_changes).toEqual([{ date: "2026-12-11", change: "moved", moved_to: "2026-12-16", note: null, by_name: "Dana K." }]);
    expect(await skipClearOutAction("2027-01-08")).toEqual({ ok: true });
    expect(await putBackClearOutAction("2026-12-11")).toEqual({ ok: true });
    expect(await moveClearOutAction("2026-12-11", "2027-02-01")).toEqual({ ok: false, message: "Pick a date within four weeks of Fri, Dec 11." });
    expect((await loadSettings(t.deps)).clear_out_changes.map((c) => c.date)).toEqual(["2027-01-08"]);
    const logged = await Promise.all((await t.store.list("activity/")).map(async (key) => JSON.parse(decode((await t.store.get(key))!.body)).action));
    expect(logged.sort()).toEqual(["clear_out_moved", "clear_out_put_back", "clear_out_skipped"]);
  });

  it("rename a type, and the items on the list follow", async () => {
    expect(await editTagAction("types", "Jacket", { newName: "Coat", active: true })).toEqual({ ok: true, message: "3 items are now tagged “Coat”." });
    expect((await loadItems(t.deps, { fresh: true })).items.map((i) => i.type)).toEqual(["Coat", "Coat", "Coat"]);
    expect(activeTypes(await loadSettings(t.deps))).toContain("Coat");
    expect(await addTagAction("colors", "Teal", "#008080")).toEqual({ ok: true });
    expect(await addTagAction("planets", "Mars")).toMatchObject({ ok: false });
  });

  it("Fix tags keeps a type an admin hid on the items that have it, but won't give it to others", async () => {
    await changeItems(t.deps, (file) => {
      file.items[1].type = "Lunch box";
      return { value: file, result: null };
    });
    expect(await editTagAction("types", "Lunch box", { newName: "Lunch box", active: false })).toEqual({ ok: true });
    const settings = await loadSettings(t.deps);
    expect(tagChoices(settings, { type: "Lunch box", color: "Navy" }).types.at(-1)).toBe("Lunch box");
    expect(tagChoices(settings, { type: "Jacket", color: "Navy" }).types).not.toContain("Lunch box");
    // L-0002 is a lunch box: its other tags can change.
    expect(await changeTagsAction("L-0002", { type: "Lunch box", color: "Navy", has_name: true })).toEqual({ ok: true });
    expect((await loadItems(t.deps, { fresh: true })).items[1]).toMatchObject({ type: "Lunch box", has_name: true });
    expect(await changeTagsAction("L-0001", { type: "Lunch box", color: "Navy", has_name: false })).toEqual({ ok: false, message: "Pick a type from the list." });
  });

  it("save where the bin is", async () => {
    expect(await saveBinDescriptionAction({}, form({ bin: " in the gym lobby. " }))).toMatchObject({ saved: "Saved." });
    expect((await loadSettings(t.deps)).bin_description).toBe("in the gym lobby");
    expect((await saveBinDescriptionAction({}, form({ bin: "" }))).error).toMatch(/Say where the bin is/);
  });
});

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}
