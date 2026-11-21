import { logActivity } from "@/server/activity";
import type { Deps } from "@/server/deps";
import { ConflictError } from "@/server/docs";
import { addItem, addedWithRef, changeItems, changeTags, CLIENT_REF, loadItems, type Item, type ItemsFile } from "@/server/items";
import { cleanJpeg } from "@/server/jpeg";
import { newPhotoNames, photoKey } from "@/server/photos";
import type { Settings } from "@/server/settings";
import { activeColors, activeTypes } from "@/server/views";

/**
 * Saving an item someone added (spec section 4). The browser has already
 * cropped and resized the photo and made the thumbnail; this checks them,
 * stores both under new random names and puts the item on the list.
 */

/** Photos are resized in the browser to at most 1600 px, thumbnails to 400 px. */
export const PHOTO_MAX_SIDE = 1600;
export const THUMB_MAX_SIDE = 400;
export const PHOTO_MAX_BYTES = 3_500_000;
export const THUMB_MAX_BYTES = 400_000;

export interface Upload {
  photo: Uint8Array;
  thumb: Uint8Array;
  type: string;
  color: string;
  hasName: boolean;
  clientRef: string;
}

export interface Adder {
  phoneId: string;
  name: string;
  isAdmin: boolean;
}

const BUSY = "Lots of changes are happening at once. Try again.";

export type AddResult = { ok: true; item: Item; existing: boolean } | { ok: false; reason: "bad-request" | "busy"; message: string };

function checkImage(bytes: Uint8Array, maxSide: number, maxBytes: number) {
  if (bytes.length === 0 || bytes.length > maxBytes) return null;
  const jpeg = cleanJpeg(bytes);
  if (!jpeg || jpeg.width > maxSide || jpeg.height > maxSide || jpeg.width < 16 || jpeg.height < 16) return null;
  return jpeg;
}

/** What's wrong with an upload, in words for the person adding, or null if it's fine. */
export function uploadProblem(upload: Upload, settings: Settings): string | null {
  if (!CLIENT_REF.test(upload.clientRef)) return "Something went wrong with this upload. Take the photo again.";
  if (!activeTypes(settings).includes(upload.type)) return "Pick a type from the list.";
  if (!activeColors(settings).some((c) => c.name === upload.color)) return "Pick a color from the list.";
  return null;
}

/**
 * A retry of an upload that already made its item (its answer may have been
 * lost on the way back). The tags in this try win: the person may have fixed
 * them before retrying. Changes `file` in place; says whether it changed.
 */
function retagRetry(file: ItemsFile, existing: Item, adder: Adder, upload: Upload, now: Date): { item: Item; retagged: boolean } {
  const outcome = changeTags(file, { itemId: existing.id, phoneId: adder.phoneId, tags: { type: upload.type, color: upload.color, has_name: upload.hasName } }, now);
  return outcome.ok && outcome.changed ? { item: outcome.item, retagged: true } : { item: existing, retagged: false };
}

export async function addUploadedItem(deps: Deps, settings: Settings, adder: Adder, upload: Upload): Promise<AddResult> {
  const problem = uploadProblem(upload, settings);
  if (problem) return { ok: false, reason: "bad-request", message: problem };
  const photo = checkImage(upload.photo, PHOTO_MAX_SIDE, PHOTO_MAX_BYTES);
  const thumb = checkImage(upload.thumb, THUMB_MAX_SIDE, THUMB_MAX_BYTES);
  if (!photo || !thumb) return { ok: false, reason: "bad-request", message: "That photo couldn't be saved. Take it again." };

  try {
    // A retry of an upload that already went through: hand back its item, with this try's tags.
    if (addedWithRef(await loadItems(deps, { fresh: true }), adder.phoneId, upload.clientRef)) {
      const retried = await changeItems(deps, (file) => {
        const existing = addedWithRef(file, adder.phoneId, upload.clientRef);
        if (!existing) return { result: null };
        const outcome = retagRetry(file, existing, adder, upload, deps.now());
        return outcome.retagged ? { value: file, result: outcome } : { result: outcome };
      });
      if (retried) {
        if (retried.retagged) await logActivity(deps, { actor: adder.phoneId, as_admin: adder.isAdmin, action: "tags_changed", item_id: retried.item.id });
        return { ok: true, item: retried.item, existing: true };
      }
    }
  } catch (error) {
    if (error instanceof ConflictError) return { ok: false, reason: "busy", message: BUSY };
    throw error;
  }

  const names = newPhotoNames("jpg");
  const stored: string[] = [];
  const removePhotos = () => Promise.all(stored.map((key) => deps.store.delete(key).catch(() => undefined)));
  try {
    for (const [name, jpeg] of [
      [names.photo, photo],
      [names.thumb, thumb],
    ] as const) {
      const key = photoKey(name);
      const put = await deps.store.put(key, jpeg.bytes, { contentType: "image/jpeg", condition: { ifNoneMatch: "*" } });
      if (!put.ok) throw new Error(`${key} already exists`);
      stored.push(key);
    }
    const outcome = await changeItems(deps, (file) => {
      const existing = addedWithRef(file, adder.phoneId, upload.clientRef);
      if (existing) {
        const retried = retagRetry(file, existing, adder, upload, deps.now());
        return retried.retagged ? { value: file, result: retried } : { result: retried };
      }
      const item = addItem(
        file,
        { type: upload.type, color: upload.color, has_name: upload.hasName, ...names, phoneId: adder.phoneId, name: adder.name, clientRef: upload.clientRef },
        deps.now(),
      );
      return { value: file, result: { item, retagged: false } };
    });
    // The item found may be this very request's: a write that went through
    // but whose answer was lost, then retried by the storage client and
    // refused as out of date. Only an item with other photos is someone
    // else's (an earlier try of the same upload).
    const ours = outcome.item.photo === names.photo;
    if (ours) {
      await logActivity(deps, { actor: adder.phoneId, as_admin: adder.isAdmin, action: "added", item_id: outcome.item.id });
    } else {
      await removePhotos();
      if (outcome.retagged) await logActivity(deps, { actor: adder.phoneId, as_admin: adder.isAdmin, action: "tags_changed", item_id: outcome.item.id });
    }
    return { ok: true, item: outcome.item, existing: !ours };
  } catch (error) {
    if (error instanceof ConflictError) {
      // Every attempt was refused, so nothing points at these photos.
      await removePhotos();
      return { ok: false, reason: "busy", message: BUSY };
    }
    // Anything else leaves it unclear whether items.json took the write.
    // Keep the photos if an item uses them; if that can't be checked either,
    // leave them (an unused photo costs little; a missing one breaks an item).
    const used = await loadItems(deps, { fresh: true })
      .then((file) => file.items.some((item) => item.photo === names.photo))
      .catch(() => true);
    if (!used) await removePhotos();
    throw error;
  }
}
