import { z } from "zod";
import { adminCodeProblem, normalizeCode, schoolCodeProblem } from "@/server/codes";
import type { Deps } from "@/server/deps";

export const SETTINGS_KEY = "settings.json";

const typeSchema = z.object({ name: z.string().min(1).max(40), sort: z.number(), active: z.boolean() });

const colorSchema = z.object({
  name: z.string().min(1).max(40),
  /** A hex color for the swatch, or "multicolor" for the rainbow swatch. */
  swatch: z.union([z.string().regex(/^#[0-9A-Fa-f]{6}$/), z.literal("multicolor")]),
  sort: z.number(),
  active: z.boolean(),
});

const clearOutChangeSchema = z.object({
  /** The second Friday this change is about, YYYY-MM-DD. */
  date: z.string(),
  change: z.enum(["moved", "skipped"]),
  moved_to: z.string().nullable(),
  note: z.string().nullable(),
});

export const settingsSchema = z.object({
  version: z.literal(1),
  /** Stored normalized (lowercase, single spaces). Null until an admin sets the first one. */
  school_code: z.string().nullable(),
  code_changed_at: z.string().nullable(),
  admin_code: z.string().nullable(),
  /** The admin code's version: a phone is an admin while its file holds this same value. */
  admin_code_changed_at: z.string().nullable(),
  /** Finishes "Pick it up from the lost-and-found bin …". */
  bin_description: z.string().min(1).max(120),
  types: z.array(typeSchema),
  colors: z.array(colorSchema),
  clear_out_changes: z.array(clearOutChangeSchema),
});

export type Settings = z.infer<typeof settingsSchema>;
export type ItemType = z.infer<typeof typeSchema>;
export type ItemColor = z.infer<typeof colorSchema>;

/** The starting lists from the spec (open question 6). */
const STARTING_TYPES = ["Jacket", "Shirt", "Hoodie", "Sweatshirt", "Hat/Gloves", "Shoes", "Water bottle", "Lunch box", "Backpack", "Toy & sports", "Other"];

const STARTING_COLORS: [string, string][] = [
  ["Black", "#1F1F22"],
  ["White", "#FFFFFF"],
  ["Gray", "#9AA0A8"],
  ["Navy", "#22305C"],
  ["Blue", "#2F6FD6"],
  ["Light blue", "#8EC5F0"],
  ["Green", "#3E9B5C"],
  ["Red", "#D63B33"],
  ["Pink", "#F29CC0"],
  ["Purple", "#7C5CC4"],
  ["Orange", "#F08A24"],
  ["Yellow", "#F2C230"],
  ["Brown", "#7A5230"],
  ["Tan", "#D2B48C"],
  ["Multicolor", "multicolor"],
];

export function startingSettings(now: Date, initialAdminCode: string | null): Settings {
  const adminCode = usableInitialAdminCode(initialAdminCode);
  return {
    version: 1,
    school_code: null,
    code_changed_at: null,
    admin_code: adminCode,
    admin_code_changed_at: adminCode ? now.toISOString() : null,
    bin_description: "by the main office",
    types: STARTING_TYPES.map((name, i) => ({ name, sort: i, active: true })),
    colors: STARTING_COLORS.map(([name, swatch], i) => ({ name, swatch, sort: i, active: true })),
    clear_out_changes: [],
  };
}

let warnedAboutInitialCode = false;

/** INITIAL_ADMIN_CODE, normalized, if it's long enough to use. A too-short one is ignored with a warning. */
function usableInitialAdminCode(code: string | null): string | null {
  if (!code) return null;
  const problem = adminCodeProblem(code, null);
  if (problem) {
    if (!warnedAboutInitialCode) console.warn(`INITIAL_ADMIN_CODE is ignored: ${problem}`);
    warnedAboutInitialCode = true;
    return null;
  }
  return normalizeCode(code);
}

/**
 * settings.json, created with the starting lists on first use. If it has no
 * admin code yet and INITIAL_ADMIN_CODE is set, that code is copied in, so
 * setting the variable after the first deploy still works.
 */
export async function loadSettings(deps: Deps): Promise<Settings> {
  const existing = await deps.docs.read(SETTINGS_KEY, settingsSchema);
  if (existing && (existing.admin_code || !usableInitialAdminCode(deps.initialAdminCode))) return existing;
  return deps.docs.update(SETTINGS_KEY, settingsSchema, (current) => {
    if (!current) {
      const fresh = startingSettings(deps.now(), deps.initialAdminCode);
      return { value: fresh, result: fresh };
    }
    const adminCode = current.admin_code ? null : usableInitialAdminCode(deps.initialAdminCode);
    if (!adminCode || (current.school_code && normalizeCode(current.school_code) === adminCode)) return { result: current };
    const next = { ...current, admin_code: adminCode, admin_code_changed_at: deps.now().toISOString() };
    return { value: next, result: next };
  });
}

export type CodeChange = { ok: true; settings: Settings } | { ok: false; error: string };

/**
 * A new admin code version: now, or a millisecond after the old one if the
 * clock hasn't moved past it. The version must change, or phones holding the
 * old code would stay admins.
 */
function laterVersion(previous: string | null, now: Date): string {
  const previousMs = previous ? Date.parse(previous) : NaN;
  return new Date(Number.isNaN(previousMs) || now.getTime() > previousMs ? now.getTime() : previousMs + 1).toISOString();
}

/** Every phone without the admin code is asked for the new school code. */
export async function changeSchoolCode(deps: Deps, input: string): Promise<CodeChange> {
  await loadSettings(deps);
  return deps.docs.update<Settings, CodeChange>(SETTINGS_KEY, settingsSchema, (current) => {
    if (!current) throw new Error("settings.json disappeared");
    const problem = schoolCodeProblem(input, current.admin_code);
    if (problem) return { result: { ok: false, error: problem } };
    const code = normalizeCode(input);
    if (current.school_code === code) return { result: { ok: true, settings: current } };
    const next = { ...current, school_code: code, code_changed_at: deps.now().toISOString() };
    return { value: next, result: { ok: true, settings: next } };
  });
}

/** Every phone that had the old admin code becomes an ordinary phone. */
export async function changeAdminCode(deps: Deps, input: string): Promise<CodeChange> {
  await loadSettings(deps);
  return deps.docs.update<Settings, CodeChange>(SETTINGS_KEY, settingsSchema, (current) => {
    if (!current) throw new Error("settings.json disappeared");
    const problem = adminCodeProblem(input, current.school_code);
    if (problem) return { result: { ok: false, error: problem } };
    const code = normalizeCode(input);
    if (current.admin_code === code) return { result: { ok: false, error: "That's already the admin code." } };
    const next = { ...current, admin_code: code, admin_code_changed_at: laterVersion(current.admin_code_changed_at, deps.now()) };
    return { value: next, result: { ok: true, settings: next } };
  });
}
