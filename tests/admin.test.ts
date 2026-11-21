import { beforeEach, describe, expect, it, vi } from "vitest";

/* The admin section: its changes to items, its views, its actions and the replace-photo route. */
const h = vi.hoisted(() => ({ jar: new Map<string, string>(), deps: { current: null as unknown } }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (h.jar.has(name) ? { name, value: h.jar.get(name)! } : undefined),
    has: (name: string) => h.jar.has(name),
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

import {
  keepNewPhotoAction,
  removeItemAction,
  reopenClaimAction,
  restoreItemAction,
  undoClaimAction,
  undoPhotoReplaceAction,
  undoRemovalAction,
} from "@/app/actions/admin";
import { POST as replacePhotoRoute } from "@/app/api/items/[id]/photo/route";
import { forgetPreviousPhoto, removeItem, reopenClaim, replacePhoto, restoreItem, undoClaimAsAdmin, undoPhotoReplace, undoRemoval } from "@/server/admin-items";
import { adminCard, adminItems, phoneNames, recentClaims, reportedMissing, statusCounts } from "@/server/admin-views";
import { CODE_COOKIE, PHONE_COOKIE } from "@/server/cookies";
import { addItem, changeItems, claimItem, emptyItemsFile, loadItems, markNotThere, type ItemsFile } from "@/server/items";
import { phoneCode } from "@/server/phone-code";
import { becomeAdmin, schoolCodeProof, setDeviceName } from "@/server/phones";
import { changeSchoolCode, loadSettings } from "@/server/settings";
import { myItemsView } from "@/server/views";
import { fakeJpeg, PHONE_A, PHONE_B, PHONE_C, photoNames, testDeps } from "./helpers";

const NOW = new Date("2026-12-07T18:00:00Z");
const ADMIN = PHONE_C;

function bin(count: number): ItemsFile {
  const file = emptyItemsFile();
  for (let i = 0; i < count; i++) addItem(file, { type: "Jacket", color: "Navy", has_name: false, ...photoNames(), phoneId: PHONE_A, name: "Volunteer" }, NOW);
  return file;
}

function claimed(): ItemsFile {
  const file = bin(1);
  claimItem(file, { itemId: "L-0001", phoneId: PHONE_B, name: "Lee family", claimId: "c-0000000001" }, NOW);
  return file;
}

describe("admins' changes", () => {
  it("remove an item with a reason, closing a claim on it, and undo exactly that", () => {
    const file = claimed();
    expect(removeItem(file, { itemId: "L-0001", adminId: ADMIN, reason: "returned in person" }, NOW).ok).toBe(true);
    expect(file.items[0]).toMatchObject({ status: "removed", removed_reason: "returned in person", removed_by: ADMIN });
    expect(file.items[0].claims[0]).toMatchObject({ status: "undone", ended_by: ADMIN });
    // The family sees it was removed, not put back.
    expect(myItemsView(file, null, PHONE_B, NOW).current[0].state).toBe("removed");
    expect(undoRemoval(file, { itemId: "L-0001", adminId: ADMIN }, NOW).ok).toBe(true);
    expect(file.items[0]).toMatchObject({ status: "claimed", removed_reason: null });
    expect(file.items[0].claims[0]).toMatchObject({ status: "open", ended_by: null });
  });

  it("only undo a removal by the same admin, while it's still removed", () => {
    const file = bin(1);
    removeItem(file, { itemId: "L-0001", adminId: ADMIN, reason: "duplicate or mistake" }, NOW);
    expect(undoRemoval(file, { itemId: "L-0001", adminId: PHONE_A }, NOW)).toEqual({ ok: false, reason: "changed" });
    restoreItem(file, { itemId: "L-0001", adminId: ADMIN }, NOW);
    expect(undoRemoval(file, { itemId: "L-0001", adminId: ADMIN }, NOW)).toEqual({ ok: false, reason: "changed" });
  });

  it("restore an item reported missing, leaving the family's claim closed", () => {
    const file = claimed();
    markNotThere(file, { itemId: "L-0001", claimId: "c-0000000001", phoneId: PHONE_B }, NOW);
    expect(restoreItem(file, { itemId: "L-0001", adminId: ADMIN }, NOW).ok).toBe(true);
    expect(file.items[0]).toMatchObject({ status: "available", removed_reason: null });
    expect(file.items[0].claims[0].status).toBe("not found");
    expect(restoreItem(file, { itemId: "L-0001", adminId: ADMIN }, NOW)).toEqual({ ok: false, reason: "gone" });
  });

  it("undo a claim with a note, and reopen it while nobody else has claimed the item", () => {
    const file = claimed();
    expect(undoClaimAsAdmin(file, { itemId: "L-0001", claimId: "c-0000000001", adminId: ADMIN, note: "This belongs to another student." }, NOW).ok).toBe(true);
    expect(file.items[0].status).toBe("available");
    expect(myItemsView(file, null, PHONE_B, NOW).current[0]).toMatchObject({ state: "put back", note: "This belongs to another student." });
    expect(reopenClaim(file, { itemId: "L-0001", claimId: "c-0000000001", adminId: ADMIN }, NOW).ok).toBe(true);
    expect(file.items[0].claims[0]).toMatchObject({ status: "open", note: null });
    undoClaimAsAdmin(file, { itemId: "L-0001", claimId: "c-0000000001", adminId: ADMIN, note: null }, NOW);
    claimItem(file, { itemId: "L-0001", phoneId: PHONE_A, name: "Kim", claimId: "c-0000000002" }, NOW);
    expect(reopenClaim(file, { itemId: "L-0001", claimId: "c-0000000001", adminId: ADMIN }, NOW)).toEqual({ ok: false, reason: "changed" });
  });

  it("replace a photo, keeping the old one for Undo and letting go of an older one", () => {
    const file = bin(1);
    const original = { photo: file.items[0].photo, thumb: file.items[0].thumb };
    const first = photoNames();
    expect(replacePhoto(file, { itemId: "L-0001", adminId: ADMIN, ...first }, NOW)).toMatchObject({ ok: true, unused: [] });
    expect(file.items[0]).toMatchObject({ ...first, previous_photo: original });
    const second = photoNames();
    expect(replacePhoto(file, { itemId: "L-0001", adminId: ADMIN, ...second }, NOW)).toMatchObject({ unused: [original.photo, original.thumb] });
    // Undo only the replacement it's about.
    expect(undoPhotoReplace(file, { itemId: "L-0001", adminId: ADMIN, photo: first.photo }, NOW)).toEqual({ ok: false, reason: "changed" });
    expect(undoPhotoReplace(file, { itemId: "L-0001", adminId: ADMIN, photo: second.photo }, NOW)).toMatchObject({ ok: true, unused: [second.photo, second.thumb] });
    expect(file.items[0]).toMatchObject(first);
    expect(file.items[0].previous_photo).toBeUndefined();
    expect(forgetPreviousPhoto(file, { itemId: "L-0001" })).toEqual({ ok: false, reason: "changed" });
  });
});

describe("what admins see", () => {
  it("gives each phone a short code that doesn't give its ID away", () => {
    expect(phoneCode(PHONE_A)).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(phoneCode(PHONE_A)).toBe(phoneCode(PHONE_A));
    expect(phoneCode(PHONE_A)).not.toBe(phoneCode(PHONE_B));
  });

  it("counts and lists items by status, with who added them", () => {
    const file = bin(3);
    claimItem(file, { itemId: "L-0002", phoneId: PHONE_B, name: "Lee family", claimId: "c-0000000001" }, NOW);
    removeItem(file, { itemId: "L-0003", adminId: ADMIN, reason: "duplicate or mistake" }, NOW);
    expect(statusCounts(file)).toEqual({ all: 3, available: 1, claimed: 1, removed: 1 });
    expect(adminItems(file, { status: "removed", sort: "newest" }).map((i) => i.id)).toEqual(["L-0003"]);
    expect(adminCard(file.items[1], NOW)).toMatchObject({ id: "L-0002", statusText: "Claimed · Lee family", addedBy: "Volunteer", href: "/admin/items/L-0002" });
    expect(adminCard(file.items[2], NOW).statusText).toBe("Removed · Duplicate or mistake");
    expect(JSON.stringify(adminCard(file.items[1], NOW))).not.toMatch(/[abc]{32}/);
  });

  it("lists recent claims and reported missing items, with names, phone codes and who did what", async () => {
    const t = testDeps();
    await setDeviceName(t.deps, ADMIN, "Dana K.");
    const file = bin(2);
    claimItem(file, { itemId: "L-0001", phoneId: PHONE_B, name: "Lee family", claimId: "c-0000000001" }, NOW);
    claimItem(file, { itemId: "L-0002", phoneId: PHONE_A, name: "Kim family", claimId: "c-0000000002" }, new Date(NOW.getTime() + 60_000));
    markNotThere(file, { itemId: "L-0001", claimId: "c-0000000001", phoneId: PHONE_B }, NOW);
    undoClaimAsAdmin(file, { itemId: "L-0002", claimId: "c-0000000002", adminId: ADMIN, note: "Wrong jacket" }, NOW);
    const names = await phoneNames(t.deps, [ADMIN, PHONE_B]);
    const rows = recentClaims(file, names, NOW);
    expect(rows.map((r) => r.claimId)).toEqual(["c-0000000002", "c-0000000001"]);
    expect(rows[0]).toMatchObject({ name: "Kim family", phone: phoneCode(PHONE_A), state: "undone", outcome: expect.stringMatching(/^Undone by Dana K\./), note: "Wrong jacket" });
    expect(reportedMissing(file, names, NOW)).toEqual([expect.objectContaining({ itemId: "L-0001", name: "Lee family", phone: phoneCode(PHONE_B), reported: expect.stringMatching(/^Today/) })]);
    expect(JSON.stringify(rows)).not.toMatch(/[abc]{32}/);
  });
});

describe("admin actions and the photo route", () => {
  let t: ReturnType<typeof testDeps>;

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
    await becomeAdmin(t.deps, ADMIN, changed.settings, "Dana K.");
    await changeItems(t.deps, (file) => {
      const fresh = claimed();
      Object.assign(file, fresh);
      return { value: file, result: null };
    });
    await t.store.put(`photos/${(await loadItems(t.deps, { fresh: true })).items[0].photo}`, fakeJpeg(800, 800));
  });

  it("refuse a phone that isn't an admin", async () => {
    await asPhone(PHONE_B);
    for (const result of [
      await removeItemAction("L-0001", "other"),
      await undoRemovalAction("L-0001"),
      await restoreItemAction("L-0001"),
      await undoClaimAction("L-0001", "c-0000000001", ""),
      await reopenClaimAction("L-0001", "c-0000000001"),
      await undoPhotoReplaceAction("L-0001", `${"1".repeat(32)}.jpg`),
      await keepNewPhotoAction("L-0001"),
    ]) {
      expect(result).toMatchObject({ ok: false, message: expect.stringMatching(/isn't an admin/) });
    }
    expect((await loadItems(t.deps, { fresh: true })).items[0].status).toBe("claimed");
  });

  it("check their inputs, trim the family's note, and log what they did", async () => {
    await asPhone(ADMIN);
    expect(await removeItemAction("L-0001", "not in the bin")).toEqual({ ok: false, message: "Pick a reason." });
    expect(await removeItemAction("../x", "other")).toMatchObject({ ok: false });
    expect(await undoClaimAction("L-0001", "c-0000000001", "   This   belongs to another student.  ")).toEqual({ ok: true });
    const item = (await loadItems(t.deps, { fresh: true })).items[0];
    expect(item.claims[0]).toMatchObject({ status: "undone", note: "This belongs to another student.", ended_by: ADMIN });
    const actions = await Promise.all((await t.store.list("activity/")).map(async (key) => JSON.parse(new TextDecoder().decode((await t.store.get(key))!.body))));
    expect(actions).toContainEqual(expect.objectContaining({ action: "claim_undone", actor: ADMIN, as_admin: true, item_id: "L-0001" }));
  });

  function postPhoto(id: string) {
    const form = new FormData();
    form.set("photo", new Blob([fakeJpeg(1200, 1200).slice()]));
    form.set("thumb", new Blob([fakeJpeg(400, 400).slice()]));
    return replacePhotoRoute(new Request(`http://localhost:3000/api/items/${id}/photo`, { method: "POST", body: form, headers: { origin: "http://localhost:3000", "x-forwarded-host": "localhost:3000" } }) as never, {
      params: Promise.resolve({ id }),
    });
  }

  it("replace a photo for admins only, keep the old one until Undo is over, and delete what's no longer used", async () => {
    await asPhone(PHONE_B);
    expect((await postPhoto("L-0001")).status).toBe(401);
    await asPhone(ADMIN);
    const original = (await loadItems(t.deps, { fresh: true })).items[0].photo;
    const response = await postPhoto("L-0001");
    expect(response.status).toBe(200);
    const { photo } = await response.json();
    expect((await loadItems(t.deps, { fresh: true })).items[0]).toMatchObject({ photo, previous_photo: { photo: original } });
    // Undo: the old photo is back and the new one's files are gone.
    expect(await undoPhotoReplaceAction("L-0001", photo)).toEqual({ ok: true });
    expect((await loadItems(t.deps, { fresh: true })).items[0].photo).toBe(original);
    expect(await t.store.get(`photos/${photo}`)).toBeNull();
    expect(await t.store.get(`photos/${original}`)).not.toBeNull();
    // Replace again and keep it: now the old photo's files go.
    const again = await (await postPhoto("L-0001")).json();
    expect(await keepNewPhotoAction("L-0001")).toEqual({ ok: true });
    expect(await t.store.get(`photos/${original}`)).toBeNull();
    expect(await t.store.get(`photos/${again.photo}`)).not.toBeNull();
    expect((await postPhoto("L-0099")).status).toBe(404);
    expect(await t.store.list("photos/")).toHaveLength(2);
  });
});
