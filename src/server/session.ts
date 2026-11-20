import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { cache } from "react";
import { formatTries, parseTries, type Tries } from "@/server/codes";
import { config } from "@/server/config";
import { getDeps } from "@/server/deps";
import { getDevice, hasSchoolCode, isAdminDevice, isPhoneId, newPhoneId, schoolCodeProof, touchDevice, type Device } from "@/server/phones";
import { loadSettings, type Settings } from "@/server/settings";

/** The phone's random ID. HttpOnly and set by the server, so browsers keep it the full year. */
const PHONE_COOKIE = "lf_phone";
/** Proof that this phone entered the current school code. */
const CODE_COOKIE = "lf_code";
/** Wrong codes in a row, for the one-minute wait. */
const TRIES_COOKIE = "lf_tries";

const YEAR_SECONDS = 365 * 24 * 60 * 60;

const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: config.isProduction,
  path: "/",
  maxAge: YEAR_SECONDS,
};

export interface Visitor {
  settings: Settings;
  phoneId: string | null;
  device: Device | null;
  /** Whether an admin has set the first school code yet. */
  isOpen: boolean;
  isAdmin: boolean;
  /** Has the current school code, or is an admin. */
  canBrowse: boolean;
}

/** Who is asking, worked out once per request from the cookies, settings.json and the phone's file. */
export const getVisitor = cache(async (): Promise<Visitor> => {
  // Cookies first: it marks the page as per-request, so `next build` never
  // tries to render it ahead of time (and never opens the bucket).
  const jar = await cookies();
  const deps = await getDeps();
  const settings = await loadSettings(deps);
  const raw = jar.get(PHONE_COOKIE)?.value;
  const phoneId = isPhoneId(raw) ? raw : null;
  const device = phoneId ? await getDevice(deps, phoneId) : null;
  if (device) {
    after(() => touchDevice(deps, device).catch((error) => console.error("Couldn't update last_seen_at", error)));
  }
  const isAdmin = isAdminDevice(settings, device);
  const hasCode = phoneId ? hasSchoolCode(settings, phoneId, jar.get(CODE_COOKIE)?.value) : false;
  return { settings, phoneId, device, isOpen: Boolean(settings.school_code), isAdmin, canBrowse: isAdmin || hasCode };
});

export type AdminVisitor = Visitor & { phoneId: string; device: Device };

function asAdmin(visitor: Visitor): AdminVisitor | null {
  return visitor.isAdmin && visitor.phoneId && visitor.device ? (visitor as AdminVisitor) : null;
}

/** For admin pages: the admin, or a redirect to the admin code page. */
export async function requireAdmin(): Promise<AdminVisitor> {
  const admin = asAdmin(await getVisitor());
  if (!admin) redirect("/admin-code");
  return admin;
}

/** For admin server actions: a stale form can't usefully redirect, so this throws. */
export async function actionAdmin(): Promise<AdminVisitor> {
  const admin = asAdmin(await getVisitor());
  if (!admin) throw new Error("This phone isn't an admin any more. The admin code may have changed; enter the new one.");
  return admin;
}

// --- Cookie writers. Server actions only: cookies can't be set while a page renders. ---

/** This phone's ID, given a new one (and its cookie) if it has none. */
export async function ensurePhoneId(): Promise<string> {
  const jar = await cookies();
  const raw = jar.get(PHONE_COOKIE)?.value;
  if (isPhoneId(raw)) return raw;
  const id = newPhoneId();
  jar.set(PHONE_COOKIE, id, cookieOptions);
  return id;
}

/** Marks this phone as having the current school code, if there is one. */
export async function rememberSchoolCode(phoneId: string, settings: Settings): Promise<void> {
  if (!settings.school_code) return;
  (await cookies()).set(CODE_COOKIE, schoolCodeProof(phoneId, settings.school_code), cookieOptions);
}

export async function readTries(): Promise<Tries> {
  return parseTries((await cookies()).get(TRIES_COOKIE)?.value);
}

export async function writeTries(tries: Tries): Promise<void> {
  (await cookies()).set(TRIES_COOKIE, formatTries(tries), { ...cookieOptions, maxAge: 60 * 60 });
}

export async function clearTries(): Promise<void> {
  (await cookies()).delete(TRIES_COOKIE);
}
