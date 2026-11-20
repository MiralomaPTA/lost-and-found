import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { localObjectStore } from "@/server/storage/local";
import { runSafeWriteChecks } from "@/server/storage/safe-write-checks";
import type { ObjectStore } from "@/server/storage/types";

const encode = (text: string) => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe("local object store", () => {
  let dir: string;
  let store: ObjectStore;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "lf-storage-"));
    store = localObjectStore(dir);
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns null for a missing key", async () => {
    expect(await store.get("items.json")).toBeNull();
  });

  it("round-trips content and gives each version its own tag", async () => {
    const first = await store.put("items.json", encode('{"a":1}'));
    const second = await store.put("items.json", encode('{"a":2}'));
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.etag).not.toBe(second.etag);
    const read = await store.get("items.json");
    expect(read && decode(read.body)).toBe('{"a":2}');
    expect(read?.etag).toBe(second.etag);
  });

  it("refuses a write with an out-of-date tag", async () => {
    const first = await store.put("items.json", encode("v1"));
    if (!first.ok) throw new Error("setup failed");
    await store.put("items.json", encode("v2"), { condition: { ifMatch: first.etag } });
    const stale = await store.put("items.json", encode("stale"), { condition: { ifMatch: first.etag } });
    expect(stale).toEqual({ ok: false, reason: "conflict" });
    expect(decode((await store.get("items.json"))!.body)).toBe("v2");
  });

  it("refuses If-Match on a key that doesn't exist", async () => {
    expect(await store.put("items.json", encode("v1"), { condition: { ifMatch: '"nope"' } })).toEqual({ ok: false, reason: "conflict" });
  });

  it("passes every safe-write check", async () => {
    const results = await runSafeWriteChecks(store, "_checks/test.json");
    expect(results.filter((r) => !r.passed)).toEqual([]);
    expect(results.length).toBeGreaterThanOrEqual(7);
    expect(await store.get("_checks/test.json")).toBeNull();
  });

  it("lists keys by prefix, including nested ones", async () => {
    await store.put("items.json", encode("{}"));
    await store.put("photos/abc.jpg", encode("x"));
    await store.put("photos/abc-thumb.jpg", encode("x"));
    await store.put("activity/2026-12-07/0812-xyz.json", encode("{}"));
    expect((await store.list("photos/")).sort()).toEqual(["photos/abc-thumb.jpg", "photos/abc.jpg"]);
    expect((await store.list("")).sort()).toEqual([
      "activity/2026-12-07/0812-xyz.json",
      "items.json",
      "photos/abc-thumb.jpg",
      "photos/abc.jpg",
    ]);
  });

  it("deletes, and deleting a missing key is fine", async () => {
    await store.put("items.json", encode("{}"));
    await store.delete("items.json");
    await store.delete("items.json");
    expect(await store.get("items.json")).toBeNull();
  });

  it.each(["../outside.json", "/etc/passwd", "photos/../../x", "photos//x", ".hidden", "photos/.x", "a b.json", ""])(
    "rejects the key %j",
    async (key) => {
      await expect(store.get(key)).rejects.toThrow(/Invalid storage key/);
      await expect(store.put(key, encode("x"))).rejects.toThrow(/Invalid storage key/);
    },
  );
});

// Runs the same checks against the real bucket when R2 credentials are set
// (e.g. `R2_ACCOUNT_ID=… npm test`). Skipped otherwise, including in CI.
const hasR2 = Boolean(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY);
describe.skipIf(!hasR2)("R2 object store (live)", () => {
  it("passes every safe-write check", async () => {
    const { r2Config } = await import("@/server/config");
    const { r2ObjectStore } = await import("@/server/storage/r2");
    const results = await runSafeWriteChecks(r2ObjectStore(r2Config()), `_checks/vitest-${Date.now()}.json`);
    expect(results.filter((r) => !r.passed)).toEqual([]);
  }, 30_000);
});
