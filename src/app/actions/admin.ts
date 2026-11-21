"use server";

import { logActivity } from "@/server/activity";
import {
  forgetPreviousPhoto,
  removeItem,
  reopenClaim,
  restoreItem,
  undoClaimAsAdmin,
  undoPhotoReplace,
  undoRemoval,
  type AdminChange,
  type PhotoSwap,
} from "@/server/admin-items";
import type { Deps } from "@/server/deps";
import { getDeps } from "@/server/deps";
import { ConflictError } from "@/server/docs";
import { ADMIN_REMOVE_REASONS, CLAIM_ID, changeItems, ITEM_ID, type AdminRemoveReason, type ItemsFile } from "@/server/items";
import { isPhotoName, photoKey } from "@/server/photos";
import { currentAdmin } from "@/server/session";

/*
 * The admin section's changes (spec section 6). Every one checks, each time,
 * that the phone still holds the current admin code. Like the other
 * actions, these answer with a message rather than throwing.
 */

export type AdminResult = { ok: true } | { ok: false; message: string };

const NOT_ADMIN = "This phone isn't an admin any more. The admin code may have changed: enter the new one on the admin code page.";
const BUSY = "Lots of changes are happening at once. Try again.";
const MESSAGES = {
  gone: "This item isn't on the list any more.",
  changed: "This item has changed since, so that can't be done now. Reload to see where it stands.",
};

/** Deletes photo files no item uses any more. Best effort: a leftover file costs little. */
async function deletePhotos(deps: Deps, names: string[]) {
  await Promise.all(names.filter(isPhotoName).map((name) => deps.store.delete(photoKey(name)).catch(() => undefined)));
}

async function asAdmin(
  itemId: unknown,
  action: string,
  apply: (file: ItemsFile, adminId: string, now: Date) => AdminChange | PhotoSwap,
  detail?: Record<string, string>,
): Promise<AdminResult> {
  const admin = await currentAdmin();
  if (!admin) return { ok: false, message: NOT_ADMIN };
  if (typeof itemId !== "string" || !ITEM_ID.test(itemId)) return { ok: false, message: MESSAGES.gone };
  const deps = await getDeps();
  try {
    const outcome = await changeItems<AdminChange | PhotoSwap>(deps, (file) => {
      const result = apply(file, admin.phoneId, deps.now());
      return result.ok ? { value: file, result } : { result };
    });
    if (!outcome.ok) return { ok: false, message: MESSAGES[outcome.reason] };
    if ("unused" in outcome) await deletePhotos(deps, outcome.unused);
    await logActivity(deps, { actor: admin.phoneId, as_admin: true, action, item_id: itemId, ...(detail ? { detail } : {}) });
    return { ok: true };
  } catch (error) {
    if (error instanceof ConflictError) return { ok: false, message: BUSY };
    throw error;
  }
}

function cleanNote(note: unknown): string | null {
  if (typeof note !== "string") return null;
  const text = note.normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, 300);
  return text || null;
}

export async function removeItemAction(itemId: unknown, reason: unknown): Promise<AdminResult> {
  if (typeof reason !== "string" || !(ADMIN_REMOVE_REASONS as readonly string[]).includes(reason)) return { ok: false, message: "Pick a reason." };
  const why = reason as AdminRemoveReason;
  return asAdmin(itemId, "removed", (file, adminId, now) => removeItem(file, { itemId: itemId as string, adminId, reason: why }, now), { reason: why });
}

export async function undoRemovalAction(itemId: unknown): Promise<AdminResult> {
  return asAdmin(itemId, "removal_undone", (file, adminId, now) => undoRemoval(file, { itemId: itemId as string, adminId }, now));
}

export async function restoreItemAction(itemId: unknown): Promise<AdminResult> {
  return asAdmin(itemId, "restored", (file, adminId, now) => restoreItem(file, { itemId: itemId as string, adminId }, now));
}

export async function undoClaimAction(itemId: unknown, claimId: unknown, note: unknown): Promise<AdminResult> {
  if (typeof claimId !== "string" || !CLAIM_ID.test(claimId)) return { ok: false, message: MESSAGES.gone };
  const text = cleanNote(note);
  return asAdmin(
    itemId,
    "claim_undone",
    (file, adminId, now) => undoClaimAsAdmin(file, { itemId: itemId as string, claimId, adminId, note: text }, now),
    text ? { note: text } : undefined,
  );
}

/** *Undo* right after *Undo claim*. */
export async function reopenClaimAction(itemId: unknown, claimId: unknown): Promise<AdminResult> {
  if (typeof claimId !== "string" || !CLAIM_ID.test(claimId)) return { ok: false, message: MESSAGES.gone };
  return asAdmin(itemId, "claim_reopened", (file, adminId, now) => reopenClaim(file, { itemId: itemId as string, claimId, adminId }, now));
}

/** *Undo* right after *Replace photo*: `photo` is the new photo's name, so only that replacement is undone. */
export async function undoPhotoReplaceAction(itemId: unknown, photo: unknown): Promise<AdminResult> {
  if (!isPhotoName(photo)) return { ok: false, message: MESSAGES.changed };
  return asAdmin(itemId, "photo_replace_undone", (file, adminId, now) => undoPhotoReplace(file, { itemId: itemId as string, adminId, photo }, now));
}

/** The *Undo* bar for a new photo has gone: the old photo is deleted. */
export async function keepNewPhotoAction(itemId: unknown): Promise<AdminResult> {
  const admin = await currentAdmin();
  if (!admin) return { ok: false, message: NOT_ADMIN };
  if (typeof itemId !== "string" || !ITEM_ID.test(itemId)) return { ok: false, message: MESSAGES.gone };
  const deps = await getDeps();
  try {
    const outcome = await changeItems<PhotoSwap>(deps, (file) => {
      const result = forgetPreviousPhoto(file, { itemId });
      return result.ok ? { value: file, result } : { result };
    });
    if (outcome.ok) await deletePhotos(deps, outcome.unused);
    return { ok: true };
  } catch (error) {
    if (error instanceof ConflictError) return { ok: false, message: BUSY };
    throw error;
  }
}
