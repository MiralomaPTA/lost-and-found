import { z } from "zod";
import type { Deps } from "@/server/deps";
import { CLEAR_OUT_RUN, itemNumber, itemSchema, type ItemsFile } from "@/server/items";

/**
 * archive/<date>.json: every item a clear-out closed, with its claims and the
 * counts, written once by that clear-out (see clear-out.ts). The photos are
 * gone by then.
 *
 * A run writes its archive as archive/pending/<run>.json first, resets the
 * list, and only then gives the archive its date's name. If it stops in
 * between, the pending copy still holds every item, and the list's
 * `last_clear_out.run` says which one it is.
 *
 * My items reads the last one for its *Picked up* claims, and an old link to
 * a cleared-out item is answered from them.
 */

export const archiveItemSchema = itemSchema.extend({
  photo: z.string().nullable(),
  thumb: z.string().nullable(),
});

export const archiveSchema = z.looseObject({
  version: z.literal(1),
  /** The clear-out date it counted for, YYYY-MM-DD. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  done_at: z.string(),
  /** The admin phone's ID. Like every phone ID, it never leaves the server. */
  done_by: z.string(),
  done_by_name: z.string().optional(),
  donated_count: z.number().int().nonnegative(),
  picked_up_count: z.number().int().nonnegative(),
  removed_count: z.number().int().nonnegative().optional(),
  run: z.string().optional(),
  items: z.array(archiveItemSchema),
});

export type Archive = z.infer<typeof archiveSchema>;
export type ArchivedItem = z.infer<typeof archiveItemSchema>;

const ARCHIVE_KEY = /^archive\/(\d{4}-\d{2}-\d{2})\.json$/;

export function archiveKey(date: string): string {
  return `archive/${date}.json`;
}

export function pendingArchiveKey(run: string): string {
  if (!CLEAR_OUT_RUN.test(run)) throw new Error("Not a clear-out run");
  return `archive/pending/${run}.json`;
}

export async function readArchive(deps: Deps, date: string): Promise<Archive | null> {
  return deps.docs.read(archiveKey(date), archiveSchema);
}

/**
 * The archive of the clear-out the current list started after, if there was
 * one: under its date, or still pending if that run stopped before naming it.
 */
export async function lastArchive(deps: Deps, file: ItemsFile): Promise<Archive | null> {
  const last = file.last_clear_out;
  if (!last) return null;
  const named = await readArchive(deps, last.date);
  if (named || !last.run) return named;
  return deps.docs.read(pendingArchiveKey(last.run), archiveSchema);
}

/**
 * Finds an item from before the last clear-out, for an ID that isn't on the
 * current list. Item numbers only go up and every item since the clear-out
 * is on the list, so an ID past the list's oldest one was never handed out
 * (or not yet), and the search can stop at the first archive whose items
 * are all older than the one wanted.
 */
export async function findArchivedItem(deps: Deps, file: ItemsFile, id: string): Promise<{ archive: Archive; item: ArchivedItem } | null> {
  const wanted = itemNumber(id);
  if (wanted >= file.next_number) return null;
  const oldestOnList = Math.min(...file.items.map((item) => itemNumber(item.id)));
  if (wanted >= oldestOnList) return null;
  // The last clear-out first: it's the likeliest, and it may still be pending.
  const last = await lastArchive(deps, file);
  if (last && last.items.length > 0) {
    const item = last.items.find((i) => i.id === id);
    if (item) return { archive: last, item };
    if (wanted > Math.max(...last.items.map((i) => itemNumber(i.id)))) return null;
  }
  const dates = (await deps.store.list("archive/"))
    .map((key) => ARCHIVE_KEY.exec(key)?.[1])
    .filter((date): date is string => Boolean(date) && date !== last?.date)
    .sort()
    .reverse();
  for (const date of dates) {
    const archive = await readArchive(deps, date);
    if (!archive || archive.items.length === 0) continue;
    const item = archive.items.find((i) => i.id === id);
    if (item) return { archive, item };
    const newest = Math.max(...archive.items.map((i) => itemNumber(i.id)));
    if (wanted > newest) return null;
  }
  return null;
}
