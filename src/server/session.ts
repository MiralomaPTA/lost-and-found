import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { cache } from "react";
import { formatTries, parseTries, type Tries } from "@/server/codes";
import { CODE_COOKIE, cookieOptions, FRESH_COOKIE, FRESH_SECONDS, PHONE_COOKIE, TRIES_COOKIE } from "@/server/cookies";
import { getDeps, type Deps } from "@/server/deps";
import { loadItems, type ItemsFile } from "@/server/items";
import { getDevice, hasSchoolCode, isAdminDevice, isPhoneId, newPhoneId, schoolCodeProof, touchDevice, type Device } from "@/server/phones";
import { loadSettings, type Settings } from "@/server/settings";

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

/**
 * items.json for this request, read once. Usually from the few-second cache;
 * fresh for a phone that has just added something (see FRESH_COOKIE).
 */
export const getItemsFile = cache(async (): Promise<ItemsFile> => {
  const fresh = (await cookies()).has(FRESH_COOKIE);
  return loadItems(await getDeps(), { fresh });
});

export type AdminVisitor = Visitor & { phoneId: string; device: Device };

/** The visitor if this phone is an admin, otherwise null. */
export async function currentAdmin(): Promise<AdminVisitor | null> {
  const visitor = await getVisitor();
  return visitor.isAdmin && visitor.phoneId && visitor.device ? (visitor as AdminVisitor) : null;
}

/** For admin pages: the admin, or a redirect to the code screen. */
export async function requireAdmin(): Promise<AdminVisitor> {
  const admin = await currentAdmin();
  if (!admin) redirect("/code");
  return admin;
}

/** The address a request came from, for counting wrong codes. Vercel sets x-forwarded-for. */
export async function clientAddress(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

// --- Cookie writers. Server actions only: cookies can't be set while a page renders. ---

/**
 * This phone's ID, or a new one (with its cookie) if it has none.
 *
 * With `onlyIfKnown`, an ID that has no file behind it is replaced too. The
 * admin code uses this, so it's only ever granted to an ID this app handed out
 * and recorded, never to one someone planted in the browser beforehand.
 */
export async function ensurePhoneId(deps: Deps, { onlyIfKnown = false }: { onlyIfKnown?: boolean } = {}): Promise<string> {
  const jar = await cookies();
  const raw = jar.get(PHONE_COOKIE)?.value;
  if (isPhoneId(raw) && (!onlyIfKnown || (await getDevice(deps, raw)))) return raw;
  const id = newPhoneId();
  jar.set(PHONE_COOKIE, id, cookieOptions);
  return id;
}

/** Marks this phone as having the current school code, if there is one. */
export async function rememberSchoolCode(phoneId: string, settings: Settings): Promise<void> {
  if (!settings.school_code) return;
  (await cookies()).set(CODE_COOKIE, schoolCodeProof(phoneId, settings), cookieOptions);
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

/** After this phone adds an item: its next pages read items.json fresh for a minute. */
export async function readYourWrites(): Promise<void> {
  (await cookies()).set(FRESH_COOKIE, "1", { ...cookieOptions, maxAge: FRESH_SECONDS });
}
