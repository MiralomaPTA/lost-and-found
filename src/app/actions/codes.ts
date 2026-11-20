"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { NO_STATE, safeNext, type FormState } from "@/lib/form-state";
import { logActivity } from "@/server/activity";
import { isLocked, matchCode, recordWrongCode } from "@/server/codes";
import { getDeps } from "@/server/deps";
import { ConflictError } from "@/server/docs";
import { becomeAdmin, cleanName, leaveAdmin, setDeviceName } from "@/server/phones";
import { recordWrongCodeFrom, tooManyWrongCodes } from "@/server/rate-limit";
import { clearTries, clientAddress, currentAdmin, ensurePhoneId, getVisitor, readTries, rememberSchoolCode, writeTries } from "@/server/session";
import { changeAdminCode, changeSchoolCode, loadSettings } from "@/server/settings";

/*
 * Every action here returns a message instead of throwing. In production,
 * Next.js replaces a thrown error's text with a generic one, so a thrown
 * "you're not an admin any more" would reach the person as "Application
 * error". Redirects are fine: they're how Next.js expects actions to navigate.
 */

const LOCKED = "That's 5 wrong codes in a row. Wait a minute, then try again.";
const TOO_MANY_FROM_ADDRESS = "Too many wrong codes from this network. Wait 15 minutes, then try again.";
const NOT_ADMIN = "This phone isn't an admin any more. The admin code may have changed: enter the new one on the admin code page.";
const BUSY = "Lots of changes are happening at once. Try again.";

/** Runs a change that writes JSON files, turning a lost race into a "try again" message. */
async function orTryAgain(attempt: number, run: () => Promise<FormState>): Promise<FormState> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ConflictError) return { error: BUSY, attempt };
    throw error;
  }
}

/**
 * The code box. On the first-visit screen it takes the school code or the
 * admin code; on the admin code page (`want=admin`) only the admin code.
 */
export async function enterCodeAction(prev: FormState, formData: FormData): Promise<FormState> {
  const attempt = (prev.attempt ?? 0) + 1;
  const deps = await getDeps();
  const settings = await loadSettings(deps);
  const nowMs = deps.now().getTime();
  const wantAdmin = formData.get("want") === "admin";
  const typedName = String(formData.get("name") ?? "");
  const values = { code: String(formData.get("code") ?? "").slice(0, 100), name: typedName.slice(0, 60) };

  const address = await clientAddress();
  if (tooManyWrongCodes(address, nowMs)) return { error: TOO_MANY_FROM_ADDRESS, attempt, values };
  const tries = await readTries();
  if (isLocked(tries, nowMs)) return { error: LOCKED, attempt, values };

  const match = matchCode(settings, values.code);
  if (match === "wrong" || (wantAdmin && match === "school")) {
    recordWrongCodeFrom(address, nowMs);
    const next = recordWrongCode(tries, nowMs);
    await writeTries(next);
    if (isLocked(next, nowMs)) return { error: LOCKED, attempt, values };
    if (match === "school") return { error: "That's the school code. This box takes the admin code, which only PTA admins have.", attempt, values };
    return {
      error: wantAdmin ? "That isn't the admin code." : "That code doesn't match. It's in the PTA newsletter and on the sign at the bin.",
      attempt,
      values,
    };
  }

  await clearTries();
  const next = safeNext(formData.get("next"));
  if (match === "school") {
    await rememberSchoolCode(await ensurePhoneId(deps), settings);
    redirect(next ?? "/");
  }

  // The admin code: only for a phone ID this app recorded (see ensurePhoneId).
  const phoneId = await ensurePhoneId(deps, { onlyIfKnown: true });
  // The admin code also counts as the current school code.
  await rememberSchoolCode(phoneId, settings);
  let named: boolean;
  try {
    const device = await becomeAdmin(deps, phoneId, settings, cleanName(typedName));
    named = Boolean(device.name);
  } catch (error) {
    if (error instanceof ConflictError) return { error: BUSY, attempt, values };
    throw error;
  }
  await logActivity(deps, { actor: phoneId, as_admin: true, action: "admin_code_entered" });
  // A phone with no name yet is asked for one before it goes on.
  redirect(named ? (next ?? "/admin/settings") : "/admin-code");
}

/** The name admins see next to this phone's claims, adds and admin actions. */
export async function saveNameAction(prev: FormState, formData: FormData): Promise<FormState> {
  const attempt = (prev.attempt ?? 0) + 1;
  const visitor = await getVisitor();
  if (!visitor.phoneId || !visitor.canBrowse) return { error: "Enter the school code first.", attempt };
  const name = cleanName(formData.get("name"));
  if (!name) return { error: "Type a name, such as “Lee family, Rm 12”.", attempt };
  const deps = await getDeps();
  const phoneId = visitor.phoneId;
  const outcome = await orTryAgain(attempt, async () => {
    await setDeviceName(deps, phoneId, name);
    await logActivity(deps, { actor: phoneId, as_admin: visitor.isAdmin, action: "name_changed", detail: { name } });
    return {};
  });
  if (outcome.error) return { ...outcome, values: { name } };
  redirect(safeNext(formData.get("next")) ?? "/");
}

/**
 * Turns this phone back into an ordinary one. It keeps its name, its My items
 * and the school code. A phone that's already not an admin just goes home.
 */
export async function leaveAdminAction(): Promise<void> {
  const admin = await currentAdmin();
  if (!admin) redirect("/");
  const deps = await getDeps();
  try {
    await leaveAdmin(deps, admin.phoneId);
  } catch (error) {
    if (!(error instanceof ConflictError)) throw error;
    redirect("/admin/settings");
  }
  await rememberSchoolCode(admin.phoneId, admin.settings);
  await logActivity(deps, { actor: admin.phoneId, as_admin: true, action: "admin_left" });
  redirect("/");
}

export async function changeSchoolCodeAction(prev: FormState, formData: FormData): Promise<FormState> {
  const attempt = (prev.attempt ?? 0) + 1;
  const code = String(formData.get("code") ?? "").slice(0, 100);
  const admin = await currentAdmin();
  if (!admin) return { error: NOT_ADMIN, attempt, values: { code } };
  const deps = await getDeps();
  return orTryAgain(attempt, async () => {
    const outcome = await changeSchoolCode(deps, code);
    if (!outcome.ok) return { error: outcome.error, attempt, values: { code } };
    await rememberSchoolCode(admin.phoneId, outcome.settings);
    await logActivity(deps, { actor: admin.phoneId, as_admin: true, action: "school_code_changed" });
    refresh();
    return { ...NO_STATE, saved: `The school code is now “${outcome.settings.school_code}”. Every phone will be asked for it once.`, attempt };
  });
}

export async function changeAdminCodeAction(prev: FormState, formData: FormData): Promise<FormState> {
  const attempt = (prev.attempt ?? 0) + 1;
  const code = String(formData.get("code") ?? "").slice(0, 100);
  const admin = await currentAdmin();
  if (!admin) return { error: NOT_ADMIN, attempt, values: { code } };
  const deps = await getDeps();
  return orTryAgain(attempt, async () => {
    const outcome = await changeAdminCode(deps, code);
    if (!outcome.ok) return { error: outcome.error, attempt, values: { code } };
    // This phone keeps admin with the new code; every other admin phone loses it.
    await becomeAdmin(deps, admin.phoneId, outcome.settings, null);
    await logActivity(deps, { actor: admin.phoneId, as_admin: true, action: "admin_code_changed" });
    refresh();
    return { ...NO_STATE, saved: "Admin code changed. Give the new code to the admins who should keep access.", attempt };
  });
}
