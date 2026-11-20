import { z } from "zod";
import type { Deps } from "@/server/deps";
import { itemNumber, itemSchema, type ItemsFile } from "@/server/items";

/**
 * archive/<date>.json: every item a clear-out closed, with its claims and the
 * counts, written once by that clear-out (the admin section's *Clear out*,
 * in a later pull request). The photos are gone by then.
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
  done_by: z.string(),
  donated_count: z.number().int().nonnegative(),
  picked_up_count: z.number().int().nonnegative(),
  items: z.array(archiveItemSchema),
});

export type Archive = z.infer<typeof archiveSchema>;
export type ArchivedItem = z.infer<typeof archiveItemSchema>;

const ARCHIVE_KEY = /^archive\/(\d{4}-\d{2}-\d{2})\.json$/;

export function archiveKey(date: string): string {
  return `archive/${date}.json`;
}

export async function readArchive(deps: Deps, date: string): Promise<Archive | null> {
  return deps.docs.read(archiveKey(date), archiveSchema);
}

/** The archive of the clear-out the current list started after, if there was one. */
export async function lastArchive(deps: Deps, file: ItemsFile): Promise<Archive | null> {
  return file.last_clear_out ? readArchive(deps, file.last_clear_out.date) : null;
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
  const dates = (await deps.store.list("archive/"))
    .map((key) => ARCHIVE_KEY.exec(key)?.[1])
    .filter((date): date is string => Boolean(date))
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
