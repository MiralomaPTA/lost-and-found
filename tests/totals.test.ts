import { describe, expect, it } from "vitest";
import { removeItem } from "@/server/admin-items";
import { closeList } from "@/server/clear-out";
import { addItem, claimItem, emptyItemsFile, markNotThere, undoAdd, unclaimItem, type ItemsFile } from "@/server/items";
import { foldTotals, resetTotal, totalsOf, totalsResetAt } from "@/server/totals";
import { PHONE_A, PHONE_B, PHONE_C, photoNames } from "./helpers";

/* The running totals of items posted, claimed and donated (spec: *Totals*). */

const NOW = new Date("2026-12-07T18:00:00Z");
const later = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

function listOf(count: number, at = NOW): ItemsFile {
  const file = emptyItemsFile();
  for (let i = 0; i < count; i++) addItem(file, { type: "Jacket", color: "Navy", has_name: false, ...photoNames(), phoneId: PHONE_A, name: "Volunteer" }, at);
  return file;
}
const claim = (file: ItemsFile, itemId: string, claimId: string, at = NOW) => claimItem(file, { itemId, phoneId: PHONE_B, name: "Lee family", claimId }, at);
const clearOut = (file: ItemsFile, at: Date) => closeList(file, { date: "2026-12-11", adminId: PHONE_C, adminName: "Dana K.", run: "0123456789abcdef" }, at);

describe("the totals", () => {
  it("count what's on the list: posted, claimed and kept, and nothing donated yet", () => {
    const file = listOf(5);
    claim(file, "L-0001", "c-0000000001");
    claim(file, "L-0002", "c-0000000002");
    expect(totalsOf(file)).toEqual({ posted: 5, claimed: 2, donated: 0 });
  });

  it("leave out adds taken back and items removed as a mistake, but keep other removals", () => {
    const file = listOf(4);
    expect(undoAdd(file, { itemId: "L-0001", phoneId: PHONE_A }, later(1)).ok).toBe(true);
    expect(removeItem(file, { itemId: "L-0002", adminId: PHONE_C, reason: "duplicate or mistake" }, later(1)).ok).toBe(true);
    expect(removeItem(file, { itemId: "L-0003", adminId: PHONE_C, reason: "returned in person" }, later(1)).ok).toBe(true);
    expect(totalsOf(file).posted).toBe(2);
  });

  it("don't count a claim that was given back or wasn't there", () => {
    const file = listOf(3);
    claim(file, "L-0001", "c-0000000001");
    claim(file, "L-0002", "c-0000000002");
    claim(file, "L-0003", "c-0000000003");
    expect(unclaimItem(file, { itemId: "L-0001", claimId: "c-0000000001", phoneId: PHONE_B }, later(1)).ok).toBe(true);
    expect(markNotThere(file, { itemId: "L-0002", claimId: "c-0000000002", phoneId: PHONE_B }, later(1)).ok).toBe(true);
    expect(totalsOf(file)).toEqual({ posted: 3, claimed: 1, donated: 0 });
  });

  it("carry across a clear-out: what was left is donated, and the next list adds to them", () => {
    const file = listOf(5);
    claim(file, "L-0001", "c-0000000001");
    const { next } = clearOut(file, later(60));
    expect(next.items).toEqual([]);
    expect(totalsOf(next)).toEqual({ posted: 5, claimed: 1, donated: 4 });
    addItem(next, { type: "Shirt", color: "Red", has_name: false, ...photoNames(), phoneId: PHONE_A, name: "Volunteer" }, later(120));
    expect(totalsOf(next)).toEqual({ posted: 6, claimed: 1, donated: 4 });
  });

  it("start a list from before totals with what its past clear-outs recorded", () => {
    const file = listOf(2);
    file.clear_outs = [
      { date: "2026-11-13", done_at: "2026-11-13T23:00:00Z", done_by_name: "Dana K.", donated: 30, picked_up: 12, removed: 3 },
      { date: "2026-10-09", done_at: "2026-10-09T23:00:00Z", done_by_name: "Dana K.", donated: 20, picked_up: 8, removed: 2 },
    ];
    expect(totalsOf(file)).toEqual({ posted: 75 + 2, claimed: 20, donated: 50 });
  });

  it("let an admin reset one to 0, and count again from then", () => {
    const file = listOf(3);
    claim(file, "L-0001", "c-0000000001");
    const { next, was } = resetTotal(file, "posted", later(5));
    expect(was).toBe(3);
    expect(totalsOf(next)).toEqual({ posted: 0, claimed: 1, donated: 0 });
    expect(totalsResetAt(next)).toEqual({ posted: later(5).toISOString(), claimed: null, donated: null });
    addItem(next, { type: "Shirt", color: "Red", has_name: false, ...photoNames(), phoneId: PHONE_A, name: "Volunteer" }, later(10));
    expect(totalsOf(next).posted).toBe(1);
    // The items from before the reset still don't count once the clear-out folds them in.
    const { next: after } = clearOut(next, later(60));
    expect(totalsOf(after)).toEqual({ posted: 1, claimed: 1, donated: 3 });
  });

  it("don't count a claim made before its reset, even after the clear-out", () => {
    const file = listOf(2);
    claim(file, "L-0001", "c-0000000001", later(1));
    const { next } = resetTotal(file, "claimed", later(5));
    claim(next, "L-0002", "c-0000000002", later(10));
    expect(totalsOf(next).claimed).toBe(1);
    expect(foldTotals(next, next.items).claimed.base).toBe(1);
  });
});
