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
import { foldTotals } from "@/server/totals";

/*
 * Clear-outs (spec section 7). On the day, volunteers empty the bin and an
 * admin taps *Clear out*: available items become donated, open claims close
 * as picked up, the list starts over empty, and every photo from before goes.
 * Nothing here runs on a timer.
 */

// --- Which date a clear-out counts for ---

/**
 * What the clear-out dates count from: the last clear-out, or before the
 * first one, the day the oldest item still in the bin (available or
 * claimed) was added. A date before that was before the bin had anything in
 * it, so it's never overdue; nor do removed items, or a test add someone
 * undid, make one overdue.
 */
export function countingFrom(file: ItemsFile): LastClearOut | null {
  if (file.last_clear_out) return file.last_clear_out;
  const first = file.items
    .filter((item) => item.status === "available" || item.status === "claimed")
    .reduce<string | null>((oldest, item) => (!oldest || item.added_at < oldest ? item.added_at : oldest), null);
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

/**
 * The clear-out dates still to do, for the next `months` months, plus the
 * overdue one (of several past dates, only the latest: one clear-out covers
 * them all), and a past date that was skipped, so its skip can be put back.
 */
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
    // A past date only counts once the bin has had something in it.
    const counts = from !== null;
    const overdue = date !== null && date < today && counts;
    if (overdue && date !== upcoming?.date) continue;
    if (when < today && !overdue && !(change?.change === "skipped" && counts)) continue;
    rows.push({ scheduled, date, change: change?.change ?? null, byName: change?.by_name ?? null, overdue, next: date !== null && date === upcoming?.date });
  }
  return rows.sort((a, b) => (a.date ?? a.scheduled).localeCompare(b.date ?? b.scheduled));
}

/** How far from its second Friday a date can move: less than the shortest gap between two of them. */
export const MOVE_DAYS = 27;

export type DateChange = { ok: true } | { ok: false; error: string };

const NOT_COMING = "That clear-out isn't coming up any more. Reload to see the dates.";

/** The row for `scheduled` among the coming dates: only those can change. */
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

/**
 * The days *Move* offers for a row, and where the picker starts (the date
 * it's due on now): from today on, within MOVE_DAYS of its second Friday,
 * and after the last clear-out. Null when no day fits.
 */
export function moveRange(row: ComingDate, today: string, file: ItemsFile): { min: string; max: string; start: string } | null {
  const offset = (days: number) => dayFromNumber(dayNumber(row.scheduled) + days);
  const through = doneThrough(file.last_clear_out);
  const min = [today, offset(-MOVE_DAYS), ...(through ? [dayFromNumber(dayNumber(through) + 1)] : [])].sort().at(-1)!;
  const max = offset(MOVE_DAYS);
  if (min > max) return null;
  const now = row.date ?? row.scheduled;
  return { min, max, start: now < min ? min : now > max ? max : now };
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
  const summary: ClearOutSummary = { date: input.date, done_at: at, done_by_name: input.adminName, donated, picked_up: pickedUp, removed, run: input.run };
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
    // The totals keep counting across clear-outs: this list's items go into their stored part.
    totals: foldTotals(file, items),
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

    // From here on it has happened, whatever stops the rest: log it now.
    await logActivity(deps, {
      actor: input.adminId,
      as_admin: true,
      action: "cleared_out",
      detail: { date: plan.date, donated: closed.summary.donated, picked_up: closed.summary.picked_up, removed: closed.summary.removed },
    });
    await nameArchive(deps, closed.archive, run);
    // A deletion that fails is tried once more now, then by tidyBucket after later admin pages.
    const failed = await deletePhotos(deps, await deletePhotos(deps, closed.photos));
    const strays = await sweepOrphanPhotos(deps, new Set(failed)).catch(() => []);
    return { ok: true, summary: closed.summary, photosLeft: failed.length + strays.length };
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

/** Deletes photo files, a few at a time. Says which couldn't be deleted. */
async function deletePhotos(deps: Deps, names: readonly string[]): Promise<string[]> {
  const failed: string[] = [];
  await forEachLimited(names.filter(isPhotoName), 8, async (name) => {
    await deps.store.delete(photoKey(name)).catch(() => {
      failed.push(name);
    });
  });
  return failed;
}

/**
 * A photo uploaded within this long might belong to an add that's still on
 * its way: the photo is saved before the item is put on the list. The same
 * goes for a pending archive: its run may still be going.
 */
export const ORPHAN_MIN_AGE_MS = 60 * 60 * 1000;

/**
 * Deletes photo files the list doesn't point at: ones an earlier deletion
 * missed (deletions are best effort), apart from `skip`. Says which
 * couldn't be deleted.
 */
export async function sweepOrphanPhotos(deps: Deps, skip: ReadonlySet<string> = new Set()): Promise<string[]> {
  // List first, then read the list: a photo saved in between is either on the list by then or too new to touch.
  const listed = await deps.store.listObjects("photos/");
  const inUse = photosInUse(await loadItems(deps, { fresh: true }));
  const cutoff = deps.now().getTime() - ORPHAN_MIN_AGE_MS;
  const orphans = listed
    .map((object) => ({ name: object.key.slice("photos/".length), modified: object.modified }))
    .filter(({ name, modified }) => isPhotoName(name) && !inUse.has(name) && !skip.has(name) && modified.getTime() < cutoff)
    .map(({ name }) => name);
  return deletePhotos(deps, orphans);
}

/** How often admin pages tidy up after them, per server. */
const TIDY_EVERY_MS = 10 * 60 * 1000;
const lastTidy = new WeakMap<object, number>();

/**
 * Tidies up after clear-outs and *Undo*s; admin pages run it after they
 * render, at most every ten minutes per server (the *Clear out* tab every
 * time):
 * - a finished run's archive that's still pending (the run stopped after
 *   resetting the list) gets its date's name;
 * - any other pending archive over an hour old (a run that failed before
 *   resetting the list) is deleted;
 * - photo files the list doesn't point at, over an hour old, are deleted:
 *   ones a clear-out's deletions missed, or an *Undo*'s.
 */
export async function tidyBucket(deps: Deps, { force = false }: { force?: boolean } = {}): Promise<void> {
  const now = deps.now().getTime();
  if (!force && now - (lastTidy.get(deps.store) ?? -Infinity) < TIDY_EVERY_MS) return;
  lastTidy.set(deps.store, now);
  const file = await loadItems(deps, { fresh: true });
  const finished = new Set([file.last_clear_out?.run, ...(file.clear_outs ?? []).map((c) => c.run)].filter(Boolean));
  for (const { key, modified } of await deps.store.listObjects("archive/pending/")) {
    const run = /^archive\/pending\/([0-9a-f]{16})\.json$/.exec(key)?.[1];
    if (!run) continue;
    if (finished.has(run)) {
      const archive = await deps.docs.read(key, archiveSchema);
      if (archive) await nameArchive(deps, archive, run);
    } else if (now - modified.getTime() > ORPHAN_MIN_AGE_MS) {
      await deps.store.delete(key);
    }
  }
  await sweepOrphanPhotos(deps);
}

/** The clear-outs so far, newest first. */
export function pastClearOuts(file: ItemsFile): ClearOutSummary[] {
  return [...(file.clear_outs ?? [])].reverse();
}
