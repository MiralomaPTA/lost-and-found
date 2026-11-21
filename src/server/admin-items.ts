import { openClaim, photosInUse, PHOTO_UNDO_MS, type AdminRemoveReason, type Claim, type Item, type ItemsFile } from "@/server/items";

/**
 * Admins' changes to items (spec section 6), as pure changes to the list, so
 * they run inside a safe write. Each one that the spec gives an *Undo* bar
 * has an exact reverse, which only applies while nothing else has happened
 * to the item since.
 */

export type AdminChange = { ok: true; item: Item; closedClaim?: Claim } | { ok: false; reason: "gone" | "changed" | "late" };

function find(file: ItemsFile, itemId: string): Item | undefined {
  return file.items.find((item) => item.id === itemId);
}

function touch(item: Item, adminId: string, at: string) {
  item.updated_at = at;
  item.updated_by = adminId;
}

/**
 * *Remove*, with a reason. A claimed item's open claim closes too (the family
 * sees "Removed by an admin" in My items).
 */
export function removeItem(file: ItemsFile, input: { itemId: string; adminId: string; reason: AdminRemoveReason }, now: Date): AdminChange {
  const item = find(file, input.itemId);
  if (!item || (item.status !== "available" && item.status !== "claimed")) return { ok: false, reason: "gone" };
  const at = now.toISOString();
  const claim = openClaim(item);
  if (claim) {
    claim.status = "undone";
    claim.ended_at = at;
    claim.ended_by = input.adminId;
    claim.closed_by_removal = true;
  }
  item.status = "removed";
  item.removed_at = at;
  item.removed_by = input.adminId;
  item.removed_reason = input.reason;
  touch(item, input.adminId, at);
  return { ok: true, item, closedClaim: claim };
}

/**
 * *Undo* right after *Remove*: back as it was, with the family's claim
 * reopened if the removal closed one.
 */
export function undoRemoval(file: ItemsFile, input: { itemId: string; adminId: string }, now: Date): AdminChange {
  const item = find(file, input.itemId);
  if (!item || item.status !== "removed" || item.removed_by !== input.adminId) return { ok: false, reason: "changed" };
  const closed = item.claims.find((c) => c.status === "undone" && c.closed_by_removal && c.ended_at === item.removed_at && c.ended_by === input.adminId);
  if (closed) {
    closed.status = "open";
    closed.ended_at = null;
    closed.ended_by = null;
    delete closed.closed_by_removal;
  }
  item.status = closed ? "claimed" : "available";
  item.removed_at = null;
  item.removed_by = null;
  item.removed_reason = null;
  touch(item, input.adminId, now.toISOString());
  return { ok: true, item };
}

/**
 * *Restore*: a removed item goes back on the grid, until the next clear-out
 * (spec section 6). Used for items reported missing that turn up. Closed
 * claims stay closed; the family can claim it again.
 */
export function restoreItem(file: ItemsFile, input: { itemId: string; adminId: string }, now: Date): AdminChange {
  const item = find(file, input.itemId);
  if (!item || item.status !== "removed") return { ok: false, reason: "gone" };
  item.status = "available";
  item.removed_at = null;
  item.removed_by = null;
  item.removed_reason = null;
  touch(item, input.adminId, now.toISOString());
  return { ok: true, item };
}

/** *Undo claim*, with a note the family sees in My items. The item goes back on the grid. */
export function undoClaimAsAdmin(file: ItemsFile, input: { itemId: string; claimId: string; adminId: string; note: string | null }, now: Date): AdminChange {
  const item = find(file, input.itemId);
  const claim = item?.claims.find((c) => c.id === input.claimId);
  if (!item || !claim) return { ok: false, reason: "gone" };
  if (claim.status !== "open" || item.status !== "claimed") return { ok: false, reason: "changed" };
  const at = now.toISOString();
  claim.status = "undone";
  claim.ended_at = at;
  claim.ended_by = input.adminId;
  claim.note = input.note;
  item.status = "available";
  touch(item, input.adminId, at);
  return { ok: true, item };
}

/** *Undo* right after *Undo claim*: the claim opens again, while nobody has claimed the item since. */
export function reopenClaim(file: ItemsFile, input: { itemId: string; claimId: string; adminId: string }, now: Date): AdminChange {
  const item = find(file, input.itemId);
  const claim = item?.claims.find((c) => c.id === input.claimId);
  if (!item || !claim) return { ok: false, reason: "gone" };
  const latest = item.claims[item.claims.length - 1];
  if (claim.status !== "undone" || claim.ended_by !== input.adminId || item.status !== "available" || latest !== claim) return { ok: false, reason: "changed" };
  claim.status = "open";
  claim.ended_at = null;
  claim.ended_by = null;
  claim.note = null;
  item.status = "claimed";
  touch(item, input.adminId, now.toISOString());
  return { ok: true, item };
}

export type PhotoSwap = { ok: true; item: Item; unused: string[]; changed: boolean } | { ok: false; reason: "gone" | "changed" | "late" };

/** Of `names`, the files nothing on the list points at any more, which can be deleted. */
function unusedOf(file: ItemsFile, names: string[]): string[] {
  const inUse = photosInUse(file);
  return names.filter((name) => !inUse.has(name));
}

/**
 * *Replace photo*. The old photo is kept (for *Undo*); one kept from an
 * earlier replacement is no longer needed. `unused` lists the photo files
 * to delete once the change is saved. Replacing with the photo it already
 * has changes nothing, so running it twice is harmless.
 */
export function replacePhoto(file: ItemsFile, input: { itemId: string; adminId: string; photo: string; thumb: string }, now: Date): PhotoSwap {
  const item = find(file, input.itemId);
  if (!item || item.status === "donated") return { ok: false, reason: "gone" };
  if (item.photo === input.photo) return { ok: true, item, unused: [], changed: false };
  const older = item.previous_photo ? [item.previous_photo.photo, item.previous_photo.thumb] : [];
  item.previous_photo = { photo: item.photo, thumb: item.thumb, replaced_at: now.toISOString() };
  item.photo = input.photo;
  item.thumb = input.thumb;
  touch(item, input.adminId, now.toISOString());
  return { ok: true, item, unused: unusedOf(file, older), changed: true };
}

/**
 * *Undo* right after *Replace photo*: the old photo comes back, and the new
 * one is no longer needed. `photo` names the replacement being undone.
 */
export function undoPhotoReplace(file: ItemsFile, input: { itemId: string; adminId: string; photo: string }, now: Date): PhotoSwap {
  const item = find(file, input.itemId);
  if (!item) return { ok: false, reason: "gone" };
  if (!item.previous_photo || item.photo !== input.photo) return { ok: false, reason: "changed" };
  if (now.getTime() - Date.parse(item.previous_photo.replaced_at) > PHOTO_UNDO_MS) return { ok: false, reason: "late" };
  const replaced = [item.photo, item.thumb];
  item.photo = item.previous_photo.photo;
  item.thumb = item.previous_photo.thumb;
  delete item.previous_photo;
  touch(item, input.adminId, now.toISOString());
  return { ok: true, item, unused: unusedOf(file, replaced), changed: true };
}

/** The *Undo* bar for the replacement that brought in `photo` has gone: the photo it replaced can be deleted. */
export function forgetPreviousPhoto(file: ItemsFile, input: { itemId: string; photo: string }): PhotoSwap {
  const item = find(file, input.itemId);
  if (!item?.previous_photo || item.photo !== input.photo) return { ok: false, reason: "changed" };
  const older = [item.previous_photo.photo, item.previous_photo.thumb];
  delete item.previous_photo;
  return { ok: true, item, unused: unusedOf(file, older), changed: true };
}
