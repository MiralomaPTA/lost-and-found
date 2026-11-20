"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { NO_STATE, safeNext, type FormState } from "@/lib/form-state";
import { logActivity } from "@/server/activity";
import { isLocked, matchCode, recordWrongCode } from "@/server/codes";
import { getDeps } from "@/server/deps";
import { becomeAdmin, cleanName, leaveAdmin, setDeviceName } from "@/server/phones";
import { actionAdmin, clearTries, ensurePhoneId, getVisitor, readTries, rememberSchoolCode, writeTries } from "@/server/session";
import { changeAdminCode, changeSchoolCode, loadSettings } from "@/server/settings";

const LOCKED = "That's 5 wrong codes in a row. Wait a minute, then try again.";

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

  const tries = await readTries();
  if (isLocked(tries, nowMs)) return { error: LOCKED, attempt };

  const match = matchCode(settings, String(formData.get("code") ?? ""));
  if (match === "wrong" || (wantAdmin && match === "school")) {
    const next = recordWrongCode(tries, nowMs);
    await writeTries(next);
    if (isLocked(next, nowMs)) return { error: LOCKED, attempt };
    if (match === "school") return { error: "That's the school code. This box takes the admin code, which only PTA admins have.", attempt };
    return {
      error: wantAdmin ? "That isn't the admin code." : "That code doesn't match. It's in the PTA newsletter and on the sign at the bin.",
      attempt,
    };
  }

  await clearTries();
  const phoneId = await ensurePhoneId();
  // The admin code also counts as the current school code.
  await rememberSchoolCode(phoneId, settings);
  const next = safeNext(formData.get("next"));
  if (match === "school") redirect(next ?? "/");

  const device = await becomeAdmin(deps, phoneId, settings, cleanName(formData.get("name")));
  await logActivity(deps, { actor: phoneId, as_admin: true, action: "admin_code_entered" });
  redirect(device.name ? (next ?? "/admin/settings") : "/admin-code");
}

/** The name admins see next to this phone's claims, adds and admin actions. */
export async function saveNameAction(prev: FormState, formData: FormData): Promise<FormState> {
  const attempt = (prev.attempt ?? 0) + 1;
  const visitor = await getVisitor();
  if (!visitor.phoneId || !visitor.canBrowse) return { error: "Enter the school code first.", attempt };
  const name = cleanName(formData.get("name"));
  if (!name) return { error: "Type a name, such as “Lee family, Rm 12”.", attempt };
  const deps = await getDeps();
  await setDeviceName(deps, visitor.phoneId, name);
  await logActivity(deps, { actor: visitor.phoneId, as_admin: visitor.isAdmin, action: "name_changed", detail: { name } });
  redirect(safeNext(formData.get("next")) ?? "/");
}

/** Turns this phone back into an ordinary one. It keeps its name, My items and the school code. */
export async function leaveAdminAction(): Promise<void> {
  const admin = await actionAdmin();
  const deps = await getDeps();
  await leaveAdmin(deps, admin.phoneId);
  await logActivity(deps, { actor: admin.phoneId, as_admin: true, action: "admin_left" });
  redirect("/");
}

export async function changeSchoolCodeAction(prev: FormState, formData: FormData): Promise<FormState> {
  const attempt = (prev.attempt ?? 0) + 1;
  const admin = await actionAdmin();
  const deps = await getDeps();
  const outcome = await changeSchoolCode(deps, String(formData.get("code") ?? ""));
  if (!outcome.ok) return { error: outcome.error, attempt };
  await rememberSchoolCode(admin.phoneId, outcome.settings);
  await logActivity(deps, { actor: admin.phoneId, as_admin: true, action: "school_code_changed" });
  refresh();
  return { ...NO_STATE, saved: `The school code is now “${outcome.settings.school_code}”. Every phone will be asked for it once.`, attempt };
}

export async function changeAdminCodeAction(prev: FormState, formData: FormData): Promise<FormState> {
  const attempt = (prev.attempt ?? 0) + 1;
  const admin = await actionAdmin();
  const deps = await getDeps();
  const outcome = await changeAdminCode(deps, String(formData.get("code") ?? ""));
  if (!outcome.ok) return { error: outcome.error, attempt };
  // This phone keeps admin with the new code; every other admin phone loses it.
  await becomeAdmin(deps, admin.phoneId, outcome.settings, null);
  await logActivity(deps, { actor: admin.phoneId, as_admin: true, action: "admin_code_changed" });
  refresh();
  return { ...NO_STATE, saved: "Admin code changed. Give the new code to the admins who should keep access.", attempt };
}
