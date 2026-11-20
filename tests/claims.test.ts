import { beforeEach, describe, expect, it, vi } from "vitest";

/* The claim actions and the photo route, with Next's request APIs replaced as in actions.test.ts. */
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

import { claimAction, notThereAction, undoNotThereAction, unclaimAction } from "@/app/actions/claims";
import { GET as getPhoto } from "@/app/photos/[name]/route";
import { CODE_COOKIE, PHONE_COOKIE } from "@/server/cookies";
import { addItem, changeItems, loadItems } from "@/server/items";
import { getDevice, schoolCodeProof, setDeviceName } from "@/server/phones";
import { changeSchoolCode, loadSettings } from "@/server/settings";
import { PHONE_A, PHONE_B, PHONE_C, photoNames, testDeps } from "./helpers";

let t: ReturnType<typeof testDeps>;

/** Puts this phone's cookies in the jar, as if it had entered the school code. */
async function asPhone(phoneId: string) {
  h.jar.clear();
  h.jar.set(PHONE_COOKIE, phoneId);
  h.jar.set(CODE_COOKIE, schoolCodeProof(phoneId, await loadSettings(t.deps)));
}

async function activity(): Promise<{ action: string; actor: string; item_id?: string }[]> {
  const keys = (await t.store.list("activity/")).sort();
  return Promise.all(keys.map(async (key) => JSON.parse(new TextDecoder().decode((await t.store.get(key))!.body))));
}

beforeEach(async () => {
  t = testDeps();
  h.deps.current = t;
  await changeSchoolCode(t.deps, "otters");
  await changeItems(t.deps, (file) => {
    for (const type of ["Jacket", "Hoodie"]) {
      addItem(file, { type, color: "Navy", has_name: false, ...photoNames(), phoneId: PHONE_A, name: "Volunteer" }, t.deps.now());
    }
    return { value: file, result: null };
  });
});

describe("claiming", () => {
  it("needs the school code", async () => {
    h.jar.clear();
    expect(await claimAction("L-0001")).toMatchObject({ ok: false, reason: "no-code" });
    h.jar.set(PHONE_COOKIE, PHONE_B);
    h.jar.set(CODE_COOKIE, "0".repeat(32));
    expect(await claimAction("L-0001")).toMatchObject({ ok: false, reason: "no-code" });
  });

  it("asks a phone's first claim for a name, then saves both", async () => {
    await asPhone(PHONE_B);
    expect(await claimAction("L-0001")).toMatchObject({ ok: false, reason: "need-name" });
    expect(await claimAction("L-0001", "   ")).toMatchObject({ ok: false, reason: "need-name" });
    const result = await claimAction("L-0001", "  Lee  family, Rm 12 ");
    expect(result).toMatchObject({ ok: true, claimId: expect.stringMatching(/^c-[0-9a-f]{10}$/) });
    expect((await getDevice(t.deps, PHONE_B))?.name).toBe("Lee family, Rm 12");
    const item = (await loadItems(t.deps, { fresh: true })).items[0];
    expect(item.status).toBe("claimed");
    expect(item.claims[0]).toMatchObject({ device_id: PHONE_B, name: "Lee family, Rm 12", status: "open" });
    // Later claims don't ask again.
    expect(await claimAction("L-0002")).toMatchObject({ ok: true });
    // The test clock stands still, so the entries' file names don't sort by time.
    expect((await activity()).map((a) => a.action).sort()).toEqual(["claimed", "claimed", "name_changed"]);
  });

  it("tells the second phone someone just claimed it", async () => {
    await setDeviceName(t.deps, PHONE_B, "Lee family");
    await setDeviceName(t.deps, PHONE_C, "Kim family");
    await asPhone(PHONE_B);
    expect(await claimAction("L-0001")).toMatchObject({ ok: true });
    // A second tap on the same phone is fine.
    expect(await claimAction("L-0001")).toMatchObject({ ok: true });
    await asPhone(PHONE_C);
    expect(await claimAction("L-0001")).toEqual({ ok: false, reason: "taken", message: "Someone just claimed this." });
    expect((await activity()).filter((a) => a.action === "claimed")).toHaveLength(1);
  });

  it("turns away IDs that aren't items", async () => {
    await setDeviceName(t.deps, PHONE_B, "Lee family");
    await asPhone(PHONE_B);
    for (const id of ["L-0099", "../settings", 42, null, { id: "L-0001" }]) {
      expect(await claimAction(id)).toMatchObject({ ok: false, reason: "gone" });
    }
  });
});

describe("a phone's own claims", () => {
  async function claimedBy(phoneId: string): Promise<string> {
    await setDeviceName(t.deps, phoneId, "Lee family");
    await asPhone(phoneId);
    const result = await claimAction("L-0001");
    if (!result.ok) throw new Error(result.message);
    return result.claimId;
  }

  it("unclaims, putting the item back on the grid", async () => {
    const claimId = await claimedBy(PHONE_B);
    expect(await unclaimAction("L-0001", claimId)).toEqual({ ok: true });
    expect((await loadItems(t.deps, { fresh: true })).items[0].status).toBe("available");
    expect((await unclaimAction("L-0001", claimId)).ok).toBe(false);
  });

  it("won't let another phone close it, even with the claim ID", async () => {
    const claimId = await claimedBy(PHONE_B);
    await setDeviceName(t.deps, PHONE_C, "Kim family");
    await asPhone(PHONE_C);
    expect(await unclaimAction("L-0001", claimId)).toMatchObject({ ok: false, message: expect.stringMatching(/isn't on the list/) });
    expect(await notThereAction("L-0001", claimId)).toMatchObject({ ok: false });
    expect((await loadItems(t.deps, { fresh: true })).items[0].status).toBe("claimed");
  });

  it("marks it not there, and undoes that", async () => {
    const claimId = await claimedBy(PHONE_B);
    expect(await notThereAction("L-0001", claimId)).toEqual({ ok: true });
    expect((await loadItems(t.deps, { fresh: true })).items[0]).toMatchObject({ status: "removed", removed_reason: "not in the bin" });
    expect(await undoNotThereAction("L-0001", claimId)).toEqual({ ok: true });
    expect((await loadItems(t.deps, { fresh: true })).items[0].status).toBe("claimed");
    expect((await activity()).map((a) => a.action).sort()).toEqual(["claimed", "not_there", "not_there_undone"]);
  });

  it("checks the claim ID's shape", async () => {
    await claimedBy(PHONE_B);
    expect(await unclaimAction("L-0001", "c-../../x")).toMatchObject({ ok: false });
    expect(await unclaimAction("L-0001", undefined)).toMatchObject({ ok: false });
  });
});

describe("photos", () => {
  const request = new Request("http://localhost/photos/x") as never;
  const get = (name: string) => getPhoto(request, { params: Promise.resolve({ name }) });

  it("serves a stored photo for the CDN to keep", async () => {
    const name = `${"d".repeat(32)}-thumb.jpg`;
    await t.store.put(`photos/${name}`, new Uint8Array([0xff, 0xd8, 0xff]), { contentType: "text/html" });
    const response = await get(name);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([0xff, 0xd8, 0xff]));
  });

  it("answers 404, uncached, for anything else", async () => {
    for (const name of [`${"e".repeat(32)}.jpg`, "items.json", "..%2Fsettings.json", `${"d".repeat(32)}.svg`]) {
      const response = await get(name);
      expect(response.status).toBe(404);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  });
});
