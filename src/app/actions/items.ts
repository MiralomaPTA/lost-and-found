"use server";

import { logActivity } from "@/server/activity";
import { getDeps } from "@/server/deps";
import { ConflictError } from "@/server/docs";
import { addedWithRef, changeItems, changeTags, CLIENT_REF, ITEM_ID, undoAdd, type AdderUndo, type Item, type TagChange } from "@/server/items";
import { getVisitor } from "@/server/session";
import { activeColors, activeTypes } from "@/server/views";

/*
 * Changes to items from the add screens: the adder's *Undo*, and fixing the
 * tags of an item just added (the item page's *Fix tags* uses the same
 * action). Like the other actions, these answer with a message.
 */

export type ItemChangeResult = { ok: true } | { ok: false; message: string };

const NO_CODE = "Enter the school code first.";
const BUSY = "Lots of changes are happening at once. Try again.";
const GONE = "This item isn't on the list any more.";

async function visitorWithCode() {
  const visitor = await getVisitor();
  return visitor.canBrowse && visitor.phoneId ? { ...visitor, phoneId: visitor.phoneId } : null;
}

async function orBusy(run: () => Promise<ItemChangeResult>): Promise<ItemChangeResult> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ConflictError) return { ok: false, message: BUSY };
    throw error;
  }
}

/** The adder takes back an item they just added, from the add screen. */
export async function undoAddAction(itemId: unknown): Promise<ItemChangeResult> {
  const visitor = await visitorWithCode();
  if (!visitor) return { ok: false, message: NO_CODE };
  if (typeof itemId !== "string" || !ITEM_ID.test(itemId)) return { ok: false, message: GONE };
  const deps = await getDeps();
  return orBusy(async () => {
    const outcome = await changeItems<AdderUndo>(deps, (file) => {
      const result = undoAdd(file, { itemId, phoneId: visitor.phoneId }, deps.now());
      return result.ok ? { value: file, result } : { result };
    });
    if (!outcome.ok) {
      const messages = {
        gone: GONE,
        taken: "Someone has already claimed it, so it stays on the list.",
        late: `It's been on the list too long to undo here. To have it removed, email the PTA.`,
      };
      return { ok: false, message: messages[outcome.reason] };
    }
    await logActivity(deps, { actor: visitor.phoneId, as_admin: visitor.isAdmin, action: "add_undone", item_id: itemId });
    return { ok: true };
  });
}

/**
 * Takes back an upload whose answer never arrived (a timeout, a dropped
 * connection): if it made an item, by its upload reference, that item comes
 * off the list. If it didn't, there's nothing to do, and that's fine too.
 */
export async function undoUploadAction(clientRef: unknown): Promise<ItemChangeResult> {
  const visitor = await visitorWithCode();
  if (!visitor) return { ok: false, message: NO_CODE };
  if (typeof clientRef !== "string" || !CLIENT_REF.test(clientRef)) return { ok: true };
  const deps = await getDeps();
  return orBusy(async () => {
    const outcome = await changeItems<AdderUndo | { ok: true; item: null }>(deps, (file) => {
      const item: Item | undefined = addedWithRef(file, visitor.phoneId, clientRef);
      if (!item || item.status === "removed") return { result: { ok: true, item: null } };
      const result = undoAdd(file, { itemId: item.id, phoneId: visitor.phoneId }, deps.now());
      return result.ok ? { value: file, result } : { result };
    });
    if (!outcome.ok) {
      return { ok: false, message: outcome.reason === "taken" ? "Someone has already claimed it, so it stays on the list." : `It's been on the list too long to undo here.` };
    }
    if (outcome.item) await logActivity(deps, { actor: visitor.phoneId, as_admin: visitor.isAdmin, action: "add_undone", item_id: outcome.item.id });
    return { ok: true };
  });
}

/** *Fix tags*: anyone with the code can change an item's type, color and *Has a name*. */
export async function changeTagsAction(itemId: unknown, tags: unknown): Promise<ItemChangeResult> {
  const visitor = await visitorWithCode();
  if (!visitor) return { ok: false, message: NO_CODE };
  if (typeof itemId !== "string" || !ITEM_ID.test(itemId)) return { ok: false, message: GONE };
  const { type, color, has_name } = (typeof tags === "object" && tags ? tags : {}) as Record<string, unknown>;
  if (typeof type !== "string" || typeof color !== "string") return { ok: false, message: "Pick a type and a color from the lists." };
  if (typeof has_name !== "boolean") return { ok: false, message: "Say whether it has a name." };
  // A type or color an admin has hidden is only allowed on an item that already has it.
  const typeOffered = activeTypes(visitor.settings).includes(type);
  const colorOffered = activeColors(visitor.settings).some((c) => c.name === color);
  const deps = await getDeps();
  return orBusy(async () => {
    const outcome = await changeItems<TagChange | { ok: false; reason: "type" | "color" }>(deps, (file) => {
      const item = file.items.find((i) => i.id === itemId);
      if (item && !typeOffered && item.type !== type) return { result: { ok: false, reason: "type" } };
      if (item && !colorOffered && item.color !== color) return { result: { ok: false, reason: "color" } };
      const result = changeTags(file, { itemId, phoneId: visitor.phoneId, tags: { type, color, has_name } }, deps.now());
      return result.ok && result.changed ? { value: file, result } : { result };
    });
    if (!outcome.ok) {
      const messages = { gone: GONE, type: "Pick a type from the list.", color: "Pick a color from the list." };
      return { ok: false, message: messages[outcome.reason] };
    }
    if (outcome.changed) {
      await logActivity(deps, {
        actor: visitor.phoneId,
        as_admin: visitor.isAdmin,
        action: "tags_changed",
        item_id: itemId,
        detail: {
          from: `${outcome.before.type}, ${outcome.before.color}${outcome.before.has_name ? ", has a name" : ""}`,
          to: `${type}, ${color}${has_name ? ", has a name" : ""}`,
        },
      });
    }
    return { ok: true };
  });
}
