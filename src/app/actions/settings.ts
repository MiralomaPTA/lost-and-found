"use server";

import { refresh } from "next/cache";
import { NO_STATE, type FormState } from "@/lib/form-state";
import { logActivity } from "@/server/activity";
import { getDeps } from "@/server/deps";
import { ConflictError } from "@/server/docs";
import { changeItems } from "@/server/items";
import { currentAdmin } from "@/server/session";
import { updateSettings, type Settings } from "@/server/settings";
import { isTotalName, resetTotal, TOTAL_LABELS } from "@/server/totals";
import { addEntry, BIN_DESCRIPTION_MAX, cleanBinDescription, editEntry, renameOnList, reorderEntries, type ListChange, type ListKind } from "@/server/tag-lists";

/*
 * The rest of Settings (spec section 6): where the bin is, and the types and
 * colors lists. Each checks the admin code again and answers with a message.
 */

const NOT_ADMIN = "This phone isn't an admin any more. The admin code may have changed: tap Enter a new code at the bottom of the page and type the new one.";
const BUSY = "Lots of changes are happening at once. Try again.";

export async function saveBinDescriptionAction(prev: FormState, formData: FormData): Promise<FormState> {
  const attempt = (prev.attempt ?? 0) + 1;
  const typed = String(formData.get("bin") ?? "").slice(0, 300);
  const admin = await currentAdmin();
  if (!admin) return { error: NOT_ADMIN, attempt, values: { bin: typed } };
  const text = cleanBinDescription(typed);
  if (!text) return { error: `Say where the bin is, in up to ${BIN_DESCRIPTION_MAX} letters, such as “by the main office”.`, attempt, values: { bin: typed } };
  const deps = await getDeps();
  try {
    const changed = await updateSettings(deps, (current) => (current.bin_description === text ? { result: false } : { value: { ...current, bin_description: text }, result: true }));
    if (changed) await logActivity(deps, { actor: admin.phoneId, as_admin: true, action: "bin_description_changed", detail: { to: text } });
    refresh();
    return { ...NO_STATE, saved: "Saved.", attempt };
  } catch (error) {
    if (error instanceof ConflictError) return { error: BUSY, attempt, values: { bin: typed } };
    throw error;
  }
}

export type ListAnswer = { ok: true; message?: string } | { ok: false; message: string };

const isKind = (kind: unknown): kind is ListKind => kind === "types" || kind === "colors";

async function changeList(kind: unknown, action: string, apply: (settings: Settings, kind: ListKind) => ListChange): Promise<ListAnswer> {
  const admin = await currentAdmin();
  if (!admin) return { ok: false, message: NOT_ADMIN };
  if (!isKind(kind)) return { ok: false, message: "Reload the page and try again." };
  const deps = await getDeps();
  try {
    const outcome = await updateSettings<ListChange>(deps, (current) => {
      const result = apply(current, kind);
      return result.ok && result.changed ? { value: current, result } : { result };
    });
    if (!outcome.ok) return { ok: false, message: outcome.error };
    let message: string | undefined;
    if (outcome.renamed) {
      // The items on the list follow the new name, so they still show under it.
      const { from, to } = outcome.renamed;
      const count = await changeItems<number>(deps, (file) => {
        const renamed = renameOnList(file, kind, from, to);
        return renamed > 0 ? { value: file, result: renamed } : { result: 0 };
      });
      if (count > 0) message = `${count} ${count === 1 ? "item is" : "items are"} now tagged “${to}”.`;
    }
    if (outcome.changed || outcome.renamed) {
      await logActivity(deps, { actor: admin.phoneId, as_admin: true, action, detail: outcome.renamed ? { list: kind, from: outcome.renamed.from, to: outcome.renamed.to } : { list: kind } });
    }
    refresh();
    return { ok: true, message };
  } catch (error) {
    if (error instanceof ConflictError) return { ok: false, message: BUSY };
    console.error(`Couldn't save ${action}`, error);
    return { ok: false, message: "Something went wrong. Reload the page and try again." };
  }
}

/** *Add a type* / *Add a color*. */
export async function addTagAction(kind: unknown, name: unknown, swatch?: unknown): Promise<ListAnswer> {
  return changeList(kind, "list_entry_added", (settings, k) => addEntry(settings, k, { name, swatch }));
}

/** Renames, re-colors, hides or shows the entry now called `name`. */
export async function editTagAction(kind: unknown, name: unknown, change: unknown): Promise<ListAnswer> {
  if (typeof name !== "string") return { ok: false, message: "Reload the page and try again." };
  const { newName, swatch, active } = (typeof change === "object" && change ? change : {}) as Record<string, unknown>;
  return changeList(kind, "list_entry_changed", (settings, k) => editEntry(settings, k, { name, newName, swatch, active }));
}

/** *Reorder*: the whole list's names, in their new order. */
export async function reorderTagsAction(kind: unknown, names: unknown): Promise<ListAnswer> {
  return changeList(kind, "list_reordered", (settings, k) => reorderEntries(settings, k, names));
}

/** *Reset* on one of the totals: it starts again from 0 now. The activity log keeps what it was. */
export async function resetTotalAction(prev: FormState, formData: FormData): Promise<FormState> {
  const attempt = (prev.attempt ?? 0) + 1;
  const admin = await currentAdmin();
  if (!admin) return { error: NOT_ADMIN, attempt };
  const name = formData.get("total");
  if (!isTotalName(name)) return { error: "Reload the page and try again.", attempt };
  const deps = await getDeps();
  try {
    const was = await changeItems<number>(deps, (file) => {
      const { next, was } = resetTotal(file, name, deps.now());
      return { value: next, result: was };
    });
    await logActivity(deps, { actor: admin.phoneId, as_admin: true, action: "total_reset", detail: { total: name, was } });
    refresh();
    return { ...NO_STATE, saved: `${TOTAL_LABELS[name]}: back to 0 (it was ${was.toLocaleString("en-US")}).`, attempt };
  } catch (error) {
    if (error instanceof ConflictError) return { error: BUSY, attempt };
    throw error;
  }
}
