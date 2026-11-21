import type { ClearOutSummary, Item, ItemsFile, ItemsTotals } from "@/server/items";

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
 * - **Claimed:** items claimed and kept, including a claimed item an admin
 *   removed as returned in person. Unclaimed, undone and "It wasn't there"
 *   claims put the item back or take it off the list, so they don't count.
 * - **Donated:** items given away at a clear-out.
 */

export const TOTAL_NAMES = ["posted", "claimed", "donated"] as const;
export type TotalName = (typeof TOTAL_NAMES)[number];
export type Totals = Record<TotalName, number>;

/** What Settings and its answers call each one. */
export const TOTAL_LABELS: Record<TotalName, string> = { posted: "Items posted", claimed: "Claimed", donated: "Donated" };

export const isTotalName = (value: unknown): value is TotalName => typeof value === "string" && (TOTAL_NAMES as readonly string[]).includes(value);

/** The reasons an item comes off the list because it shouldn't have been posted. */
const NOT_POSTED: ReadonlySet<string> = new Set(["add undone", "duplicate or mistake"]);

type Counted = Pick<Item, "status" | "removed_reason" | "added_at" | "donated_at" | "claims">;
type Stored = ItemsTotals & { clear_outs_counted: number };

/** What a past clear-out's summary says it added. They don't say which removals were mistakes, so every item counts as posted. */
function fromSummary(summary: ClearOutSummary): Totals {
  return { posted: summary.donated + summary.picked_up + summary.removed, claimed: summary.picked_up, donated: summary.donated };
}

/**
 * The stored part of each total. A file from before totals starts from what
 * its past clear-outs recorded; a clear-out run since by a server from before
 * totals (during a deploy, or after a rollback) is added from its summary, so
 * its list isn't lost.
 */
function stored(file: ItemsFile): Stored {
  const past = file.clear_outs ?? [];
  const totals: ItemsTotals = file.totals ?? { posted: { base: 0, since: null }, claimed: { base: 0, since: null }, donated: { base: 0, since: null } };
  const counted = file.totals ? (totals.clear_outs_counted ?? past.length) : 0;
  const next: Stored = { ...totals, posted: { ...totals.posted }, claimed: { ...totals.claimed }, donated: { ...totals.donated }, clear_outs_counted: past.length };
  for (const summary of past.slice(counted)) {
    const add = fromSummary(summary);
    for (const name of TOTAL_NAMES) {
      const since = next[name].since;
      if (since === null || Date.parse(summary.done_at) > Date.parse(since)) next[name].base += add[name];
    }
  }
  return next;
}

/** When the claim that counts for the item was made: one keeping it claimed, or one an admin closed by removing it as returned in person. */
function keptClaimAt(item: Counted): string | null {
  const kept =
    item.status === "claimed"
      ? item.claims.findLast((claim) => claim.status === "open" || claim.status === "picked up")
      : item.status === "removed" && item.removed_reason === "returned in person"
        ? item.claims.findLast((claim) => claim.closed_by_removal)
        : undefined;
  return kept?.claimed_at ?? null;
}

/** What these items add to each total, counting only what happened after that total's reset. */
function counted(items: readonly Counted[], totals: ItemsTotals): Totals {
  const since = (at: string | null, reset: string | null) => at !== null && (reset === null || Date.parse(at) > Date.parse(reset));
  return {
    posted: items.filter((i) => !(i.status === "removed" && i.removed_reason && NOT_POSTED.has(i.removed_reason)) && since(i.added_at, totals.posted.since)).length,
    claimed: items.filter((i) => since(keptClaimAt(i), totals.claimed.since)).length,
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

/**
 * At a clear-out: the closing list's items, as the clear-out leaves them, go
 * into the stored part, since the next list starts empty. The clear-out adds
 * its own summary to `clear_outs`, so that one counts as done too.
 */
export function foldTotals(file: ItemsFile, closed: readonly Counted[]): ItemsTotals {
  const base = stored(file);
  const add = counted(closed, base);
  return {
    posted: { base: base.posted.base + add.posted, since: base.posted.since },
    claimed: { base: base.claimed.base + add.claimed, since: base.claimed.since },
    donated: { base: base.donated.base + add.donated, since: base.donated.since },
    clear_outs_counted: base.clear_outs_counted + 1,
  };
}

/** An admin's reset: that total starts again from 0 now. Returns the list to save and what the total was. */
export function resetTotal(file: ItemsFile, name: TotalName, now: Date): { next: ItemsFile; was: number } {
  const was = totalsOf(file)[name];
  return { next: { ...file, totals: { ...stored(file), [name]: { base: 0, since: now.toISOString() } } }, was };
}
