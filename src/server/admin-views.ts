import { ageLabel, whenLabel } from "@/lib/dates";
import type { Deps } from "@/server/deps";
import { openClaim, type Claim, type Item, type ItemsFile } from "@/server/items";
import { phoneCode } from "@/server/phone-code";
import { getDevice } from "@/server/phones";
import { photoUrl } from "@/server/photos";
import { itemLabel } from "@/server/views";

/*
 * What the admin pages show (spec section 6). Admins see item numbers, the
 * names families gave and a short code for each phone, never a phone's ID.
 */

export const STATUS_FILTERS = ["all", "available", "claimed", "removed"] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

export interface AdminQuery {
  status: StatusFilter;
  sort: "newest" | "oldest";
}

type Params = Record<string, string | string[] | undefined>;

export function parseAdminQuery(params: Params): AdminQuery {
  const one = (key: string) => (Array.isArray(params[key]) ? params[key][0] : params[key]);
  const status = STATUS_FILTERS.find((s) => s === one("status")) ?? "all";
  return { status, sort: one("sort") === "oldest" ? "oldest" : "newest" };
}

export function adminSearch(query: AdminQuery): string {
  const params = new URLSearchParams();
  if (query.status !== "all") params.set("status", query.status);
  if (query.sort === "oldest") params.set("sort", "oldest");
  const search = params.toString();
  return search ? `?${search}` : "";
}

const inFilter = (item: Item, status: StatusFilter) => (status === "all" ? item.status !== "donated" : item.status === status);

export function adminItems(file: ItemsFile, query: AdminQuery): Item[] {
  const direction = query.sort === "oldest" ? 1 : -1;
  return file.items.filter((item) => inFilter(item, query.status)).sort((a, b) => direction * (a.added_at.localeCompare(b.added_at) || a.id.localeCompare(b.id)));
}

export function statusCounts(file: ItemsFile): Record<StatusFilter, number> {
  return Object.fromEntries(STATUS_FILTERS.map((status) => [status, file.items.filter((item) => inFilter(item, status)).length])) as Record<StatusFilter, number>;
}

/** "Not in the bin", "Duplicate or mistake"; "add undone" reads better as who did it. */
export function reasonLabel(reason: Item["removed_reason"]): string {
  if (!reason) return "Removed";
  if (reason === "add undone") return "Undone by whoever added it";
  return reason[0].toUpperCase() + reason.slice(1);
}

/** The names of the phones that did things (admins who removed items or undid claims), read from their files. */
export async function phoneNames(deps: Deps, ids: Iterable<string | null | undefined>): Promise<Map<string, string>> {
  const unique = [...new Set([...ids].filter((id): id is string => Boolean(id)))];
  const devices = await Promise.all(unique.map((id) => getDevice(deps, id).catch(() => null)));
  return new Map(unique.map((id, i) => [id, devices[i]?.name ?? `Phone ${phoneCode(id)}`]));
}

/** Every phone ID on the list that did something an admin page names. */
export function actorIds(file: ItemsFile): string[] {
  return file.items.flatMap((item) => [item.removed_by, ...item.claims.map((claim) => claim.ended_by)].filter((id): id is string => Boolean(id)));
}

export interface AdminCard {
  id: string;
  href: string;
  title: string;
  label: string;
  thumb: string;
  age: string;
  addedBy: string;
  hasName: boolean;
  status: Item["status"];
  statusText: string;
}

export function adminCard(item: Item, now: Date): AdminCard {
  const claim = openClaim(item);
  return {
    id: item.id,
    href: `/admin/items/${item.id}`,
    title: `${item.type} · ${item.color}`,
    label: itemLabel(item),
    thumb: photoUrl(item.thumb),
    age: ageLabel(item.added_at, now),
    addedBy: item.added_by_name,
    hasName: item.has_name,
    status: item.status,
    statusText: item.status === "claimed" ? `Claimed · ${claim?.name ?? "a family"}` : item.status === "removed" ? `Removed · ${reasonLabel(item.removed_reason)}` : "Available",
  };
}

export interface AdminClaimRow {
  itemId: string;
  claimId: string;
  title: string;
  label: string;
  thumb: string;
  href: string;
  name: string;
  phone: string;
  when: string;
  state: Claim["status"];
  /** "Undone by Dana", "Unclaimed by the family", "Said it wasn't there"… */
  outcome: string | null;
  note: string | null;
}

function claimRow(item: Item, claim: Claim, names: Map<string, string>, now: Date): AdminClaimRow {
  const ender = claim.ended_by ? (names.get(claim.ended_by) ?? `Phone ${phoneCode(claim.ended_by)}`) : null;
  const ended = claim.ended_at ? whenLabel(claim.ended_at, now) : "";
  const outcome =
    claim.status === "open"
      ? null
      : claim.status === "unclaimed"
        ? `Unclaimed by the family · ${ended}`
        : claim.status === "not found"
          ? `Said it wasn't there · ${ended}`
          : claim.status === "undone"
            ? `${item.status === "removed" && item.removed_at === claim.ended_at ? "Item removed" : "Undone"} by ${ender} · ${ended}`
            : "Picked up";
  return {
    itemId: item.id,
    claimId: claim.id,
    title: `${item.type} · ${item.color}`,
    label: itemLabel(item),
    thumb: photoUrl(item.thumb),
    href: `/admin/items/${item.id}`,
    name: claim.name,
    phone: phoneCode(claim.device_id),
    when: whenLabel(claim.claimed_at, now),
    state: claim.status,
    outcome,
    note: claim.note,
  };
}

/** The claims on the list, newest first. */
export function recentClaims(file: ItemsFile, names: Map<string, string>, now: Date, limit = 100): AdminClaimRow[] {
  return file.items
    .flatMap((item) => item.claims.map((claim) => ({ item, claim })))
    .sort((a, b) => b.claim.claimed_at.localeCompare(a.claim.claimed_at))
    .slice(0, limit)
    .map(({ item, claim }) => claimRow(item, claim, names, now));
}

export interface MissingRow extends AdminClaimRow {
  /** When the family said it wasn't there. */
  reported: string;
}

/** Items families marked *It wasn't there*, still off the list, newest report first. */
export function reportedMissing(file: ItemsFile, names: Map<string, string>, now: Date): MissingRow[] {
  return file.items
    .filter((item) => item.status === "removed" && item.removed_reason === "not in the bin")
    .flatMap((item) => {
      const claim = item.claims.find((c) => c.status === "not found" && c.ended_at === item.removed_at) ?? item.claims.findLast((c) => c.status === "not found");
      return claim ? [{ row: { ...claimRow(item, claim, names, now), reported: whenLabel(claim.ended_at ?? item.removed_at!, now) }, at: item.removed_at ?? "" }] : [];
    })
    .sort((a, b) => b.at.localeCompare(a.at))
    .map(({ row }) => row);
}

export interface AdminItemView {
  id: string;
  title: string;
  label: string;
  photo: string;
  status: Item["status"];
  statusText: string;
  type: string;
  color: string;
  hasName: boolean;
  added: string;
  addedBy: string;
  addedPhone: string;
  removed: { reason: string; by: string; when: string } | null;
  open: { claimId: string; name: string; phone: string; when: string } | null;
  claims: AdminClaimRow[];
  /** The family's item page. */
  publicHref: string;
}

export function adminItemView(item: Item, names: Map<string, string>, now: Date): AdminItemView {
  const claim = openClaim(item);
  const card = adminCard(item, now);
  return {
    id: item.id,
    title: card.title,
    label: card.label,
    photo: photoUrl(item.photo),
    status: item.status,
    statusText: card.statusText,
    type: item.type,
    color: item.color,
    hasName: item.has_name,
    added: whenLabel(item.added_at, now),
    addedBy: item.added_by_name,
    addedPhone: phoneCode(item.added_by),
    removed:
      item.status === "removed"
        ? {
            reason: reasonLabel(item.removed_reason),
            by: item.removed_by ? (names.get(item.removed_by) ?? `Phone ${phoneCode(item.removed_by)}`) : "someone",
            when: item.removed_at ? whenLabel(item.removed_at, now) : "",
          }
        : null,
    open: claim ? { claimId: claim.id, name: claim.name, phone: phoneCode(claim.device_id), when: whenLabel(claim.claimed_at, now) } : null,
    claims: [...item.claims].reverse().map((c) => claimRow(item, c, names, now)),
    publicHref: `/items/${item.id}`,
  };
}
