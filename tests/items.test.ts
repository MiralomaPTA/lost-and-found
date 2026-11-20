import { describe, expect, it } from "vitest";
import {
  addItem,
  changeClaim,
  changeItems,
  claim,
  claimItem,
  emptyItemsFile,
  ITEMS_KEY,
  loadItems,
  markNotThere,
  unclaimItem,
  undoNotThere,
  type ItemsFile,
} from "@/server/items";
import { memoryObjectStore } from "@/server/storage/memory";
import { PHONE_A, PHONE_B, photoNames, racingStore, testDeps } from "./helpers";

const NOW = new Date("2026-12-07T18:00:00Z");

function fileWith(count: number): ItemsFile {
  const file = emptyItemsFile();
  for (let i = 0; i < count; i++) {
    addItem(file, { type: "Jacket", color: "Navy", has_name: false, ...photoNames(), phoneId: PHONE_A, name: "Volunteer" }, NOW);
  }
  return file;
}

const decode = (body: Uint8Array) => JSON.parse(new TextDecoder().decode(body));

describe("adding", () => {
  it("numbers items in order, from L-0001", () => {
    const file = fileWith(2);
    expect(file.items.map((i) => i.id)).toEqual(["L-0001", "L-0002"]);
    expect(file.next_number).toBe(3);
    expect(file.items[0]).toMatchObject({ status: "available", added_by: PHONE_A, added_by_name: "Volunteer", claims: [] });
  });
});

describe("claiming", () => {
  const input = (itemId: string, phoneId: string, claimId = "c-0000000001") => ({ itemId, phoneId, name: "Lee family", claimId });

  it("claims an available item", () => {
    const file = fileWith(1);
    const outcome = claimItem(file, input("L-0001", PHONE_B), NOW);
    expect(outcome).toMatchObject({ ok: true, changed: true });
    expect(file.items[0].status).toBe("claimed");
    expect(file.items[0].claims[0]).toMatchObject({ device_id: PHONE_B, name: "Lee family", status: "open", claimed_at: NOW.toISOString() });
  });

  it("treats a second tap from the same phone as done, and another phone's as too late", () => {
    const file = fileWith(1);
    claimItem(file, input("L-0001", PHONE_B), NOW);
    expect(claimItem(file, input("L-0001", PHONE_B, "c-0000000002"), NOW)).toMatchObject({ ok: true, changed: false, claim: { id: "c-0000000001" } });
    expect(claimItem(file, input("L-0001", PHONE_A, "c-0000000003"), NOW)).toEqual({ ok: false, reason: "taken" });
    expect(file.items[0].claims).toHaveLength(1);
  });

  it("can't claim what isn't on the grid", () => {
    const file = fileWith(1);
    file.items[0].status = "removed";
    expect(claimItem(file, input("L-0001", PHONE_B), NOW)).toEqual({ ok: false, reason: "gone" });
    expect(claimItem(file, input("L-0099", PHONE_B), NOW)).toEqual({ ok: false, reason: "gone" });
  });

  it("lets exactly one of two racing phones have it", async () => {
    const t = testDeps();
    await changeItems(t.deps, (file) => {
      addItem(file, { type: "Jacket", color: "Navy", has_name: false, ...photoNames(), phoneId: PHONE_A, name: "Volunteer" }, NOW);
      return { value: file, result: null };
    });
    const [a, b] = await Promise.all([
      claim(t.deps, { itemId: "L-0001", phoneId: PHONE_A, name: "A" }),
      claim(t.deps, { itemId: "L-0001", phoneId: PHONE_B, name: "B" }),
    ]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect([a, b].find((o) => !o.ok)).toEqual({ ok: false, reason: "taken" });
    const saved = await loadItems(t.deps, { fresh: true });
    expect(saved.items[0].claims).toHaveLength(1);
  });

  it("retries when someone else writes items.json in between", async () => {
    const store = racingStore(memoryObjectStore(), ITEMS_KEY, 0);
    const t = testDeps({ store });
    await changeItems(t.deps, (file) => {
      addItem(file, { type: "Jacket", color: "Navy", has_name: false, ...photoNames(), phoneId: PHONE_A, name: "Volunteer" }, NOW);
      return { value: file, result: null };
    });
    store.arm(2);
    expect(await claim(t.deps, { itemId: "L-0001", phoneId: PHONE_B, name: "B" })).toMatchObject({ ok: true });
    expect(store.puts()).toBe(4);
  });
});

describe("a phone's own claims", () => {
  function claimed(): ItemsFile {
    const file = fileWith(1);
    claimItem(file, { itemId: "L-0001", phoneId: PHONE_B, name: "Lee family", claimId: "c-0000000001" }, NOW);
    return file;
  }
  const own = { itemId: "L-0001", claimId: "c-0000000001", phoneId: PHONE_B };

  it("unclaims: the item goes back on the grid and the claim is kept as unclaimed", () => {
    const file = claimed();
    expect(unclaimItem(file, own, NOW).ok).toBe(true);
    expect(file.items[0].status).toBe("available");
    expect(file.items[0].claims[0]).toMatchObject({ status: "unclaimed", ended_by: PHONE_B });
    expect(unclaimItem(file, own, NOW)).toEqual({ ok: false, reason: "ended" });
  });

  it("won't touch another phone's claim", () => {
    const file = claimed();
    expect(unclaimItem(file, { ...own, phoneId: PHONE_A }, NOW)).toEqual({ ok: false, reason: "gone" });
    expect(markNotThere(file, { ...own, phoneId: PHONE_A }, NOW)).toEqual({ ok: false, reason: "gone" });
    expect(file.items[0].status).toBe("claimed");
  });

  it("marks it not in the bin, and undoes that", () => {
    const file = claimed();
    expect(markNotThere(file, own, NOW).ok).toBe(true);
    expect(file.items[0]).toMatchObject({ status: "removed", removed_reason: "not in the bin", removed_by: PHONE_B });
    expect(file.items[0].claims[0].status).toBe("not found");
    expect(undoNotThere(file, own, NOW).ok).toBe(true);
    expect(file.items[0]).toMatchObject({ status: "claimed", removed_reason: null, removed_by: null, removed_at: null });
    expect(file.items[0].claims[0]).toMatchObject({ status: "open", ended_at: null });
  });

  it("can't undo once an admin has changed the item", () => {
    const file = claimed();
    markNotThere(file, own, NOW);
    // An admin restores it to the grid (a later pull request).
    file.items[0].status = "available";
    file.items[0].removed_reason = null;
    expect(undoNotThere(file, own, NOW)).toEqual({ ok: false, reason: "changed" });
  });

  it("saves only a change that happened", async () => {
    const t = testDeps();
    await changeItems(t.deps, (file) => {
      addItem(file, { type: "Jacket", color: "Navy", has_name: false, ...photoNames(), phoneId: PHONE_A, name: "Volunteer" }, NOW);
      return { value: file, result: null };
    });
    const before = (await t.store.get(ITEMS_KEY))!.etag;
    expect(await changeClaim(t.deps, unclaimItem, own)).toEqual({ ok: false, reason: "gone" });
    expect((await t.store.get(ITEMS_KEY))!.etag).toBe(before);
  });
});

describe("items.json", () => {
  it("starts empty", async () => {
    expect(await loadItems(testDeps().deps)).toEqual(emptyItemsFile());
  });

  it("keeps fields it doesn't know about when it rewrites the file", async () => {
    const t = testDeps();
    const file = fileWith(1);
    const stored = { ...file, future_field: 1, items: [{ ...file.items[0], ai_brand: "Patagonia" }] };
    await t.store.put(ITEMS_KEY, new TextEncoder().encode(JSON.stringify(stored)));
    await claim(t.deps, { itemId: "L-0001", phoneId: PHONE_B, name: "B" });
    const saved = decode((await t.store.get(ITEMS_KEY))!.body);
    expect(saved.future_field).toBe(1);
    expect(saved.items[0].ai_brand).toBe("Patagonia");
    expect(saved.items[0].status).toBe("claimed");
  });

  it("backs up the list as it was before each day's first write", async () => {
    const t = testDeps({ start: "2026-12-07T18:00:00Z" });
    const add = () =>
      changeItems(t.deps, (file) => {
        addItem(file, { type: "Jacket", color: "Navy", has_name: false, ...photoNames(), phoneId: PHONE_A, name: "Volunteer" }, t.deps.now());
        return { value: file, result: null };
      });
    // The first write ever had nothing before it, and it was the day's first.
    await add();
    await add();
    expect(await t.store.list("backups/")).toEqual([]);
    t.advance(24 * 60 * 60 * 1000);
    await add();
    await add();
    expect(await t.store.list("backups/")).toEqual(["backups/items-2026-12-08.json"]);
    expect(decode((await t.store.get("backups/items-2026-12-08.json"))!.body).items).toHaveLength(2);
  });

  it("leaves another server's backup for the day alone", async () => {
    const t = testDeps({ start: "2026-12-07T18:00:00Z" });
    await t.store.put(ITEMS_KEY, new TextEncoder().encode(JSON.stringify(fileWith(1))));
    await t.store.put("backups/items-2026-12-07.json", new TextEncoder().encode('{"theirs":true}'));
    await claim(t.deps, { itemId: "L-0001", phoneId: PHONE_B, name: "B" });
    expect(decode((await t.store.get("backups/items-2026-12-07.json"))!.body)).toEqual({ theirs: true });
  });
});
