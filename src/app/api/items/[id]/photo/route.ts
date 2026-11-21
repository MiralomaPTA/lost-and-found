import type { NextRequest } from "next/server";
import { replacePhoto, type PhotoSwap } from "@/server/admin-items";
import { checkImage, PHOTO_MAX_BYTES, PHOTO_MAX_SIDE, THUMB_MAX_BYTES, THUMB_MAX_SIDE } from "@/server/adding";
import { logActivity } from "@/server/activity";
import { getDeps } from "@/server/deps";
import { ConflictError } from "@/server/docs";
import { answer, bytesOf, formOf, fromThisSite, readBody } from "@/server/http";
import { changeItems, ITEM_ID, loadItems } from "@/server/items";
import { isPhotoName, newPhotoNames, photoKey } from "@/server/photos";
import { currentAdmin } from "@/server/session";

/**
 * POST /api/items/<id>/photo: an admin's *Replace photo* (spec section 6),
 * as multipart form data (`photo`, `thumb`), cropped and resized in the
 * browser like an add. The new photo gets new names, so no cached copy of
 * the old one is ever served for the item. The old one is kept for *Undo*.
 * Answers `{ ok: true, photo }` (the new photo's name) or `{ ok: false, message }`.
 */

const MAX_BODY = PHOTO_MAX_BYTES + THUMB_MAX_BYTES + 100_000;

export async function POST(request: NextRequest, context: RouteContext<"/api/items/[id]/photo">) {
  if (!fromThisSite(request)) return answer(403, { ok: false, message: "This can only be sent from the lost-and-found site." });
  const admin = await currentAdmin();
  if (!admin) return answer(401, { ok: false, message: "This phone can't open this. Tap Enter a new code at the bottom of any page." });
  const { id } = await context.params;
  if (!ITEM_ID.test(id)) return answer(404, { ok: false, message: "This item isn't on the list any more." });

  const body = await readBody(request, MAX_BODY);
  if (!body) return answer(413, { ok: false, message: "That photo is too big to upload. Try again." });
  const form = await formOf(request, body);
  const photoBytes = form && (await bytesOf(form.get("photo")));
  const thumbBytes = form && (await bytesOf(form.get("thumb")));
  const photo = photoBytes && checkImage(photoBytes, PHOTO_MAX_SIDE, PHOTO_MAX_BYTES);
  const thumb = thumbBytes && checkImage(thumbBytes, THUMB_MAX_SIDE, THUMB_MAX_BYTES);
  if (!photo || !thumb) return answer(400, { ok: false, message: "That photo couldn't be saved. Try another." });

  const deps = await getDeps();
  const names = newPhotoNames("jpg");
  const stored: string[] = [];
  const removeNew = () => Promise.all(stored.map((key) => deps.store.delete(key).catch(() => undefined)));
  try {
    for (const [name, jpeg] of [
      [names.photo, photo],
      [names.thumb, thumb],
    ] as const) {
      const put = await deps.store.put(photoKey(name), jpeg.bytes, { contentType: "image/jpeg", condition: { ifNoneMatch: "*" } });
      if (!put.ok) throw new Error(`${name} already exists`);
      stored.push(photoKey(name));
    }
    const outcome = await changeItems<PhotoSwap>(deps, (file) => {
      const result = replacePhoto(file, { itemId: id, adminId: admin.phoneId, ...names }, deps.now());
      return result.ok && result.changed ? { value: file, result } : { result };
    });
    if (!outcome.ok) {
      await removeNew();
      return answer(404, { ok: false, message: "This item isn't on the list any more." });
    }
    await Promise.all(outcome.unused.filter(isPhotoName).map((name) => deps.store.delete(photoKey(name)).catch(() => undefined)));
    await logActivity(deps, { actor: admin.phoneId, as_admin: true, action: "photo_replaced", item_id: id });
    return answer(200, { ok: true, photo: names.photo });
  } catch (error) {
    if (error instanceof ConflictError) {
      await removeNew();
      return answer(503, { ok: false, message: "Lots of changes are happening at once. Try again." });
    }
    // Unclear whether the list took the change: keep the new photo if the item uses it.
    const used = await loadItems(deps, { fresh: true })
      .then((file) => file.items.some((item) => item.photo === names.photo))
      .catch(() => true);
    if (!used) await removeNew();
    throw error;
  }
}
