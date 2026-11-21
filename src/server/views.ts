import { upcomingClearOut, type UpcomingClearOut } from "@/lib/clear-out";
import { ageLabel, dateLabel, daysBetween, pacificDate, relativeDayLabel, shortDate, shortDayLabel } from "@/lib/dates";
import { gridSearch, type GridQuery } from "@/lib/grid-query";
import { swatchOf, type Swatch } from "@/lib/swatch";
import type { Archive } from "@/server/archives";
import { countingFrom } from "@/server/clear-out";
import { type Item, type ItemsFile } from "@/server/items";
import { photoUrl } from "@/server/photos";
import type { Settings } from "@/server/settings";

/*
 * What the pages show, built on the server from items.json. These views carry
 * only what a family may see: no phone IDs, no names, no item numbers on show
 * (the number is only in the item page's address).
 */

const UNKNOWN_SWATCH = "#C9CED8";

export type { Swatch };

export function swatchFor(settings: Settings, colorName: string): Swatch {
  const color = settings.colors.find((c) => c.name === colorName);
  return color ? swatchOf(color.swatch) : { background: UNKNOWN_SWATCH, light: false };
}

/** "Navy jacket", for alt text. */
export function itemLabel(item: Pick<Item, "type" | "color">): string {
  return `${item.color} ${item.type.toLowerCase()}`;
}

/** The types and colors to filter and tag by, in the admins' order. */
export function activeTypes(settings: Settings): string[] {
  return settings.types.filter((t) => t.active).sort((a, b) => a.sort - b.sort).map((t) => t.name);
}

export function activeColors(settings: Settings): { name: string; swatch: Swatch }[] {
  return settings.colors
    .filter((c) => c.active)
    .sort((a, b) => a.sort - b.sort)
    .map((c) => ({ name: c.name, swatch: swatchFor(settings, c.name) }));
}

/**
 * The choices for *Fix tags* on one item: the types and colors on offer,
 * plus the item's own if an admin has since hidden it, so the item keeps it
 * while its other tags change.
 */
export function tagChoices(settings: Settings, current: { type: string; color: string }): { types: string[]; colors: { name: string; swatch: Swatch }[] } {
  const types = activeTypes(settings);
  const colors = activeColors(settings);
  return {
    types: types.includes(current.type) ? types : [...types, current.type],
    colors: colors.some((c) => c.name === current.color) ? colors : [...colors, { name: current.color, swatch: swatchFor(settings, current.color) }],
  };
}

/** The grid's list: available items, filtered, newest or oldest first. */
export function gridItems(file: ItemsFile, query: GridQuery, now: Date): Item[] {
  const list = file.items.filter(
    (item) =>
      item.status === "available" &&
      (!query.type || item.type === query.type) &&
      (!query.color || item.color === query.color) &&
      (!query.named || item.has_name) &&
      (!query.recent || daysBetween(item.added_at, now) < 7),
  );
  const direction = query.sort === "oldest" ? 1 : -1;
  return list.sort((a, b) => direction * (a.added_at.localeCompare(b.added_at) || a.id.localeCompare(b.id)));
}

export interface CardView {
  id: string;
  /** The item page, keeping the grid's sort and filters. */
  href: string;
  label: string;
  type: string;
  color: string;
  swatch: Swatch;
  hasName: boolean;
  age: string;
  thumb: string;
}

export function cardView(item: Item, settings: Settings, now: Date, query: GridQuery): CardView {
  return {
    id: item.id,
    href: `/items/${item.id}${gridSearch(query)}`,
    label: itemLabel(item),
    type: item.type,
    color: item.color,
    swatch: swatchFor(settings, item.color),
    hasName: item.has_name,
    age: ageLabel(item.added_at, now),
    thumb: photoUrl(item.thumb),
  };
}

/**
 * The clear-out families should plan for, for the header and the donation
 * reminder. Before the first clear-out, dates count from the first add, so
 * a first clear-out that slips shows as overdue too.
 */
export function nextClearOutFor(settings: Settings, file: ItemsFile, now: Date): UpcomingClearOut | null {
  return upcomingClearOut(pacificDate(now), settings.clear_out_changes, countingFrom(file));
}

/**
 * The items this phone has open claims on, by item ID (never the claim's
 * phone ID): the badge on *My items* and the pick-up reminder count them.
 */
export function openClaimItemIds(file: ItemsFile, phoneId: string | null): string[] {
  if (!phoneId) return [];
  return file.items.filter((item) => item.status === "claimed" && item.claims.some((c) => c.status === "open" && c.device_id === phoneId)).map((item) => item.id);
}

export function openClaimCount(file: ItemsFile, phoneId: string | null): number {
  return openClaimItemIds(file, phoneId).length;
}

// --- The item page ---

export type ItemPageView =
  | {
      kind: "on-list";
      card: CardView;
      photo: string;
      added: string;
      /** `mine`: this phone has it claimed; `claimed`: someone else does. */
      state: "available" | "mine" | "claimed";
      claimId: string | null;
      /** Where it sits in the grid's current list, if it's on it. */
      position: { index: number; total: number; prev: string | null; next: string | null } | null;
    }
  | { kind: "removed" }
  | { kind: "archived"; type: string; color: string; swatch: Swatch; hasName: boolean; added: string; donatedOn: string | null };

export function itemPageView(item: Item, file: ItemsFile, settings: Settings, phoneId: string | null, query: GridQuery, now: Date): ItemPageView {
  if (item.status === "removed" || item.status === "donated") return { kind: "removed" };
  const open = item.claims.find((c) => c.status === "open");
  const mine = Boolean(open && phoneId && open.device_id === phoneId);
  let position = null;
  if (item.status === "available") {
    const list = gridItems(file, query, now);
    const index = list.findIndex((i) => i.id === item.id);
    if (index >= 0) {
      const href = (i: Item | undefined) => (i ? `/items/${i.id}${gridSearch(query)}` : null);
      position = { index, total: list.length, prev: href(list[index - 1]), next: href(list[index + 1]) };
    }
  }
  return {
    kind: "on-list",
    card: cardView(item, settings, now, query),
    photo: photoUrl(item.photo),
    added: dateLabel(item.added_at),
    state: item.status === "available" ? "available" : mine ? "mine" : "claimed",
    claimId: mine && open ? open.id : null,
    position,
  };
}

export function archivedItemView(item: Archive["items"][number], settings: Settings): ItemPageView {
  if (item.status !== "donated" && item.status !== "claimed") return { kind: "removed" };
  return {
    kind: "archived",
    type: item.type,
    color: item.color,
    swatch: swatchFor(settings, item.color),
    hasName: item.has_name,
    added: dateLabel(item.added_at),
    donatedOn: item.status === "donated" && item.donated_at ? shortDate(item.donated_at) : null,
  };
}

// --- My items ---

export type MyClaimState = "claimed" | "not there" | "put back" | "removed" | "picked up";

export interface MyClaimView {
  itemId: string;
  claimId: string;
  label: string;
  /** "Jacket". */
  type: string;
  title: string;
  thumb: string | null;
  /** "Claimed today", "Claimed Thu, Dec 3". */
  claimed: string;
  claimedAt: string;
  state: MyClaimState;
  /** When the family said it wasn't there. */
  notThere: string | null;
  /** The admin's note when they put it back. */
  note: string | null;
  /** The item page, while the item is still on the list. */
  href: string | null;
}

export interface MyItemsView {
  current: MyClaimView[];
  /** Claims from before the last clear-out, assumed picked up. */
  pickedUp: MyClaimView[];
  /** "Nov 13", the clear-out they're from. */
  clearOutDate: string | null;
}

/**
 * This phone's claims, newest first (spec section 3). Claims the family
 * unclaimed themselves drop off; claims from before the last clear-out show
 * as picked up, without a photo.
 */
export function myItemsView(file: ItemsFile, archive: Archive | null, phoneId: string, now: Date): MyItemsView {
  const current: MyClaimView[] = [];
  for (const item of file.items) {
    for (const claim of item.claims) {
      if (claim.device_id !== phoneId || claim.status === "unclaimed") continue;
      // An admin closes a claim either by undoing it (the item goes back on the grid) or by removing the item.
      const removedWithIt = claim.status === "undone" && claim.closed_by_removal === true;
      const state: MyClaimState =
        claim.status === "open" ? "claimed" : claim.status === "not found" ? "not there" : removedWithIt ? "removed" : claim.status === "undone" ? "put back" : "picked up";
      current.push({
        itemId: item.id,
        claimId: claim.id,
        label: itemLabel(item),
        type: item.type,
        title: `${item.type} · ${item.color}`,
        thumb: photoUrl(item.thumb),
        claimed: `Claimed ${relativeDayLabel(claim.claimed_at, now)}`,
        claimedAt: claim.claimed_at,
        state,
        notThere: state === "not there" && claim.ended_at ? relativeDayLabel(claim.ended_at, now) : null,
        note: state === "put back" || state === "removed" ? claim.note : null,
        href: item.status === "available" || item.status === "claimed" ? `/items/${item.id}` : null,
      });
    }
  }
  const pickedUp: MyClaimView[] = [];
  for (const item of archive?.items ?? []) {
    for (const claim of item.claims) {
      if (claim.device_id !== phoneId || claim.status !== "picked up") continue;
      pickedUp.push({
        itemId: item.id,
        claimId: claim.id,
        label: itemLabel(item),
        type: item.type,
        title: `${item.type} · ${item.color}`,
        thumb: null,
        claimed: `Claimed ${relativeDayLabel(claim.claimed_at, now)}`,
        claimedAt: claim.claimed_at,
        state: "picked up",
        notThere: null,
        note: null,
        href: null,
      });
    }
  }
  const newestFirst = (a: MyClaimView, b: MyClaimView) => b.claimedAt.localeCompare(a.claimedAt);
  return {
    current: current.sort(newestFirst),
    pickedUp: pickedUp.sort(newestFirst),
    clearOutDate: archive ? shortDayLabel(archive.date) : null,
  };
}
