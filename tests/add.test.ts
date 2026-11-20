import { beforeEach, describe, expect, it, vi } from "vitest";

/* Adding items: the upload route, the server side of saving, and the add screens' actions. */
const h = vi.hoisted(() => ({ jar: new Map<string, string>(), deps: { current: null as unknown } }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (h.jar.has(name) ? { name, value: h.jar.get(name)! } : undefined),
    set: (name: string, value: string) => void h.jar.set(name, value),
    delete: (name: string) => void h.jar.delete(name),
  }),
  headers: async () => ({ get: () => "203.0.113.7" }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect to ${url}`);
  },
}));
vi.mock("next/cache", () => ({ refresh: () => {} }));
vi.mock("next/server", () => ({ after: (task: () => unknown) => void Promise.resolve().then(task) }));
vi.mock("@/server/deps", () => ({ getDeps: async () => (h.deps.current as { deps: unknown }).deps }));

import { changeTagsAction, undoAddAction } from "@/app/actions/items";
import { POST } from "@/app/api/items/route";
import { addUploadedItem, type Upload } from "@/server/adding";
import { CODE_COOKIE, FRESH_COOKIE, PHONE_COOKIE } from "@/server/cookies";
import { ADDER_UNDO_MS, changeTags, claimItem, emptyItemsFile, loadItems, undoAdd } from "@/server/items";
import { schoolCodeProof, setDeviceName } from "@/server/phones";
import { changeSchoolCode, loadSettings, type Settings } from "@/server/settings";
import { fakeJpeg, PHONE_A, PHONE_B, testDeps } from "./helpers";

let t: ReturnType<typeof testDeps>;
let settings: Settings;
const REF = "f".repeat(32);

function upload(overrides: Partial<Upload> = {}): Upload {
  return {
    photo: fakeJpeg(1600, 1200, { exif: true }),
    thumb: fakeJpeg(400, 300),
    type: "Jacket",
    color: "Navy",
    hasName: true,
    clientRef: REF,
    ...overrides,
  };
}

const adder = { phoneId: PHONE_A, name: "Volunteer", isAdmin: false };
const text = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes);

async function asPhone(phoneId: string) {
  h.jar.clear();
  h.jar.set(PHONE_COOKIE, phoneId);
  h.jar.set(CODE_COOKIE, schoolCodeProof(phoneId, await loadSettings(t.deps)));
}

beforeEach(async () => {
  t = testDeps();
  h.deps.current = t;
  const changed = await changeSchoolCode(t.deps, "otters");
  if (!changed.ok) throw new Error(changed.error);
  settings = changed.settings;
});

describe("saving an upload", () => {
  it("stores both photos without their metadata and puts the item at the top of the grid", async () => {
    const result = await addUploadedItem(t.deps, settings, adder, upload());
    expect(result).toMatchObject({ ok: true, existing: false, item: { id: "L-0001", type: "Jacket", color: "Navy", has_name: true, added_by: PHONE_A, client_ref: REF } });
    if (!result.ok) return;
    const photo = await t.store.get(`photos/${result.item.photo}`);
    expect(photo?.contentType).toBe("image/jpeg");
    expect(text(photo!.body)).not.toMatch(/GPS|Exif/);
    expect(await t.store.get(`photos/${result.item.thumb}`)).not.toBeNull();
    expect(result.item.thumb).toBe(result.item.photo.replace(".jpg", "-thumb.jpg"));
  });

  it("hands back the same item when an upload is retried", async () => {
    const first = await addUploadedItem(t.deps, settings, adder, upload());
    const again = await addUploadedItem(t.deps, settings, adder, upload());
    expect(again).toMatchObject({ ok: true, existing: true, item: { id: "L-0001" } });
    expect((await loadItems(t.deps, { fresh: true })).items).toHaveLength(1);
    expect(await t.store.list("photos/")).toHaveLength(2);
    expect(first.ok && again.ok && first.item.photo === again.item.photo).toBe(true);
  });

  it("adds one item when the same upload arrives twice at once, and cleans up the spare photos", async () => {
    const [a, b] = await Promise.all([addUploadedItem(t.deps, settings, adder, upload()), addUploadedItem(t.deps, settings, adder, upload())]);
    expect([a.ok && a.existing, b.ok && b.existing].sort()).toEqual([false, true]);
    expect((await loadItems(t.deps, { fresh: true })).items).toHaveLength(1);
    expect(await t.store.list("photos/")).toHaveLength(2);
  });

  it("numbers different uploads in order", async () => {
    await addUploadedItem(t.deps, settings, adder, upload());
    const second = await addUploadedItem(t.deps, settings, adder, upload({ clientRef: "e".repeat(32), type: "Hoodie" }));
    expect(second).toMatchObject({ ok: true, item: { id: "L-0002", type: "Hoodie" } });
  });

  it.each<[string, Partial<Upload>]>([
    ["a type that isn't on the list", { type: "Spaceship" }],
    ["a color that isn't on the list", { color: "Chartreuse" }],
    ["a bad upload reference", { clientRef: "../x" }],
    ["a photo that isn't a JPEG", { photo: new TextEncoder().encode("<svg onload=alert(1)>") }],
    ["a photo larger than 1600 px", { photo: fakeJpeg(2000, 1500) }],
    ["a thumbnail larger than 400 px", { thumb: fakeJpeg(800, 600) }],
    ["an empty thumbnail", { thumb: new Uint8Array() }],
  ])("refuses %s, storing nothing", async (_, overrides) => {
    expect(await addUploadedItem(t.deps, settings, adder, upload(overrides))).toMatchObject({ ok: false, reason: "bad-request" });
    expect(await t.store.list("photos/")).toEqual([]);
    expect((await loadItems(t.deps, { fresh: true })).items).toEqual([]);
  });
});

describe("the adder's undo and fixing tags", () => {
  const NOW = new Date("2026-12-07T16:00:00Z");

  function added() {
    const file = emptyItemsFile();
    file.items.push({
      id: "L-0001",
      status: "available",
      type: "Jacket",
      color: "Navy",
      has_name: false,
      photo: `${"1".repeat(32)}.jpg`,
      thumb: `${"1".repeat(32)}-thumb.jpg`,
      added_by: PHONE_A,
      added_by_name: "Volunteer",
      added_at: NOW.toISOString(),
      updated_at: NOW.toISOString(),
      updated_by: PHONE_A,
      removed_at: null,
      removed_by: null,
      removed_reason: null,
      donated_at: null,
      claims: [],
    });
    file.next_number = 2;
    return file;
  }

  it("lets the adder take it back off the list, as removed", () => {
    const file = added();
    expect(undoAdd(file, { itemId: "L-0001", phoneId: PHONE_A }, NOW).ok).toBe(true);
    expect(file.items[0]).toMatchObject({ status: "removed", removed_reason: "add undone", removed_by: PHONE_A });
  });

  it("doesn't let anyone else, or after a claim, or hours later", () => {
    expect(undoAdd(added(), { itemId: "L-0001", phoneId: PHONE_B }, NOW)).toEqual({ ok: false, reason: "gone" });
    const claimed = added();
    claimItem(claimed, { itemId: "L-0001", phoneId: PHONE_B, name: "Lee", claimId: "c-0000000001" }, NOW);
    expect(undoAdd(claimed, { itemId: "L-0001", phoneId: PHONE_A }, NOW)).toEqual({ ok: false, reason: "taken" });
    expect(undoAdd(added(), { itemId: "L-0001", phoneId: PHONE_A }, new Date(NOW.getTime() + ADDER_UNDO_MS + 1))).toEqual({ ok: false, reason: "late" });
  });

  it("lets anyone fix the tags of an item on the list", () => {
    const file = added();
    const outcome = changeTags(file, { itemId: "L-0001", phoneId: PHONE_B, tags: { type: "Hoodie", color: "Gray", has_name: true } }, NOW);
    expect(outcome).toMatchObject({ ok: true, changed: true, before: { type: "Jacket", color: "Navy", has_name: false } });
    expect(file.items[0]).toMatchObject({ type: "Hoodie", color: "Gray", has_name: true, updated_by: PHONE_B });
    expect(changeTags(file, { itemId: "L-0001", phoneId: PHONE_B, tags: { type: "Hoodie", color: "Gray", has_name: true } }, NOW)).toMatchObject({ changed: false });
    file.items[0].status = "removed";
    expect(changeTags(file, { itemId: "L-0001", phoneId: PHONE_B, tags: { type: "Shirt", color: "Gray", has_name: true } }, NOW)).toEqual({ ok: false, reason: "gone" });
  });

  it("checks the action's inputs and logs the change", async () => {
    await addUploadedItem(t.deps, settings, adder, upload());
    await asPhone(PHONE_B);
    expect(await changeTagsAction("L-0001", { type: "Spaceship", color: "Navy", has_name: false })).toMatchObject({ ok: false, message: /type/ });
    expect(await changeTagsAction("L-0001", { type: "Hoodie", color: "Navy", has_name: "yes" })).toMatchObject({ ok: false });
    expect(await changeTagsAction("L-0001", null)).toMatchObject({ ok: false });
    expect(await changeTagsAction("L-0001", { type: "Hoodie", color: "Gray", has_name: false })).toEqual({ ok: true });
    expect((await loadItems(t.deps, { fresh: true })).items[0]).toMatchObject({ type: "Hoodie", color: "Gray", has_name: false });
    // Only the adder can undo it.
    expect(await undoAddAction("L-0001")).toMatchObject({ ok: false });
    await asPhone(PHONE_A);
    expect(await undoAddAction("L-0001")).toEqual({ ok: true });
    expect((await loadItems(t.deps, { fresh: true })).items[0].status).toBe("removed");
  });
});

describe("POST /api/items", () => {
  function post(fields: Record<string, string | Blob>, headers: Record<string, string> = { origin: "http://localhost:3000", "x-forwarded-host": "localhost:3000" }) {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    return POST(new Request("http://localhost:3000/api/items", { method: "POST", body: form, headers }) as never);
  }
  const fields = () => ({
    photo: new Blob([fakeJpeg(1600, 1200).slice()], { type: "image/jpeg" }),
    thumb: new Blob([fakeJpeg(400, 300).slice()], { type: "image/jpeg" }),
    type: "Water bottle",
    color: "Blue",
    has_name: "0",
    client_ref: REF,
  });

  it("adds the item for a phone with the code and a name", async () => {
    await setDeviceName(t.deps, PHONE_A, "Volunteer");
    await asPhone(PHONE_A);
    const response = await post(fields());
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ ok: true, id: "L-0001" });
    // The phone's next pages read the list fresh, so the new item shows up.
    expect(h.jar.get(FRESH_COOKIE)).toBe("1");
    // A retry gets the same item back.
    const retry = await post(fields());
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual({ ok: true, id: "L-0001" });
    expect((await loadItems(t.deps, { fresh: true })).items[0]).toMatchObject({ type: "Water bottle", has_name: false, added_by_name: "Volunteer" });
  });

  it("refuses other sites, phones without the code, and phones without a name", async () => {
    await asPhone(PHONE_A);
    expect((await post(fields(), { origin: "https://evil.example", "x-forwarded-host": "localhost:3000" })).status).toBe(403);
    expect((await post(fields(), { "x-forwarded-host": "localhost:3000" })).status).toBe(403);
    expect((await post(fields())).status).toBe(409);
    h.jar.clear();
    expect((await post(fields())).status).toBe(401);
    expect((await loadItems(t.deps, { fresh: true })).items).toEqual([]);
  });

  it("answers a bad upload with a message", async () => {
    await setDeviceName(t.deps, PHONE_A, "Volunteer");
    await asPhone(PHONE_A);
    const response = await post({ ...fields(), photo: new Blob(["not a photo"]) });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ ok: false, message: expect.stringMatching(/couldn't be saved/) });
    const missing = await post({ type: "Jacket", color: "Navy", has_name: "0", client_ref: REF });
    expect(missing.status).toBe(400);
  });
});
