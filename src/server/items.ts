import { randomBytes } from "node:crypto";
import { z } from "zod";
import { pacificDate } from "@/lib/dates";
import { HEX32 } from "@/server/cookies";
import type { Deps } from "@/server/deps";
import type { Change } from "@/server/docs";
import { PHOTO_NAME, photoKey } from "@/server/photos";
import type { ObjectStore } from "@/server/storage/types";

/**
 * items.json: every item since the last clear-out, with its claims, plus the
 * next item number (spec: *Storage layout*). Every change is a safe write
 * through Docs.update.
 *
 * The records are loose objects: fields this version doesn't know about (a
 * newer deploy's, or Phase 2's AI tags) are kept when the file is rewritten,
 * so an old server finishing a request during a deploy can't strip them.
 *
 * The phone IDs in here (added_by, device_id, …) work like passwords. Pages
 * build their own views from these records and never pass them to the browser.
 */

export const ITEMS_KEY = "items.json";

export const ITEM_ID = /^L-\d{4,6}$/;
export const CLAIM_ID = /^c-[0-9a-f]{10}$/;
/** A random reference the phone makes for each add, so a retried upload can't add the item twice. */
export const CLIENT_REF = /^[0-9a-f]{32}$/;

/** How long the person who added an item can take it back off the list themselves (spec: *Fixing a mistake*). */
export const ADDER_UNDO_MS = 3 * 60 * 60 * 1000;

/**
 * How long an admin can undo *Replace photo*. The *Undo* bar goes after a few
 * seconds (longer while it's pointed at); after this, the old photo is
 * deleted by the next save of the list, whatever the admin's browser did.
 */
export const PHOTO_UNDO_MS = 10 * 60 * 1000;

export const CLAIM_STATUSES = ["open", "unclaimed", "undone", "not found", "picked up"] as const;
export const REMOVED_REASONS = ["returned in person", "gone from the bin", "duplicate or mistake", "thrown away", "other", "not in the bin", "add undone"] as const;
/** The reasons an admin picks from when removing an item (spec section 6). The others are set by the app. */
export const ADMIN_REMOVE_REASONS = ["returned in person", "gone from the bin", "duplicate or mistake", "thrown away", "other"] as const;
export type AdminRemoveReason = (typeof ADMIN_REMOVE_REASONS)[number];

const phoneId = z.string().regex(HEX32);
const moment = z.string().refine((value) => !Number.isNaN(Date.parse(value)), "Not a date");

export const claimSchema = z.looseObject({
  id: z.string().regex(CLAIM_ID),
  device_id: phoneId,
  /** The phone's name when it claimed. */
  name: z.string().max(60),
  claimed_at: moment,
  status: z.enum(CLAIM_STATUSES),
  ended_at: moment.nullable(),
  ended_by: phoneId.nullable(),
  /** An admin's note when they undo the claim, shown in My items. */
  note: z.string().max(300).nullable(),
  /** The claim closed because an admin removed the item (the family sees "Removed by an admin"). */
  closed_by_removal: z.boolean().optional(),
});

export const itemSchema = z.looseObject({
  id: z.string().regex(ITEM_ID),
  status: z.enum(["available", "claimed", "removed", "donated"]),
  type: z.string().min(1).max(40),
  color: z.string().min(1).max(40),
  has_name: z.boolean(),
  photo: z.string().regex(PHOTO_NAME),
  thumb: z.string().regex(PHOTO_NAME),
  added_by: phoneId,
  /** The phone's name when it added the item. */
  added_by_name: z.string().max(60),
  added_at: moment,
  updated_at: moment,
  updated_by: phoneId,
  removed_at: moment.nullable(),
  removed_by: phoneId.nullable(),
  removed_reason: z.enum(REMOVED_REASONS).nullable(),
  donated_at: moment.nullable(),
  claims: z.array(claimSchema),
  /** The phone's reference for the upload that added it (see CLIENT_REF). */
  client_ref: z.string().regex(CLIENT_REF).optional(),
  /**
   * The photo an admin just replaced, kept so *Undo* can bring it back. It's
   * deleted when the admin's *Undo* bar goes, by the next replacement, or by
   * the clear-out.
   */
  previous_photo: z.object({ photo: z.string().regex(PHOTO_NAME), thumb: z.string().regex(PHOTO_NAME), replaced_at: moment }).optional(),
});

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** A random ID for one run of the clear-out, which names its archive until the run finishes. */
export const CLEAR_OUT_RUN = /^[0-9a-f]{16}$/;

/** One past clear-out, as the *Clear out* tab lists it. */
export const clearOutSummarySchema = z.looseObject({
  /** The date it counted for, YYYY-MM-DD. */
  date: day,
  done_at: moment,
  /** The admin phone's name at the time. */
  done_by_name: z.string().max(60),
  donated: z.number().int().nonnegative(),
  picked_up: z.number().int().nonnegative(),
  removed: z.number().int().nonnegative(),
  /** The run that did it: how a pending archive is known to be a finished clear-out's. */
  run: z.string().regex(CLEAR_OUT_RUN).optional(),
});

export const itemsFileSchema = z.looseObject({
  version: z.literal(1),
  next_number: z.number().int().positive(),
  /**
   * The clear-out this list started after: the date it counted for (the date
   * it was due on, after any move, YYYY-MM-DD), when it actually ran, and
   * the run (see archives.ts).
   */
  last_clear_out: z.looseObject({ date: day, done_at: moment, run: z.string().regex(CLEAR_OUT_RUN).optional() }).nullable(),
  /** Every clear-out so far, oldest first. Each one carries the list forward to the next. */
  clear_outs: z.array(clearOutSummarySchema).optional(),
  items: z.array(itemSchema),
});

export type Claim = z.infer<typeof claimSchema>;
export type Item = z.infer<typeof itemSchema>;
export type ItemsFile = z.infer<typeof itemsFileSchema>;
export type ClearOutSummary = z.infer<typeof clearOutSummarySchema>;

export function emptyItemsFile(): ItemsFile {
  return { version: 1, next_number: 1, last_clear_out: null, items: [] };
}

/** The list as it is now, or an empty one before the first add. */
export async function loadItems(deps: Deps, { fresh = false }: { fresh?: boolean } = {}): Promise<ItemsFile> {
  return (await deps.docs.read(ITEMS_KEY, itemsFileSchema, { fresh })) ?? emptyItemsFile();
}

export function itemNumber(id: string): number {
  return Number(id.slice(2));
}

export function formatItemId(n: number): string {
  return `L-${String(n).padStart(4, "0")}`;
}

export function newClaimId(): string {
  return `c-${randomBytes(5).toString("hex")}`;
}

export function openClaim(item: Item): Claim | undefined {
  return item.claims.find((claim) => claim.status === "open");
}

// --- Writing ---

/** Every photo file the list still points at: current photos and ones kept for *Undo*. */
export function photosInUse(file: ItemsFile): Set<string> {
  return new Set(file.items.flatMap((item) => [item.photo, item.thumb, ...(item.previous_photo ? [item.previous_photo.photo, item.previous_photo.thumb] : [])]));
}

/** Drops replaced photos whose *Undo* time is over, and says which files can go. */
export function expirePreviousPhotos(file: ItemsFile, now: Date): string[] {
  const expired: string[] = [];
  for (const item of file.items) {
    if (item.previous_photo && now.getTime() - Date.parse(item.previous_photo.replaced_at) > PHOTO_UNDO_MS) {
      expired.push(item.previous_photo.photo, item.previous_photo.thumb);
      delete item.previous_photo;
    }
  }
  const inUse = photosInUse(file);
  return expired.filter((name) => !inUse.has(name));
}

const lastBackup = new WeakMap<ObjectStore, string>();
const encoder = new TextEncoder();

/**
 * A safe write to items.json. `change` gets a copy of the list (an empty one
 * before the first add) and may change it in place; returning a value saves
 * it. Like any Docs change it can run more than once, so it must only compute.
 *
 * The first write of each day also leaves `backups/items-<date>.json`, a copy
 * of the list as it was just before that write.
 */
export async function changeItems<R>(deps: Deps, change: (file: ItemsFile) => Change<ItemsFile, R>): Promise<R> {
  const today = pacificDate(deps.now());
  const backupDue = lastBackup.get(deps.store) !== today;
  let before: ItemsFile | null = null;
  let wrote = false;
  let expired: string[] = [];
  const result = await deps.docs.update(ITEMS_KEY, itemsFileSchema, (current) => {
    before = backupDue && current ? structuredClone(current) : null;
    const outcome = change(current ?? emptyItemsFile());
    wrote = outcome.value !== undefined;
    // Every save also lets go of replaced photos whose Undo time is over.
    expired = outcome.value ? expirePreviousPhotos(outcome.value, deps.now()) : [];
    return outcome;
  });
  if (wrote && backupDue) await backUp(deps, today, before);
  if (wrote && expired.length) await Promise.all(expired.map((name) => deps.store.delete(photoKey(name)).catch(() => undefined)));
  return result;
}

async function backUp(deps: Deps, today: string, before: ItemsFile | null): Promise<void> {
  if (!before) {
    // The very first write: there was nothing to back up.
    lastBackup.set(deps.store, today);
    return;
  }
  const key = `backups/items-${today}.json`;
  try {
    // If another server got there first, its copy stands.
    await deps.store.put(key, encoder.encode(JSON.stringify(before, null, 2) + "\n"), {
      contentType: "application/json",
      condition: { ifNoneMatch: "*" },
    });
    lastBackup.set(deps.store, today);
  } catch (error) {
    console.error(`Couldn't write ${key}`, error);
  }
}

/**
 * Saves the list if any replaced photo's *Undo* time is over, which lets
 * those photos go (see changeItems). Admin pages run it after they render,
 * so old photos go even if nothing else is saved for a while.
 */
export async function sweepReplacedPhotos(deps: Deps): Promise<void> {
  const now = deps.now();
  const due = (file: ItemsFile) => file.items.some((item) => item.previous_photo && now.getTime() - Date.parse(item.previous_photo.replaced_at) > PHOTO_UNDO_MS);
  if (!due(await loadItems(deps))) return;
  await changeItems(deps, (file) => (due(file) ? { value: file, result: null } : { result: null }));
}

// --- Changes. Each takes the list and changes it in place, so it can run inside changeItems. ---

export interface NewItem {
  type: string;
  color: string;
  has_name: boolean;
  photo: string;
  thumb: string;
  phoneId: string;
  /** The phone's name, recorded with the item. */
  name: string;
  clientRef?: string;
}

/** Adds an item at the top of the grid, with the next number. */
export function addItem(file: ItemsFile, input: NewItem, now: Date): Item {
  const at = now.toISOString();
  const item: Item = {
    id: formatItemId(file.next_number),
    status: "available",
    type: input.type,
    color: input.color,
    has_name: input.has_name,
    photo: input.photo,
    thumb: input.thumb,
    added_by: input.phoneId,
    added_by_name: input.name,
    added_at: at,
    updated_at: at,
    updated_by: input.phoneId,
    removed_at: null,
    removed_by: null,
    removed_reason: null,
    donated_at: null,
    claims: [],
    ...(input.clientRef ? { client_ref: input.clientRef } : {}),
  };
  file.next_number += 1;
  file.items.push(item);
  return item;
}

/** The item a phone already added with this upload reference, if any. */
export function addedWithRef(file: ItemsFile, phoneId: string, clientRef: string): Item | undefined {
  return file.items.find((item) => item.client_ref === clientRef && item.added_by === phoneId);
}

export type AdderUndo = { ok: true; item: Item } | { ok: false; reason: "gone" | "taken" | "late" };

/**
 * The adder's own *Undo*, from the add screens: the item comes off the list
 * as removed, "add undone". Only for the phone that added it, while nobody
 * has claimed it, and for a few hours (the add screens offer it only until
 * they're left; after that, only an admin can remove an item).
 */
export function undoAdd(file: ItemsFile, input: { itemId: string; phoneId: string }, now: Date): AdderUndo {
  const item = file.items.find((i) => i.id === input.itemId);
  if (!item || item.added_by !== input.phoneId || item.status === "removed" || item.status === "donated") return { ok: false, reason: "gone" };
  if (item.status === "claimed") return { ok: false, reason: "taken" };
  if (now.getTime() - Date.parse(item.added_at) > ADDER_UNDO_MS) return { ok: false, reason: "late" };
  const at = now.toISOString();
  item.status = "removed";
  item.removed_at = at;
  item.removed_by = input.phoneId;
  item.removed_reason = "add undone";
  item.updated_at = at;
  item.updated_by = input.phoneId;
  return { ok: true, item };
}

export interface Tags {
  type: string;
  color: string;
  has_name: boolean;
}

export type TagChange = { ok: true; item: Item; before: Tags; changed: boolean } | { ok: false; reason: "gone" };

/** *Fix tags* (spec section 5): anyone can change an item's type, color and *Has a name* while it's on the list. */
export function changeTags(file: ItemsFile, input: { itemId: string; phoneId: string; tags: Tags }, now: Date): TagChange {
  const item = file.items.find((i) => i.id === input.itemId);
  if (!item || (item.status !== "available" && item.status !== "claimed")) return { ok: false, reason: "gone" };
  const before: Tags = { type: item.type, color: item.color, has_name: item.has_name };
  const changed = before.type !== input.tags.type || before.color !== input.tags.color || before.has_name !== input.tags.has_name;
  if (changed) {
    item.type = input.tags.type;
    item.color = input.tags.color;
    item.has_name = input.tags.has_name;
    item.updated_at = now.toISOString();
    item.updated_by = input.phoneId;
  }
  return { ok: true, item, before, changed };
}

export type ClaimOutcome = { ok: true; claim: Claim; changed: boolean } | { ok: false; reason: "taken" | "gone" };

/**
 * "This is mine". Claiming an item this phone already has open is a success
 * that changes nothing, so a double tap or a retry is harmless.
 */
export function claimItem(file: ItemsFile, input: { itemId: string; phoneId: string; name: string; claimId: string }, now: Date): ClaimOutcome {
  const item = file.items.find((i) => i.id === input.itemId);
  if (!item) return { ok: false, reason: "gone" };
  if (item.status === "claimed") {
    const open = openClaim(item);
    return open?.device_id === input.phoneId ? { ok: true, claim: open, changed: false } : { ok: false, reason: "taken" };
  }
  if (item.status !== "available") return { ok: false, reason: "gone" };
  const at = now.toISOString();
  const claim: Claim = {
    id: input.claimId,
    device_id: input.phoneId,
    name: input.name,
    claimed_at: at,
    status: "open",
    ended_at: null,
    ended_by: null,
    note: null,
  };
  item.claims.push(claim);
  item.status = "claimed";
  item.updated_at = at;
  item.updated_by = input.phoneId;
  return { ok: true, claim, changed: true };
}

/**
 * Why a change to a phone's own claim didn't happen:
 * - `gone`: the item or the claim isn't on the list (or isn't this phone's).
 * - `ended`: an admin already undid the claim, or it was closed some other way.
 * - `changed`: the item changed since, so there's nothing to undo.
 * - `taken`: someone else claimed the item since.
 */
export type ClaimChange = { ok: true; item: Item; claim: Claim } | { ok: false; reason: "gone" | "ended" | "changed" | "taken" };

function ownClaim(file: ItemsFile, itemId: string, claimId: string, phoneId: string): { item: Item; claim: Claim } | null {
  const item = file.items.find((i) => i.id === itemId);
  const claim = item?.claims.find((c) => c.id === claimId);
  return item && claim && claim.device_id === phoneId ? { item, claim } : null;
}

/** The family's own *Unclaim* (or *Undo* on the card): the item goes back on the grid. */
export function unclaimItem(file: ItemsFile, input: { itemId: string; claimId: string; phoneId: string }, now: Date): ClaimChange {
  const found = ownClaim(file, input.itemId, input.claimId, input.phoneId);
  if (!found) return { ok: false, reason: "gone" };
  const { item, claim } = found;
  if (claim.status !== "open" || item.status !== "claimed") return { ok: false, reason: "ended" };
  const at = now.toISOString();
  claim.status = "unclaimed";
  claim.ended_at = at;
  claim.ended_by = input.phoneId;
  item.status = "available";
  item.updated_at = at;
  item.updated_by = input.phoneId;
  return { ok: true, item, claim };
}

/**
 * *Undo* after *Unclaim* in My items: reopens the same claim, so it keeps its
 * date and its place in the list. Only while nobody else has claimed the item
 * and nothing else has happened to it since.
 */
export function undoUnclaim(file: ItemsFile, input: { itemId: string; claimId: string; phoneId: string }, now: Date): ClaimChange {
  const found = ownClaim(file, input.itemId, input.claimId, input.phoneId);
  if (!found) return { ok: false, reason: "gone" };
  const { item, claim } = found;
  if (item.status === "claimed" && openClaim(item)?.device_id !== input.phoneId) return { ok: false, reason: "taken" };
  const latest = item.claims[item.claims.length - 1];
  const untouched = claim.status === "unclaimed" && claim.ended_by === input.phoneId && latest === claim && item.status === "available";
  if (!untouched) return { ok: false, reason: "changed" };
  claim.status = "open";
  claim.ended_at = null;
  claim.ended_by = null;
  item.status = "claimed";
  item.updated_at = now.toISOString();
  item.updated_by = input.phoneId;
  return { ok: true, item, claim };
}

/** *It wasn't there*: the claim closes and the item comes off the grid as removed, "not in the bin". */
export function markNotThere(file: ItemsFile, input: { itemId: string; claimId: string; phoneId: string }, now: Date): ClaimChange {
  const found = ownClaim(file, input.itemId, input.claimId, input.phoneId);
  if (!found) return { ok: false, reason: "gone" };
  const { item, claim } = found;
  if (claim.status !== "open" || item.status !== "claimed") return { ok: false, reason: "ended" };
  const at = now.toISOString();
  claim.status = "not found";
  claim.ended_at = at;
  claim.ended_by = input.phoneId;
  item.status = "removed";
  item.removed_at = at;
  item.removed_by = input.phoneId;
  item.removed_reason = "not in the bin";
  item.updated_at = at;
  item.updated_by = input.phoneId;
  return { ok: true, item, claim };
}

/** *Undo* after *It wasn't there*, as long as nobody (an admin) has done anything with the item since. */
export function undoNotThere(file: ItemsFile, input: { itemId: string; claimId: string; phoneId: string }, now: Date): ClaimChange {
  const found = ownClaim(file, input.itemId, input.claimId, input.phoneId);
  if (!found) return { ok: false, reason: "gone" };
  const { item, claim } = found;
  const untouched = claim.status === "not found" && item.status === "removed" && item.removed_reason === "not in the bin" && item.removed_by === input.phoneId;
  if (!untouched) return { ok: false, reason: "changed" };
  const at = now.toISOString();
  claim.status = "open";
  claim.ended_at = null;
  claim.ended_by = null;
  item.status = "claimed";
  item.removed_at = null;
  item.removed_by = null;
  item.removed_reason = null;
  item.updated_at = at;
  item.updated_by = input.phoneId;
  return { ok: true, item, claim };
}

/** Runs one of the claim changes as a safe write, saving only when it succeeded. */
export async function changeClaim(
  deps: Deps,
  apply: (file: ItemsFile, input: { itemId: string; claimId: string; phoneId: string }, now: Date) => ClaimChange,
  input: { itemId: string; claimId: string; phoneId: string },
): Promise<ClaimChange> {
  return changeItems<ClaimChange>(deps, (file) => {
    const outcome = apply(file, input, deps.now());
    return outcome.ok ? { value: file, result: outcome } : { result: outcome };
  });
}

export async function claim(deps: Deps, input: { itemId: string; phoneId: string; name: string }): Promise<ClaimOutcome> {
  const claimId = newClaimId();
  return changeItems<ClaimOutcome>(deps, (file) => {
    const outcome = claimItem(file, { ...input, claimId }, deps.now());
    return outcome.ok && outcome.changed ? { value: file, result: outcome } : { result: outcome };
  });
}
