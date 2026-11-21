import type { Item, ItemsFile, ItemsTotals } from "@/server/items";

/**
 * Running totals of items posted, claimed and donated (spec: *Totals*),
 * shown on the code screen and in the footer.
 *
 * Each total is what it had reached before the current list started (kept in
 * items.json), plus what the current list adds. Adding and claiming cost no
 * extra writes: a clear-out folds the closing list into the stored part, and
 * an admin's reset sets one total back to 0 from that moment.
 *
 * - **Posted:** items added. An add taken back by the person who made it, or
 *   removed by an admin as a duplicate or mistake, doesn't count.
 * - **Claimed:** items claimed and kept. Unclaimed, undone and "It wasn't
 *   there" claims put the item back or take it off the list, so they don't count.
 * - **Donated:** items given away at a clear-out.
 */

export const TOTAL_NAMES = ["posted", "claimed", "donated"] as const;
export type TotalName = (typeof TOTAL_NAMES)[number];
export type Totals = Record<TotalName, number>;

export const isTotalName = (value: unknown): value is TotalName => typeof value === "string" && (TOTAL_NAMES as readonly string[]).includes(value);

/** The reasons an item comes off the list because it shouldn't have been posted. */
const NOT_POSTED: ReadonlySet<string> = new Set(["add undone", "duplicate or mistake"]);

type Counted = Pick<Item, "status" | "removed_reason" | "added_at" | "donated_at" | "claims">;

/** The stored part of each total. A file from before totals starts from what its past clear-outs recorded. */
function stored(file: ItemsFile): ItemsTotals {
  if (file.totals) return file.totals;
  const past = file.clear_outs ?? [];
  const sum = (pick: (summary: (typeof past)[number]) => number) => past.reduce((n, summary) => n + pick(summary), 0);
  return {
    // Those summaries don't say which removals were mistakes, so every item on those lists counts.
    posted: { base: sum((s) => s.donated + s.picked_up + s.removed), since: null },
    claimed: { base: sum((s) => s.picked_up), since: null },
    donated: { base: sum((s) => s.donated), since: null },
  };
}

/** When the claim that's keeping the item claimed was made. */
function keptClaimAt(item: Counted): string | null {
  const kept = item.claims.findLast((claim) => claim.status === "open" || claim.status === "picked up");
  return kept?.claimed_at ?? null;
}

/** What these items add to each total, counting only what happened since that total's reset. */
function counted(items: readonly Counted[], totals: ItemsTotals): Totals {
  const since = (at: string | null, reset: string | null) => at !== null && (reset === null || Date.parse(at) > Date.parse(reset));
  return {
    posted: items.filter((i) => !(i.status === "removed" && i.removed_reason && NOT_POSTED.has(i.removed_reason)) && since(i.added_at, totals.posted.since)).length,
    claimed: items.filter((i) => i.status === "claimed" && since(keptClaimAt(i), totals.claimed.since)).length,
    donated: items.filter((i) => i.status === "donated" && since(i.donated_at, totals.donated.since)).length,
  };
}

/** The totals as they stand. */
export function totalsOf(file: ItemsFile): Totals {
  const base = stored(file);
  const now = counted(file.items, base);
  return { posted: base.posted.base + now.posted, claimed: base.claimed.base + now.claimed, donated: base.donated.base + now.donated };
}

/** When each total was last reset, or null. */
export function totalsResetAt(file: ItemsFile): Record<TotalName, string | null> {
  const base = stored(file);
  return { posted: base.posted.since, claimed: base.claimed.since, donated: base.donated.since };
}

/** At a clear-out: the closing list's items, as the clear-out leaves them, go into the stored part, since the next list starts empty. */
export function foldTotals(file: ItemsFile, closed: readonly Counted[]): ItemsTotals {
  const base = stored(file);
  const add = counted(closed, base);
  return {
    posted: { base: base.posted.base + add.posted, since: base.posted.since },
    claimed: { base: base.claimed.base + add.claimed, since: base.claimed.since },
    donated: { base: base.donated.base + add.donated, since: base.donated.since },
  };
}

/** An admin's reset: that total starts again from 0 now. Returns the list to save and what the total was. */
export function resetTotal(file: ItemsFile, name: TotalName, now: Date): { next: ItemsFile; was: number } {
  const was = totalsOf(file)[name];
  return { next: { ...file, totals: { ...stored(file), [name]: { base: 0, since: now.toISOString() } } }, was };
}
