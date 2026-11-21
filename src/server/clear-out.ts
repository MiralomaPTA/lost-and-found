import { randomBytes } from "node:crypto";
import {
  clearOutDates,
  daysUntil,
  doneThrough,
  REMINDER_DAYS,
  secondFriday,
  upcomingClearOut,
  type ClearOutChange,
  type LastClearOut,
} from "@/lib/clear-out";
import { dayFromNumber, dayLabel, dayNumber, pacificDate } from "@/lib/dates";
import { logActivity } from "@/server/activity";
import { archiveKey, archiveSchema, pendingArchiveKey, type Archive, type ArchivedItem } from "@/server/archives";
import type { Deps } from "@/server/deps";
import { ConflictError } from "@/server/docs";
import { changeItems, loadItems, openClaim, photosInUse, type ClearOutSummary, type ItemsFile } from "@/server/items";
import { isPhotoName, photoKey } from "@/server/photos";
import { forEachLimited } from "@/server/pool";
import type { Settings } from "@/server/settings";

/*
 * Clear-outs (spec section 7). On the day, volunteers empty the bin and an
 * admin taps *Clear out*: available items become donated, open claims close
 * as picked up, the list starts over empty, and every photo from before goes.
 * Nothing here runs on a timer.
 */

// --- Which date a clear-out counts for ---

/**
 * What the clear-out dates count from: the last clear-out, or before the
 * first one, the day the oldest item on the list was added. A date before
 * that was before the lost and found had anything in it, so it's never
 * overdue.
 */
export function countingFrom(file: ItemsFile): LastClearOut | null {
  if (file.last_clear_out) return file.last_clear_out;
  const first = file.items.reduce<string | null>((oldest, item) => (!oldest || item.added_at < oldest ? item.added_at : oldest), null);
  return first ? { date: pacificDate(first), done_at: first } : null;
}

export type ClearOutPlan =
  /** Due this week, or overdue: running it now counts for `date`. */
  | { kind: "due"; date: string; overdue: boolean }
  /** Nothing due this week: running it now is an extra one, for today, and `next` stays on the calendar. */
  | { kind: "extra"; date: string; next: string | null }
  /** One already ran today, or early for a date still to come: another can run once that's past. */
  | { kind: "done"; date: string; ranOn: string };

/** What tapping *Clear out* today would count for. */
export function clearOutPlan(today: string, changes: readonly ClearOutChange[], file: ItemsFile): ClearOutPlan {
  const upcoming = upcomingClearOut(today, changes, countingFrom(file));
  if (upcoming && (upcoming.overdue || daysUntil(today, upcoming.date) < REMINDER_DAYS)) return { kind: "due", date: upcoming.date, overdue: upcoming.overdue };
  const last = file.last_clear_out;
  const through = doneThrough(last);
  if (last && through && today <= through) return { kind: "done", date: last.date, ranOn: pacificDate(last.done_at) };
  return { kind: "extra", date: today, next: upcoming?.date ?? null };
}

// --- The coming dates, with Move, Skip and Put back ---

export interface ComingDate {
  /** The second Friday it's about, YYYY-MM-DD: what *Move*, *Skip* and *Put back* name. */
  scheduled: string;
  /** When it's due, after any move; null when skipped. */
  date: string | null;
  change: "moved" | "skipped" | null;
  byName: string | null;
  /** Past, and no clear-out has run since. */
  overdue: boolean;
  /** The one families are told about. */
  next: boolean;
}

/** The clear-out dates still to do, for the next `months` months, plus any overdue one. */
export function comingDates(today: string, changes: readonly ClearOutChange[], file: ItemsFile, months = 6): ComingDate[] {
  const [year, month] = today.split("-").map(Number);
  const from = countingFrom(file);
  const through = doneThrough(from);
  const upcoming = upcomingClearOut(today, changes, from);
  const rows: ComingDate[] = [];
  // From a month back: last month's date may be overdue, or moved into this one.
  for (let i = -1; i < months; i++) {
    const index = month - 1 + i;
    const scheduled = secondFriday(year + Math.floor(index / 12), (((index % 12) + 12) % 12) + 1);
    const change = changes.find((c) => c.date === scheduled);
    const date = change?.change === "skipped" ? null : change?.change === "moved" && change.moved_to ? change.moved_to : scheduled;
    const when = date ?? scheduled;
    if (through && when <= through) continue;
    const overdue = date !== null && date < today && from !== null;
    if (when < today && !overdue) continue;
    rows.push({ scheduled, date, change: change?.change ?? null, byName: change?.by_name ?? null, overdue, next: date !== null && date === upcoming?.date });
  }
  return rows.sort((a, b) => (a.date ?? a.scheduled).localeCompare(b.date ?? b.scheduled));
}

/** How far from its second Friday a date can move: less than the shortest gap between two of them. */
export const MOVE_DAYS = 27;

export type DateChange = { ok: true } | { ok: false; error: string };

const NOT_COMING = "That clear-out isn't coming up any more. Reload to see the dates.";

/** Finds the row for `scheduled` among the coming dates, or says why it can't change. */
function comingRow(settings: Settings, file: ItemsFile, scheduled: string, today: string): ComingDate | null {
  return comingDates(today, settings.clear_out_changes, file).find((row) => row.scheduled === scheduled) ?? null;
}

/** *Move*: the clear-out due on `scheduled` happens on `to` instead. Changes `settings` in place. */
export function moveClearOut(settings: Settings, file: ItemsFile, input: { scheduled: string; to: string; today: string; byName: string }): DateChange {
  if (!comingRow(settings, file, input.scheduled, input.today)) return { ok: false, error: NOT_COMING };
  if (!isRealDay(input.to)) return { ok: false, error: "Pick a date." };
  if (input.to < input.today) return { ok: false, error: "Pick a date from today on." };
  if (Math.abs(dayNumber(input.to) - dayNumber(input.scheduled)) > MOVE_DAYS) return { ok: false, error: `Pick a date within four weeks of ${dayLabel(input.scheduled)}.` };
  const through = doneThrough(file.last_clear_out);
  if (through && input.to <= through) return { ok: false, error: `Pick a date after the last clear-out, ${dayLabel(through)}.` };
  const others = settings.clear_out_changes.filter((c) => c.date !== input.scheduled);
  const [year, month] = input.scheduled.split("-").map(Number);
  const nearby = clearOutDates(month <= 2 ? { year: year - 1, month: month + 10 } : { year, month: month - 2 }, 5, others).filter((d) => d !== input.scheduled);
  if (nearby.includes(input.to)) return { ok: false, error: `There's already a clear-out on ${dayLabel(input.to)}.` };
  settings.clear_out_changes =
    input.to === input.scheduled ? others : [...others, { date: input.scheduled, change: "moved", moved_to: input.to, note: null, by_name: input.byName }];
  return { ok: true };
}

/** A YYYY-MM-DD calendar day that exists: "2026-02-30" would count as March 2, so it has to round-trip. */
function isRealDay(day: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && dayFromNumber(dayNumber(day)) === day;
}

/** *Skip*: no clear-out that month (school closed, summer). */
export function skipClearOut(settings: Settings, file: ItemsFile, input: { scheduled: string; today: string; byName: string }): DateChange {
  if (!comingRow(settings, file, input.scheduled, input.today)) return { ok: false, error: NOT_COMING };
  settings.clear_out_changes = [
    ...settings.clear_out_changes.filter((c) => c.date !== input.scheduled),
    { date: input.scheduled, change: "skipped", moved_to: null, note: null, by_name: input.byName },
  ];
  return { ok: true };
}

/** *Put back*: a moved or skipped date goes back to its second Friday. */
export function putBackClearOut(settings: Settings, file: ItemsFile, input: { scheduled: string; today: string }): DateChange {
  const row = comingRow(settings, file, input.scheduled, input.today);
  if (!row) return { ok: false, error: NOT_COMING };
  const through = doneThrough(file.last_clear_out);
  if (through && input.scheduled <= through) return { ok: false, error: `The last clear-out already covered ${dayLabel(input.scheduled)}.` };
  settings.clear_out_changes = settings.clear_out_changes.filter((c) => c.date !== input.scheduled);
  return { ok: true };
}

// --- Running it ---

export interface ClearOutCounts {
  /** Become donated. */
  available: number;
  /** Their claims close as picked up. */
  claimed: number;
  removed: number;
  /** Every item on the list: all of them lose their photos. */
  total: number;
}

export function clearOutCounts(file: ItemsFile): ClearOutCounts {
  const count = (status: string) => file.items.filter((item) => item.status === status).length;
  return { available: count("available"), claimed: count("claimed"), removed: count("removed"), total: file.items.length };
}

export interface ClosedList {
  archive: Archive;
  /** The list to save: empty, with the item numbers carrying on. */
  next: ItemsFile;
  /** Every photo file the old list pointed at. */
  photos: string[];
  summary: ClearOutSummary;
}

/**
 * The clear-out itself, worked out without saving anything: every available
 * item becomes donated, every open claim closes as picked up (its item stays
 * claimed, so it never counts as donated), and removed items stay removed.
 * All of them go into the archive, without their photos.
 */
export function closeList(file: ItemsFile, input: { date: string; adminId: string; adminName: string; run: string }, now: Date): ClosedList {
  const at = now.toISOString();
  const photos: string[] = [];
  let donated = 0;
  let pickedUp = 0;
  let removed = 0;
  const items: ArchivedItem[] = file.items.map((original) => {
    const item = structuredClone(original);
    photos.push(item.photo, item.thumb);
    if (item.previous_photo) photos.push(item.previous_photo.photo, item.previous_photo.thumb);
    if (item.status === "available") {
      item.status = "donated";
      item.donated_at = at;
      item.updated_at = at;
      item.updated_by = input.adminId;
      donated++;
    } else if (item.status === "claimed") {
      const claim = openClaim(item);
      if (claim) {
        claim.status = "picked up";
        claim.ended_at = at;
        claim.ended_by = input.adminId;
      }
      item.updated_at = at;
      item.updated_by = input.adminId;
      pickedUp++;
    } else if (item.status === "removed") {
      removed++;
    }
    // The photos are gone, and the upload reference is no use any more.
    const archived: ArchivedItem = { ...item, photo: null, thumb: null };
    delete archived.previous_photo;
    delete archived.client_ref;
    return archived;
  });
  const summary: ClearOutSummary = { date: input.date, done_at: at, done_by_name: input.adminName, donated, picked_up: pickedUp, removed };
  const archive: Archive = {
    version: 1,
    date: input.date,
    done_at: at,
    done_by: input.adminId,
    done_by_name: input.adminName,
    donated_count: donated,
    picked_up_count: pickedUp,
    removed_count: removed,
    run: input.run,
    items,
  };
  const next: ItemsFile = {
    ...file,
    version: 1,
    next_number: file.next_number,
    last_clear_out: { date: input.date, done_at: at, run: input.run },
    clear_outs: [...(file.clear_outs ?? []), summary],
    items: [],
  };
  return { archive, next, photos, summary };
}

export type ClearOutResult =
  | { ok: true; summary: ClearOutSummary; photosLeft: number }
  /** `done`: it already ran (a second tap). `changed`: the date it counts for isn't the one the admin was shown. */
  | { ok: false; reason: "done" | "changed" | "busy" };

const ATTEMPTS = 5;
const encoder = new TextEncoder();

function jsonBytes(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value, null, 2) + "\n");
}

/**
 * Runs the clear-out the admin confirmed, for `expectedDate` (the date the
 * *Clear out* tab showed them).
 *
 * The archive and the reset list are two files, and R2 can't save both at
 * once. So the archive goes first under a name of its own (pending), then
 * the list is reset only if it's exactly the list the archive was made from,
 * and only then does the archive get its date's name. If the list changed in
 * between (a family claimed something), it starts again from the new list.
 * If the run stops after the reset, the pending archive still has every item.
 */
export async function runClearOut(
  deps: Deps,
  input: { adminId: string; adminName: string; expectedDate: string; changes: readonly ClearOutChange[] },
): Promise<ClearOutResult> {
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const file = await loadItems(deps, { fresh: true });
    const now = deps.now();
    const plan = clearOutPlan(pacificDate(now), input.changes, file);
    if (file.last_clear_out?.date === input.expectedDate || plan.kind === "done") return { ok: false, reason: "done" };
    if (plan.date !== input.expectedDate) return { ok: false, reason: "changed" };

    const run = randomBytes(8).toString("hex");
    const closed = closeList(file, { date: plan.date, adminId: input.adminId, adminName: input.adminName, run }, now);
    const pending = pendingArchiveKey(run);
    await deps.store.put(pending, jsonBytes(archiveSchema.parse(closed.archive)), { contentType: "application/json" });
    const unchanged = JSON.stringify(file);
    let reset: boolean;
    try {
      reset = await changeItems<boolean>(deps, (current) => (JSON.stringify(current) === unchanged ? { value: closed.next, result: true } : { result: false }));
    } catch (error) {
      // Every try was refused, so the list wasn't reset and this archive is no one's.
      if (error instanceof ConflictError) {
        await deps.store.delete(pending).catch(() => undefined);
        continue;
      }
      // Anything else leaves it unclear whether the reset went through: keep the archive.
      throw error;
    }
    if (!reset) {
      await deps.store.delete(pending).catch(() => undefined);
      continue;
    }

    await nameArchive(deps, closed.archive, run);
    const photosLeft = (await deletePhotos(deps, closed.photos)) + (await sweepOrphanPhotos(deps).catch(() => 0));
    await logActivity(deps, {
      actor: input.adminId,
      as_admin: true,
      action: "cleared_out",
      detail: { date: plan.date, donated: closed.summary.donated, picked_up: closed.summary.picked_up, removed: closed.summary.removed },
    });
    return { ok: true, summary: closed.summary, photosLeft };
  }
  return { ok: false, reason: "busy" };
}

/** Gives a finished run's archive its date's name, then drops the pending copy. */
async function nameArchive(deps: Deps, archive: Archive, run: string): Promise<void> {
  const key = archiveKey(archive.date);
  const body = jsonBytes(archive);
  const put = await deps.store.put(key, body, { contentType: "application/json", condition: { ifNoneMatch: "*" } });
  if (!put.ok) {
    // Perhaps this very write, whose answer was lost. Anything else is another
    // clear-out's archive for the same date: keep both, and say so.
    const there = await deps.store.get(key);
    if (!there || new TextDecoder().decode(there.body) !== new TextDecoder().decode(body)) {
      console.error(`${key} already exists; this run's archive stays at ${pendingArchiveKey(run)}`);
      return;
    }
  }
  await deps.store.delete(pendingArchiveKey(run)).catch(() => undefined);
}

/**
 * Finishes a clear-out that stopped after resetting the list: names its
 * archive, and deletes the old photos the run didn't get to. The *Clear out*
 * tab runs this after it renders.
 */
export async function finishClearOut(deps: Deps): Promise<void> {
  const last = (await loadItems(deps)).last_clear_out;
  if (!last?.run) return;
  if (await deps.store.get(archiveKey(last.date))) return;
  const pending = await deps.docs.read(pendingArchiveKey(last.run), archiveSchema);
  if (!pending) return;
  await nameArchive(deps, pending, last.run);
  await sweepOrphanPhotos(deps);
}

/** Deletes photo files, a few at a time. Says how many couldn't be deleted. */
async function deletePhotos(deps: Deps, names: readonly string[]): Promise<number> {
  let failed = 0;
  await forEachLimited(names.filter(isPhotoName), 8, async (name) => {
    await deps.store.delete(photoKey(name)).catch(() => {
      failed++;
    });
  });
  return failed;
}

/**
 * A photo uploaded within this long might belong to an add that's still on
 * its way: the photo is saved before the item is put on the list.
 */
export const ORPHAN_MIN_AGE_MS = 60 * 60 * 1000;

/**
 * Deletes photo files the list doesn't point at: ones an earlier deletion
 * missed (deletions are best effort). Says how many couldn't be deleted.
 */
export async function sweepOrphanPhotos(deps: Deps): Promise<number> {
  // List first, then read the list: a photo saved in between is either on the list by then or too new to touch.
  const listed = await deps.store.listObjects("photos/");
  const inUse = photosInUse(await loadItems(deps, { fresh: true }));
  const cutoff = deps.now().getTime() - ORPHAN_MIN_AGE_MS;
  const orphans = listed
    .map((object) => ({ name: object.key.slice("photos/".length), modified: object.modified }))
    .filter(({ name, modified }) => isPhotoName(name) && !inUse.has(name) && modified.getTime() < cutoff)
    .map(({ name }) => name);
  return deletePhotos(deps, orphans);
}

/** The clear-outs so far, newest first. */
export function pastClearOuts(file: ItemsFile): ClearOutSummary[] {
  return [...(file.clear_outs ?? [])].reverse();
}
