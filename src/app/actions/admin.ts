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

export type AdminResult = { ok: true; closedClaimName?: string } | { ok: false; message: string };

const NOT_ADMIN = "This phone isn't an admin any more. The admin code may have changed: tap Enter a new code at the bottom of the page and type the new one.";
const BUSY = "Lots of changes are happening at once. Try again.";
const MESSAGES = {
  gone: "This item isn't on the list any more.",
  changed: "This item has changed since, so that can't be done now. Reload to see where it stands.",
  late: "It's too late to undo that now.",
};

/** Deletes photo files nothing uses any more. Best effort: a leftover file costs little. */
async function deletePhotos(deps: Deps, names: string[]) {
  await Promise.all(names.filter(isPhotoName).map((name) => deps.store.delete(photoKey(name)).catch(() => undefined)));
}

async function asAdmin(
  input: { itemId: unknown; claimId?: string },
  action: string,
  apply: (file: ItemsFile, itemId: string, adminId: string, now: Date) => AdminChange | PhotoSwap,
  detail?: Record<string, string>,
  log = true,
): Promise<AdminResult> {
  const admin = await currentAdmin();
  if (!admin) return { ok: false, message: NOT_ADMIN };
  const { itemId } = input;
  if (typeof itemId !== "string" || !ITEM_ID.test(itemId)) return { ok: false, message: MESSAGES.gone };
  const deps = await getDeps();
  try {
    const outcome = await changeItems<AdminChange | PhotoSwap>(deps, (file) => {
      const result = apply(file, itemId, admin.phoneId, deps.now());
      return result.ok && !("changed" in result && !result.changed) ? { value: file, result } : { result };
    });
    if (!outcome.ok) return { ok: false, message: MESSAGES[outcome.reason] };
    if ("unused" in outcome) await deletePhotos(deps, outcome.unused);
    const closed = "closedClaim" in outcome ? outcome.closedClaim : undefined;
    const claimId = input.claimId ?? closed?.id;
    if (log) await logActivity(deps, { actor: admin.phoneId, as_admin: true, action, item_id: itemId, ...(claimId ? { claim_id: claimId } : {}), ...(detail ? { detail } : {}) });
    return closed ? { ok: true, closedClaimName: closed.name } : { ok: true };
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

/** *Remove*. If it closes someone's claim, the answer names them, so the admin hears about it. */
export async function removeItemAction(itemId: unknown, reason: unknown): Promise<AdminResult> {
  if (typeof reason !== "string" || !(ADMIN_REMOVE_REASONS as readonly string[]).includes(reason)) return { ok: false, message: "Pick a reason." };
  const why = reason as AdminRemoveReason;
  return asAdmin({ itemId }, "removed", (file, id, adminId, now) => removeItem(file, { itemId: id, adminId, reason: why }, now), { reason: why });
}

export async function undoRemovalAction(itemId: unknown): Promise<AdminResult> {
  return asAdmin({ itemId }, "removal_undone", (file, id, adminId, now) => undoRemoval(file, { itemId: id, adminId }, now));
}

export async function restoreItemAction(itemId: unknown): Promise<AdminResult> {
  return asAdmin({ itemId }, "restored", (file, id, adminId, now) => restoreItem(file, { itemId: id, adminId }, now));
}

export async function undoClaimAction(itemId: unknown, claimId: unknown, note: unknown): Promise<AdminResult> {
  if (typeof claimId !== "string" || !CLAIM_ID.test(claimId)) return { ok: false, message: MESSAGES.gone };
  const text = cleanNote(note);
  return asAdmin(
    { itemId, claimId },
    "claim_undone",
    (file, id, adminId, now) => undoClaimAsAdmin(file, { itemId: id, claimId, adminId, note: text }, now),
    text ? { note: text } : undefined,
  );
}

/** *Undo* right after *Undo claim*. */
export async function reopenClaimAction(itemId: unknown, claimId: unknown): Promise<AdminResult> {
  if (typeof claimId !== "string" || !CLAIM_ID.test(claimId)) return { ok: false, message: MESSAGES.gone };
  return asAdmin({ itemId, claimId }, "claim_reopened", (file, id, adminId, now) => reopenClaim(file, { itemId: id, claimId, adminId }, now));
}

/** *Undo* right after *Replace photo*: `photo` is the new photo's name, so only that replacement is undone. */
export async function undoPhotoReplaceAction(itemId: unknown, photo: unknown): Promise<AdminResult> {
  if (!isPhotoName(photo)) return { ok: false, message: MESSAGES.changed };
  return asAdmin({ itemId }, "photo_replace_undone", (file, id, adminId, now) => undoPhotoReplace(file, { itemId: id, adminId, photo }, now));
}

/**
 * The *Undo* bar for the replacement that brought in `photo` has gone: the
 * photo it replaced is deleted now rather than when its Undo time runs out.
 */
export async function keepNewPhotoAction(itemId: unknown, photo: unknown): Promise<AdminResult> {
  if (!isPhotoName(photo)) return { ok: true };
  const result = await asAdmin({ itemId }, "photo_kept", (file, id) => forgetPreviousPhoto(file, { itemId: id, photo }), undefined, false);
  // Someone already moved on (another replacement, an Undo): nothing left to do here.
  return result.ok || result.message === MESSAGES.changed ? { ok: true } : result;
}
