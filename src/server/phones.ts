import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { normalizeCode } from "@/server/codes";
import type { Deps } from "@/server/deps";
import type { Settings } from "@/server/settings";

/**
 * A phone is a random ID in a cookie. It gets a file, devices/<id>.json, only
 * once it has something to remember: a name (first claim or add) or the admin
 * code. Nothing else is stored about anyone (spec: *Everyone*).
 */

const PHONE_ID = /^[0-9a-f]{32}$/;

export const deviceSchema = z.object({
  id: z.string().regex(PHONE_ID),
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
  return typeof value === "string" && PHONE_ID.test(value);
}

export function deviceKey(id: string): string {
  if (!isPhoneId(id)) throw new Error("Not a phone ID");
  return `devices/${id}.json`;
}

/**
 * The value of the cookie that says this phone entered the current school
 * code. It can't be made without knowing the code, and it stops matching as
 * soon as an admin changes the code.
 */
export function schoolCodeProof(phoneId: string, schoolCode: string): string {
  return createHash("sha256").update(`${phoneId}:${normalizeCode(schoolCode)}`).digest("hex").slice(0, 32);
}

export function hasSchoolCode(settings: Settings, phoneId: string, cookieValue: string | undefined): boolean {
  if (!settings.school_code || !cookieValue || cookieValue.length !== 32) return false;
  return timingSafeEqual(Buffer.from(cookieValue), Buffer.from(schoolCodeProof(phoneId, settings.school_code)));
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

export async function getDevice(deps: Deps, id: string): Promise<Device | null> {
  return deps.docs.read(deviceKey(id), deviceSchema);
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

/** Rewrites the phone's file at most once a day to update last_seen_at (the clear-out drops phones unseen for a year). */
export async function touchDevice(deps: Deps, device: Device): Promise<void> {
  const now = deps.now();
  if (now.getTime() - Date.parse(device.last_seen_at) < DAY_MS) return;
  await updateDevice(deps, device.id, (current) => ({ ...current, last_seen_at: now.toISOString() }));
}
