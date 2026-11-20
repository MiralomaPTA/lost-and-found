import { describe, expect, it } from "vitest";
import { gridSearch, NO_FILTERS, parseGridQuery, type GridQuery } from "@/lib/grid-query";
import { archiveKey, findArchivedItem, type Archive } from "@/server/archives";
import { addItem, claimItem, emptyItemsFile, markNotThere, unclaimItem, type ItemsFile } from "@/server/items";
import { startingSettings } from "@/server/settings";
import { archivedItemView, cardView, gridItems, itemPageView, myItemsView, openClaimCount, swatchFor } from "@/server/views";
import { PHONE_A, PHONE_B, PHONE_C, photoNames, testDeps } from "./helpers";

const NOW = new Date("2026-12-07T18:00:00Z");
const settings = startingSettings(NOW, null);
const DAY = 24 * 60 * 60 * 1000;

/** Items added 0, 1, 2… days ago, oldest first. */
function bin(specs: { type?: string; color?: string; has_name?: boolean; daysAgo: number }[]): ItemsFile {
  const file = emptyItemsFile();
  for (const spec of [...specs].sort((a, b) => b.daysAgo - a.daysAgo)) {
    addItem(
      file,
      { type: spec.type ?? "Jacket", color: spec.color ?? "Navy", has_name: spec.has_name ?? false, ...photoNames(), phoneId: PHONE_A, name: "Volunteer" },
      new Date(NOW.getTime() - spec.daysAgo * DAY),
    );
  }
  return file;
}

const query = (q: Partial<GridQuery>): GridQuery => ({ ...NO_FILTERS, ...q });

describe("the grid's address", () => {
  it("reads filters from the address and writes them back, leaving out defaults", () => {
    const q = parseGridQuery({ type: "Water bottle", color: ["Blue", "Red"], named: "1", new: "1", sort: "oldest" });
    expect(q).toEqual({ type: "Water bottle", color: "Blue", named: true, recent: true, sort: "oldest" });
    expect(parseGridQuery(new URLSearchParams(gridSearch(q)))).toEqual(q);
    expect(gridSearch(NO_FILTERS)).toBe("");
  });

  it("ignores junk", () => {
    expect(parseGridQuery({ sort: "sideways", named: "yes", type: "x".repeat(200) })).toEqual(NO_FILTERS);
  });
});

describe("the grid", () => {
  const file = bin([
    { daysAgo: 0, type: "Jacket", color: "Navy", has_name: true },
    { daysAgo: 3, type: "Water bottle", color: "Blue" },
    { daysAgo: 9, type: "Jacket", color: "Red" },
  ]);

  it("shows available items, newest first by default", () => {
    claimItem(file, { itemId: "L-0002", phoneId: PHONE_B, name: "B", claimId: "c-0000000001" }, NOW);
    expect(gridItems(file, NO_FILTERS, NOW).map((i) => i.id)).toEqual(["L-0003", "L-0001"]);
    expect(gridItems(file, query({ sort: "oldest" }), NOW).map((i) => i.id)).toEqual(["L-0001", "L-0003"]);
    unclaimItem(file, { itemId: "L-0002", claimId: "c-0000000001", phoneId: PHONE_B }, NOW);
  });

  it("filters by type, color, name and this week", () => {
    expect(gridItems(file, query({ type: "Jacket" }), NOW).map((i) => i.id)).toEqual(["L-0003", "L-0001"]);
    expect(gridItems(file, query({ color: "Blue" }), NOW).map((i) => i.id)).toEqual(["L-0002"]);
    expect(gridItems(file, query({ named: true }), NOW).map((i) => i.id)).toEqual(["L-0003"]);
    expect(gridItems(file, query({ recent: true }), NOW).map((i) => i.id)).toEqual(["L-0003", "L-0002"]);
  });

  it("builds cards with no phone IDs or names in them", () => {
    const card = cardView(file.items[2], settings, NOW, query({ type: "Jacket" }));
    expect(card).toMatchObject({ id: "L-0003", href: "/items/L-0003?type=Jacket", label: "Navy jacket", age: "Today", hasName: true });
    expect(card.thumb).toMatch(/^\/photos\/[0-9a-f]{32}-thumb\.jpg$/);
    expect(JSON.stringify(card)).not.toMatch(/a{32}|Volunteer/);
  });

  it("outlines light swatches", () => {
    expect(swatchFor(settings, "White").light).toBe(true);
    expect(swatchFor(settings, "Navy").light).toBe(false);
    expect(swatchFor(settings, "Multicolor").background).toMatch(/conic-gradient/);
    expect(swatchFor(settings, "Chartreuse").background).toBe("#C9CED8");
  });
});

describe("the item page", () => {
  it("steps through the current list", () => {
    const file = bin([{ daysAgo: 0 }, { daysAgo: 1, type: "Hoodie" }, { daysAgo: 2 }]);
    const middle = file.items.find((i) => i.id === "L-0002")!;
    const view = itemPageView(middle, file, settings, PHONE_B, NO_FILTERS, NOW);
    expect(view).toMatchObject({ kind: "on-list", state: "available", position: { index: 1, total: 3, prev: "/items/L-0003", next: "/items/L-0001" } });
    // Filtered to jackets, the hoodie isn't in the list, so there's nowhere to step.
    const jacket = itemPageView(file.items[0], file, settings, PHONE_B, query({ type: "Jacket" }), NOW);
    expect(jacket).toMatchObject({ position: { index: 1, total: 2, prev: "/items/L-0003?type=Jacket", next: null } });
  });

  it("knows the phone's own claim from someone else's, without saying whose", () => {
    const file = bin([{ daysAgo: 0 }]);
    claimItem(file, { itemId: "L-0001", phoneId: PHONE_B, name: "Lee family", claimId: "c-0000000001" }, NOW);
    expect(itemPageView(file.items[0], file, settings, PHONE_B, NO_FILTERS, NOW)).toMatchObject({ state: "mine", claimId: "c-0000000001" });
    const other = itemPageView(file.items[0], file, settings, PHONE_C, NO_FILTERS, NOW);
    expect(other).toMatchObject({ state: "claimed", claimId: null, position: null });
    expect(JSON.stringify(other)).not.toMatch(/b{32}|Lee family/);
  });

  it("shows nothing of a removed item", () => {
    const file = bin([{ daysAgo: 0 }]);
    file.items[0].status = "removed";
    expect(itemPageView(file.items[0], file, settings, PHONE_B, NO_FILTERS, NOW)).toEqual({ kind: "removed" });
  });
});

function archiveOf(file: ItemsFile, date: string): Archive {
  return {
    version: 1,
    date,
    done_at: `${date}T23:00:00Z`,
    done_by: PHONE_A,
    donated_count: 0,
    picked_up_count: 0,
    items: file.items.map((item) => ({ ...item, photo: null, thumb: null })),
  };
}

describe("old links", () => {
  it("finds an item from before a clear-out, and stops looking when it can't be there", async () => {
    const t = testDeps();
    const nov = bin([{ daysAgo: 30 }, { daysAgo: 29 }]);
    nov.items[0].status = "donated";
    nov.items[0].donated_at = "2026-11-14T03:00:00Z";
    nov.items[1].status = "removed";
    await t.store.put(archiveKey("2026-11-13"), new TextEncoder().encode(JSON.stringify(archiveOf(nov, "2026-11-13"))));
    const current = { ...emptyItemsFile(), next_number: 5, last_clear_out: { date: "2026-11-13", done_at: "2026-11-13T23:00:00Z" } };
    current.items = bin([{ daysAgo: 1 }, { daysAgo: 0 }]).items.map((item, i) => ({ ...item, id: `L-000${i + 3}` }));

    const found = await findArchivedItem(t.deps, current, "L-0001");
    expect(found?.item.id).toBe("L-0001");
    expect(archivedItemView(found!.item, settings)).toMatchObject({ kind: "archived", donatedOn: "Nov 13" });
    const removed = await findArchivedItem(t.deps, current, "L-0002");
    expect(archivedItemView(removed!.item, settings)).toEqual({ kind: "removed" });
    // On the current list's range, or never handed out: no archive reads at all.
    expect(await findArchivedItem(t.deps, current, "L-0003")).toBeNull();
    expect(await findArchivedItem(t.deps, current, "L-0009")).toBeNull();
  });

  it("searches newest archive first and stops once the archives are older than the ID", async () => {
    const t = testDeps();
    const put = (date: string, file: ItemsFile, ids: string[]) => {
      const archive = archiveOf(file, date);
      archive.items = archive.items.map((item, i) => ({ ...item, id: ids[i] }));
      return t.store.put(archiveKey(date), new TextEncoder().encode(JSON.stringify(archive)));
    };
    await put("2026-09-11", bin([{ daysAgo: 90 }]), ["L-0001"]);
    const oct = bin([{ daysAgo: 60 }, { daysAgo: 59, type: "Hoodie" }]);
    oct.items[1].status = "claimed";
    await put("2026-10-09", oct, ["L-0002", "L-0003"]);
    // L-0004 was never saved (a number can be skipped).
    await put("2026-11-13", bin([{ daysAgo: 30 }, { daysAgo: 29 }]), ["L-0005", "L-0006"]);
    const current = { ...emptyItemsFile(), next_number: 8, last_clear_out: { date: "2026-11-13", done_at: "2026-11-13T23:00:00Z" } };
    current.items = bin([{ daysAgo: 0 }]).items.map((item) => ({ ...item, id: "L-0007" }));

    const reads: string[] = [];
    const get = t.store.get.bind(t.store);
    t.store.get = async (key) => {
      reads.push(key);
      return get(key);
    };
    const claimedOne = await findArchivedItem(t.deps, current, "L-0003");
    expect(archivedItemView(claimedOne!.item, settings)).toMatchObject({ kind: "archived", type: "Hoodie", donatedOn: null });
    expect(reads).toEqual(["archive/2026-11-13.json", "archive/2026-10-09.json"]);
    reads.length = 0;
    // Newer than everything in October's archive and not in November's: September is never read.
    expect(await findArchivedItem(t.deps, current, "L-0004")).toBeNull();
    expect(reads).toEqual(["archive/2026-11-13.json", "archive/2026-10-09.json"]);
    expect((await findArchivedItem(t.deps, current, "L-0001"))?.archive.date).toBe("2026-09-11");
  });
});

describe("My items", () => {
  it("lists this phone's claims, newest first, and the last clear-out's as picked up", () => {
    const file = bin([{ daysAgo: 3 }, { daysAgo: 2, type: "Hoodie" }, { daysAgo: 1, type: "Lunch box" }, { daysAgo: 0, type: "Shoes" }]);
    const at = (daysAgo: number) => new Date(NOW.getTime() - daysAgo * DAY);
    claimItem(file, { itemId: "L-0001", phoneId: PHONE_B, name: "Lee", claimId: "c-0000000001" }, at(3));
    claimItem(file, { itemId: "L-0002", phoneId: PHONE_B, name: "Lee", claimId: "c-0000000002" }, at(2));
    claimItem(file, { itemId: "L-0003", phoneId: PHONE_B, name: "Lee", claimId: "c-0000000003" }, at(1));
    claimItem(file, { itemId: "L-0004", phoneId: PHONE_C, name: "Other", claimId: "c-0000000004" }, at(0));
    unclaimItem(file, { itemId: "L-0002", claimId: "c-0000000002", phoneId: PHONE_B }, at(1));
    markNotThere(file, { itemId: "L-0003", claimId: "c-0000000003", phoneId: PHONE_B }, NOW);

    const old = bin([{ daysAgo: 40, type: "Backpack" }]);
    old.items[0].claims.push({
      id: "c-00000000aa",
      device_id: PHONE_B,
      name: "Lee",
      claimed_at: at(30).toISOString(),
      status: "picked up",
      ended_at: at(25).toISOString(),
      ended_by: PHONE_A,
      note: null,
    });
    const view = myItemsView(file, archiveOf(old, "2026-11-13"), PHONE_B, NOW);

    expect(view.current.map((r) => [r.itemId, r.state])).toEqual([
      ["L-0003", "not there"],
      ["L-0001", "claimed"],
    ]);
    expect(view.current[0]).toMatchObject({ claimed: "Claimed yesterday", notThere: "today", href: null });
    expect(view.current[1]).toMatchObject({ type: "Jacket", title: "Jacket · Navy", claimed: "Claimed Fri, Dec 4", href: "/items/L-0001" });
    expect(view.pickedUp).toEqual([expect.objectContaining({ itemId: "L-0001", state: "picked up", thumb: null })]);
    expect(view.clearOutDate).toBe("Nov 13");
    expect(JSON.stringify(view)).not.toMatch(/[abc]{32}/);
    expect(openClaimCount(file, PHONE_B)).toBe(1);
    expect(openClaimCount(file, null)).toBe(0);
  });
});
