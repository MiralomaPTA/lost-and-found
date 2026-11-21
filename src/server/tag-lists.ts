import type { ItemsFile } from "@/server/items";
import type { ItemColor, ItemType, Settings } from "@/server/settings";

/*
 * The types and colors lists on Settings (spec: *Who can do what*). Admins
 * add, rename, hide and reorder them. A hidden one stops being offered when
 * adding, fixing tags and filtering; items that have it keep it. Renaming
 * one renames it on every item on the list too, so they still match the
 * filters. Each change works on a copy of settings.json, inside a safe write.
 */

export type ListKind = "types" | "colors";

/** Longer lists stop fitting on the add screens. */
export const LIST_MAX = 40;
export const TAG_NAME_MAX = 40;

const NOUN = { types: "type", colors: "color" } as const;

export type ListChange = { ok: true; changed: boolean; renamed: { from: string; to: string } | null } | { ok: false; error: string };

/** Trims and squeezes spaces. Null when nothing is left or it's too long. */
export function cleanTagName(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const name = input.normalize("NFKC").trim().replace(/\s+/g, " ");
  return name && name.length <= TAG_NAME_MAX ? name : null;
}

/** "#2F6FD6" (any case in, upper case out) or "multicolor" for the rainbow swatch. */
export function cleanSwatch(input: unknown): string | null {
  if (input === "multicolor") return "multicolor";
  return typeof input === "string" && /^#[0-9a-f]{6}$/i.test(input) ? input.toUpperCase() : null;
}

const same = (a: string, b: string) => a.toLocaleLowerCase("en-US") === b.toLocaleLowerCase("en-US");

type Entry = ItemType | ItemColor;

function entries(settings: Settings, kind: ListKind): Entry[] {
  return settings[kind];
}

function sorted<T extends Entry>(list: T[]): T[] {
  return [...list].sort((a, b) => a.sort - b.sort);
}

function nameProblem(settings: Settings, kind: ListKind, name: string | null, except?: string): string | null {
  if (!name) return `Type a name for the ${NOUN[kind]}, up to ${TAG_NAME_MAX} letters.`;
  const clash = entries(settings, kind).find((entry) => same(entry.name, name) && entry.name !== except);
  return clash ? `There's already a ${NOUN[kind]} called “${clash.name}”.` : null;
}

/** *Add a type* / *Add a color*: it goes at the end of the list. Changes `settings` in place. */
export function addEntry(settings: Settings, kind: ListKind, input: { name: unknown; swatch?: unknown }): ListChange {
  const name = cleanTagName(input.name);
  const problem = nameProblem(settings, kind, name);
  if (problem || !name) return { ok: false, error: problem ?? "Type a name." };
  const list = entries(settings, kind);
  if (list.length >= LIST_MAX) return { ok: false, error: `The list is full: it holds up to ${LIST_MAX}. Hide or rename one instead.` };
  const sort = list.reduce((max, entry) => Math.max(max, entry.sort), -1) + 1;
  if (kind === "colors") {
    const swatch = cleanSwatch(input.swatch);
    if (!swatch) return { ok: false, error: "Pick the swatch's color." };
    settings.colors.push({ name, swatch, sort, active: true });
  } else {
    settings.types.push({ name, sort, active: true });
  }
  return { ok: true, changed: true, renamed: null };
}

/**
 * Renames, re-colors, hides or shows one entry. A retry of a rename that
 * already happened (its answer lost) finds the new name in place, and still
 * reports the rename, so the items on the list get renamed too.
 */
export function editEntry(settings: Settings, kind: ListKind, input: { name: string; newName: unknown; swatch?: unknown; active: unknown }): ListChange {
  const list = entries(settings, kind);
  const entry = list.find((e) => e.name === input.name);
  const newName = cleanTagName(input.newName);
  if (!entry) {
    const already = newName && list.find((e) => e.name === newName);
    if (already && newName !== input.name) return { ok: true, changed: false, renamed: { from: input.name, to: newName } };
    return { ok: false, error: `That ${NOUN[kind]} isn't on the list any more. Reload to see the list.` };
  }
  const problem = nameProblem(settings, kind, newName, entry.name);
  if (problem || !newName) return { ok: false, error: problem ?? "Type a name." };
  if (typeof input.active !== "boolean") return { ok: false, error: "Say whether it shows." };
  if (!input.active && entry.active && list.filter((e) => e.active).length === 1) return { ok: false, error: `Keep at least one ${NOUN[kind]} showing.` };
  let changed = entry.name !== newName || entry.active !== input.active;
  if (kind === "colors") {
    const swatch = cleanSwatch(input.swatch);
    if (!swatch) return { ok: false, error: "Pick the swatch's color." };
    const color = entry as ItemColor;
    changed ||= color.swatch !== swatch;
    color.swatch = swatch;
  }
  const renamed = entry.name !== newName ? { from: entry.name, to: newName } : null;
  entry.name = newName;
  entry.active = input.active;
  return { ok: true, changed, renamed };
}

/**
 * *Reorder*: `names` in their new order. Names that aren't on the list are
 * ignored, and any entry the admin didn't see (another admin just added it)
 * keeps its place after the ones they ordered.
 */
export function reorderEntries(settings: Settings, kind: ListKind, names: unknown): ListChange {
  if (!Array.isArray(names) || names.length > LIST_MAX * 2 || !names.every((n) => typeof n === "string")) return { ok: false, error: "Something went wrong. Reload and try again." };
  const list = sorted(entries(settings, kind));
  const ordered = [...names.flatMap((name) => list.filter((e) => e.name === name)), ...list.filter((e) => !names.includes(e.name))];
  const unique = ordered.filter((entry, i) => ordered.indexOf(entry) === i);
  let changed = false;
  unique.forEach((entry, sort) => {
    changed ||= entry.sort !== sort;
    entry.sort = sort;
  });
  return { ok: true, changed, renamed: null };
}

/** After a rename: every item on the list with the old name gets the new one. Says how many changed. */
export function renameOnList(file: ItemsFile, kind: ListKind, from: string, to: string): number {
  const field = kind === "types" ? "type" : "color";
  let count = 0;
  for (const item of file.items) {
    if (item[field] === from) {
      item[field] = to;
      count++;
    }
  }
  return count;
}

/** How many items on the list (and not yet gone from it) have each name. */
export function inUseCounts(file: ItemsFile, kind: ListKind): Map<string, number> {
  const field = kind === "types" ? "type" : "color";
  const counts = new Map<string, number>();
  for (const item of file.items) {
    if (item.status !== "available" && item.status !== "claimed") continue;
    counts.set(item[field], (counts.get(item[field]) ?? 0) + 1);
  }
  return counts;
}

export const BIN_DESCRIPTION_MAX = 120;

/** "by the main office": it finishes "Pick it up from the lost-and-found bin …". A final period is dropped. */
export function cleanBinDescription(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const text = input.normalize("NFKC").trim().replace(/\s+/g, " ").replace(/[.\s]+$/, "");
  return text && text.length <= BIN_DESCRIPTION_MAX ? text : null;
}
