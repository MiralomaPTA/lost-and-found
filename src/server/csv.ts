import { pacificDateTime } from "@/lib/dates";
import { reasonLabel } from "@/server/admin-views";
import type { Archive, ArchivedItem } from "@/server/archives";
import type { Item } from "@/server/items";
import { phoneCode } from "@/server/phone-code";

/*
 * *Download CSV* (spec: *No hand editing*): the current list on Settings,
 * and each clear-out's items on the *Clear out* tab. Admins only. Like the
 * admin pages, it shows names and short phone codes, never a phone's ID.
 */

type Cell = string | number | boolean | null | undefined;

/**
 * One cell. Text a spreadsheet would run as a formula ("=HYPERLINK(…)" typed
 * as a family's name) gets a leading apostrophe, which shows it as text.
 */
function cell(value: Cell): string {
  if (value === null || value === undefined) return "";
  let text = typeof value === "boolean" ? (value ? "Yes" : "No") : String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) || text !== text.trim() ? `"${text.replace(/"/g, '""')}"` : text;
}

/** With a byte-order mark, so Excel reads it as UTF-8, and Windows line endings, which every spreadsheet takes. */
export function toCsv(header: string[], rows: Cell[][]): string {
  return "﻿" + [header, ...rows].map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
}

const HEADER = ["Item", "Status", "Type", "Color", "Has a name", "Added", "Added by", "Added by phone", "Claimed by", "Claim phone", "Claimed", "Claim", "Removed", "Why removed", "Donated"];

const CLAIM_LABELS = { open: "Open", unclaimed: "Unclaimed by the family", undone: "Undone by an admin", "not found": "It wasn't there", "picked up": "Picked up" } as const;

function statusLabel(item: Item | ArchivedItem): string {
  if (item.status === "claimed") return item.claims.some((c) => c.status === "picked up") ? "Picked up" : "Claimed";
  return item.status[0].toUpperCase() + item.status.slice(1);
}

function itemRow(item: Item | ArchivedItem): Cell[] {
  // The claim that tells the item's story: the open or picked-up one, otherwise the latest.
  const claim = item.claims.find((c) => c.status === "open" || c.status === "picked up") ?? item.claims.at(-1);
  return [
    item.id,
    statusLabel(item),
    item.type,
    item.color,
    item.has_name,
    pacificDateTime(item.added_at),
    item.added_by_name,
    phoneCode(item.added_by),
    claim?.name,
    claim ? phoneCode(claim.device_id) : null,
    claim ? pacificDateTime(claim.claimed_at) : null,
    claim ? CLAIM_LABELS[claim.status] : null,
    item.status === "removed" && item.removed_at ? pacificDateTime(item.removed_at) : null,
    item.status === "removed" ? reasonLabel(item.removed_reason) : null,
    item.donated_at ? pacificDateTime(item.donated_at) : null,
  ];
}

const byNumber = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id, "en", { numeric: true });

export function itemsCsv(items: readonly (Item | ArchivedItem)[]): string {
  return toCsv(HEADER, [...items].sort(byNumber).map(itemRow));
}

export function archiveCsv(archive: Archive): string {
  return itemsCsv(archive.items);
}

/** The answer for a download: never cached anywhere, since it carries names. */
export function csvResponse(body: string, filename: string): Response {
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
