import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { normalizeCode } from "@/server/codes";
import { HEX32 } from "@/server/cookies";
import type { Deps } from "@/server/deps";
import { forEachLimited } from "@/server/pool";
import type { Settings } from "@/server/settings";

/**
 * A phone is a random ID in a cookie. It gets a file, devices/<id>.json, only
 * once it has something to remember: a name (first claim or add) or the admin
 * code. Nothing else is stored about anyone (spec: *Everyone*).
 *
 * The ID works like a password for the phone, so it never leaves the server:
 * admins see a short code derived from it, never the ID itself.
 */

export const deviceSchema = z.object({
  id: z.string().regex(HEX32),
  /** What admins see next to this phone's claims and adds, e.g. "Lee family, Rm 12". */
  name: z.string().max(60).nullable(),
  created_at: z.string(),
  last_seen_at: z.string(),
  /** The admin code version this phone entered, or null. It's an admin while this matches settings.json. */
  admin_code_at: z.string().nullable(),
});

export type Device = z.infer<typeof deviceSchema>;

export const NAME_MAX = 60;

export function newPhoneId(): string {
  return randomBytes(16).toString("hex");
}

export function isPhoneId(value: string | undefined | null): value is string {
  return typeof value === "string" && HEX32.test(value);
}

export function deviceKey(id: string): string {
  if (!isPhoneId(id)) throw new Error("Not a phone ID");
  return `devices/${id}.json`;
}

/**
 * The value of the cookie that says this phone entered the current school
 * code. It can't be made without knowing the code. It stops matching when an
 * admin changes the code, and stays stopped even if they later go back to an
 * old one, because it includes when the code was set.
 */
export function schoolCodeProof(phoneId: string, settings: Pick<Settings, "school_code" | "code_changed_at">): string {
  return createHash("sha256")
    .update(`${phoneId}:${normalizeCode(settings.school_code ?? "")}:${settings.code_changed_at ?? ""}`)
    .digest("hex")
    .slice(0, 32);
}

export function hasSchoolCode(settings: Settings, phoneId: string, cookieValue: string | undefined): boolean {
  // Check the shape first: timingSafeEqual throws on inputs of different byte lengths.
  if (!settings.school_code || !cookieValue || !HEX32.test(cookieValue)) return false;
  return timingSafeEqual(Buffer.from(cookieValue), Buffer.from(schoolCodeProof(phoneId, settings)));
}

export function isAdminDevice(settings: Settings, device: Device | null): boolean {
  return Boolean(device?.admin_code_at && settings.admin_code_changed_at && device.admin_code_at === settings.admin_code_changed_at);
}

/** Trims and squeezes spaces. Null when nothing is left. */
export function cleanName(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const name = input.normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, NAME_MAX);
  return name || null;
}

/** Always read fresh: only this phone changes its file, and it should see its own change at once. */
export async function getDevice(deps: Deps, id: string): Promise<Device | null> {
  return deps.docs.read(deviceKey(id), deviceSchema, { fresh: true });
}

function blankDevice(id: string, now: Date): Device {
  return { id, name: null, created_at: now.toISOString(), last_seen_at: now.toISOString(), admin_code_at: null };
}

async function updateDevice(deps: Deps, id: string, change: (device: Device) => Device): Promise<Device> {
  return deps.docs.update(deviceKey(id), deviceSchema, (current) => {
    const next = change(current ?? blankDevice(id, deps.now()));
    return { value: next, result: next };
  });
}

/** Makes the phone an admin for the current admin code, and saves its name if one is given. */
export async function becomeAdmin(deps: Deps, id: string, settings: Settings, name: string | null): Promise<Device> {
  const version = settings.admin_code_changed_at;
  if (!version) throw new Error("There is no admin code yet.");
  return updateDevice(deps, id, (device) => ({
    ...device,
    name: name ?? device.name,
    admin_code_at: version,
    last_seen_at: deps.now().toISOString(),
  }));
}

export async function leaveAdmin(deps: Deps, id: string): Promise<Device> {
  return updateDevice(deps, id, (device) => ({ ...device, admin_code_at: null }));
}

export async function setDeviceName(deps: Deps, id: string, name: string): Promise<Device> {
  return updateDevice(deps, id, (device) => ({ ...device, name }));
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Rewrites the phone's file at most once a day to update last_seen_at (the
 * clear-out drops phones unseen for a year). Checked again against the fresh
 * file, so several requests at the start of a day write once between them.
 */
export async function touchDevice(deps: Deps, device: Device): Promise<void> {
  const now = deps.now();
  const due = (seen: string) => now.getTime() - Date.parse(seen) >= DAY_MS;
  if (!due(device.last_seen_at)) return;
  await deps.docs.update(deviceKey(device.id), deviceSchema, (current) =>
    current && due(current.last_seen_at) ? { value: { ...current, last_seen_at: now.toISOString() }, result: undefined } : { result: undefined },
  );
}

const YEAR_MS = 365 * DAY_MS;

/**
 * Deletes the files of phones not seen in a year (spec: *Retention*); the
 * clear-out runs it. A phone in use rewrites its file at least once a day,
 * so only files last written over a year ago are read to check.
 */
export async function forgetOldPhones(deps: Deps): Promise<number> {
  const cutoff = deps.now().getTime() - YEAR_MS;
  const stale = (await deps.store.listObjects("devices/")).filter((object) => object.modified.getTime() < cutoff);
  let forgotten = 0;
  await forEachLimited(stale, 8, async ({ key }) => {
    const id = /^devices\/([0-9a-f]{32})\.json$/.exec(key)?.[1];
    if (!id) return;
    const device = await getDevice(deps, id).catch(() => null);
    if (!device || Date.parse(device.last_seen_at) >= cutoff) return;
    await deps.store.delete(key);
    forgotten++;
  });
  return forgotten;
}
