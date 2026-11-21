"use server";

import { refresh } from "next/cache";
import { after } from "next/server";
import { pacificDate } from "@/lib/dates";
import { logActivity } from "@/server/activity";
import { moveClearOut, putBackClearOut, runClearOut, skipClearOut, type DateChange } from "@/server/clear-out";
import { getDeps } from "@/server/deps";
import { ConflictError } from "@/server/docs";
import { loadItems, type ItemsFile } from "@/server/items";
import { forgetOldPhones } from "@/server/phones";
import { currentAdmin, readYourWrites } from "@/server/session";
import { loadSettings, updateSettings, type Settings } from "@/server/settings";

/*
 * The *Clear out* tab's changes (spec section 7). Like the other admin
 * actions, each checks the admin code again and answers with a message.
 */

export type ClearOutAnswer = { ok: true; message: string } | { ok: false; message: string };

const NOT_ADMIN = "This phone isn't an admin any more. The admin code may have changed: enter the new one on the admin code page.";
const BUSY = "Lots of changes are happening at once. Try again.";
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * *Clear out*, after the confirmation. `expectedDate` is the date the tab
 * showed, so a second tap, or a page left open past the date, can't run
 * another one by surprise.
 */
export async function clearOutAction(expectedDate: unknown): Promise<ClearOutAnswer> {
  const admin = await currentAdmin();
  if (!admin) return { ok: false, message: NOT_ADMIN };
  if (typeof expectedDate !== "string" || !DAY.test(expectedDate)) return { ok: false, message: "Reload the page and try again." };
  const deps = await getDeps();
  try {
    const settings = await loadSettings(deps);
    const result = await runClearOut(deps, {
      adminId: admin.phoneId,
      adminName: admin.device.name ?? `An admin`,
      expectedDate,
      changes: settings.clear_out_changes,
    });
    if (!result.ok) {
      const messages = {
        done: "That clear-out has already been done.",
        changed: "The clear-out date has changed since this page loaded. Reload it and check the numbers again.",
        busy: BUSY,
      };
      refresh();
      return { ok: false, message: messages[result.reason] };
    }
    after(() => forgetOldPhones(deps).catch((error) => console.error("Couldn't forget old phones", error)));
    // This phone sees the empty list at once, whichever server answers next.
    await readYourWrites();
    refresh();
    const { donated, picked_up } = result.summary;
    const photos = result.photosLeft > 0 ? ` ${plural(result.photosLeft, "photo", "photos")} couldn't be deleted yet; the next clear-out tries again.` : " All their photos are deleted.";
    return { ok: true, message: `Cleared out: ${plural(donated, "item", "items")} donated, ${plural(picked_up, "claim", "claims")} closed as picked up.${photos}` };
  } catch (error) {
    if (error instanceof ConflictError) return { ok: false, message: BUSY };
    console.error("Clear-out failed", error);
    // It may have gone through before the error: the tab shows where it stands.
    refresh();
    return { ok: false, message: "Something went wrong. Reload the page to see whether the clear-out was done before trying again." };
  }
}

export type DateAnswer = { ok: true } | { ok: false; message: string };

type DateInput = { scheduled: string; today: string; byName: string };

/** One change to the coming dates, as a safe write to settings.json. `apply` changes the copy it's given. */
async function changeDate(action: string, scheduled: unknown, apply: (settings: Settings, file: ItemsFile, input: DateInput) => DateChange): Promise<DateAnswer> {
  const admin = await currentAdmin();
  if (!admin) return { ok: false, message: NOT_ADMIN };
  if (typeof scheduled !== "string" || !DAY.test(scheduled)) return { ok: false, message: "Reload the page and try again." };
  const deps = await getDeps();
  try {
    const file = await loadItems(deps, { fresh: true });
    const input = { scheduled, today: pacificDate(deps.now()), byName: admin.device.name ?? "an admin" };
    const outcome = await updateSettings<DateChange>(deps, (current) => {
      const result = apply(current, file, input);
      return result.ok ? { value: current, result } : { result };
    });
    if (!outcome.ok) return { ok: false, message: outcome.error };
    await logActivity(deps, { actor: admin.phoneId, as_admin: true, action, detail: { date: scheduled } });
    refresh();
    return { ok: true };
  } catch (error) {
    if (error instanceof ConflictError) return { ok: false, message: BUSY };
    throw error;
  }
}

/** *Move*: the clear-out due on `scheduled` (a second Friday) happens on `to` instead. */
export async function moveClearOutAction(scheduled: unknown, to: unknown): Promise<DateAnswer> {
  if (typeof to !== "string" || !DAY.test(to)) return { ok: false, message: "Pick a date." };
  return changeDate("clear_out_moved", scheduled, (settings, file, input) => moveClearOut(settings, file, { ...input, to }));
}

export async function skipClearOutAction(scheduled: unknown): Promise<DateAnswer> {
  return changeDate("clear_out_skipped", scheduled, skipClearOut);
}

export async function putBackClearOutAction(scheduled: unknown): Promise<DateAnswer> {
  return changeDate("clear_out_put_back", scheduled, putBackClearOut);
}
