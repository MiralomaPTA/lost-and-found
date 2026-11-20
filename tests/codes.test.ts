import { describe, expect, it } from "vitest";
import { adminCodeProblem, formatTries, isLocked, matchCode, normalizeCode, parseTries, recordWrongCode, schoolCodeProblem } from "@/server/codes";
import { becomeAdmin, cleanName, deviceKey, getDevice, hasSchoolCode, isAdminDevice, leaveAdmin, newPhoneId, schoolCodeProof, setDeviceName, touchDevice } from "@/server/phones";
import { changeAdminCode, changeSchoolCode, loadSettings, SETTINGS_KEY, type Settings } from "@/server/settings";
import { racingStore, testDeps } from "./helpers";
import { memoryObjectStore } from "@/server/storage/memory";

function expectOk(outcome: { ok: true; settings: Settings } | { ok: false; error: string }): Settings {
  if (!outcome.ok) throw new Error(outcome.error);
  return outcome.settings;
}

describe("codes", () => {
  it("ignores case and extra spaces", () => {
    expect(normalizeCode("  Maple   OTTER river ")).toBe("maple otter river");
  });

  it("tells the admin code from the school code", () => {
    const codes = { school_code: "otters", admin_code: "maple otter river" };
    expect(matchCode(codes, "OTTERS ")).toBe("school");
    expect(matchCode(codes, "maple  Otter river")).toBe("admin");
    expect(matchCode(codes, "otter")).toBe("wrong");
    expect(matchCode(codes, "   ")).toBe("wrong");
    expect(matchCode({ school_code: null, admin_code: null }, "otters")).toBe("wrong");
  });

  it("keeps the codes apart", () => {
    expect(schoolCodeProblem("ab", null)).toMatch(/at least 3/);
    expect(schoolCodeProblem("Maple Otter River", "maple otter river")).toMatch(/same as the admin code/);
    expect(schoolCodeProblem("otters", "maple otter river")).toBeNull();
    expect(adminCodeProblem("otters otters otters", "otters otters otters")).toMatch(/same as the school code/);
  });

  it("only accepts admin codes long enough not to be guessed", () => {
    for (const weak of ["short one", "miraloma pta", "lost and found", "a big secret code", "passwordpassword"]) {
      expect(adminCodeProblem(weak, null), weak).toMatch(/at least 3 words/);
    }
    for (const strong of ["maple otter river", "cedar heron bridge", "lost but not found"]) {
      expect(adminCodeProblem(strong, "otters"), strong).toBeNull();
    }
  });

  it("makes a browser wait a minute after 5 wrong codes in a row", () => {
    let tries = parseTries(undefined);
    for (let i = 0; i < 4; i++) tries = recordWrongCode(tries, 1000);
    expect(isLocked(tries, 1000)).toBe(false);
    tries = recordWrongCode(tries, 1000);
    expect(isLocked(tries, 1000)).toBe(true);
    expect(isLocked(tries, 60_999)).toBe(true);
    expect(isLocked(tries, 61_001)).toBe(false);
    // After the wait, it takes another 5 to lock again.
    expect(isLocked(recordWrongCode(tries, 61_001), 61_001)).toBe(false);
    expect(parseTries(formatTries(tries))).toEqual(tries);
    expect(parseTries("garbage")).toEqual({ wrong: 0, lockedUntil: 0 });
  });
});

describe("settings", () => {
  it("is created on first use with the starting lists and the initial admin code", async () => {
    const { deps, store } = testDeps();
    const settings = await loadSettings(deps);
    expect(settings.school_code).toBeNull();
    expect(settings.admin_code).toBe("maple otter river");
    expect(settings.admin_code_changed_at).toBe("2026-12-07T16:00:00.000Z");
    expect(settings.types.map((t) => t.name)).toContain("Water bottle");
    expect(settings.colors).toHaveLength(15);
    expect(settings.bin_description).toBe("by the main office");
    expect(await store.list("")).toEqual([SETTINGS_KEY]);
  });

  it("copies INITIAL_ADMIN_CODE in later if the first run had none", async () => {
    const first = testDeps({ initialAdminCode: null });
    expect((await loadSettings(first.deps)).admin_code).toBeNull();
    const later = testDeps({ initialAdminCode: "Maple Otter River", store: first.store });
    expect((await loadSettings(later.deps)).admin_code).toBe("maple otter river");
  });

  it("ignores an initial admin code that's too weak", async () => {
    const { deps } = testDeps({ initialAdminCode: "miraloma pta" });
    expect((await loadSettings(deps)).admin_code).toBeNull();
  });

  it("is created once when two first visits race", async () => {
    // Two server instances with different clocks: if both wrote, they'd disagree.
    const store = racingStore(memoryObjectStore(), SETTINGS_KEY, 0);
    const a = testDeps({ store, start: "2026-12-07T16:00:00Z" });
    const b = testDeps({ store, start: "2026-12-07T16:05:00Z" });
    const [first, second] = await Promise.all([loadSettings(a.deps), loadSettings(b.deps)]);
    expect(first).toEqual(second);
    expect(store.saved()).toBe(1);
  });

  it("changes the school code, normalized, and refuses the admin code", async () => {
    const { deps } = testDeps();
    expect(await changeSchoolCode(deps, "maple otter river")).toEqual({ ok: false, error: expect.stringMatching(/same as the admin code/) });
    expect(expectOk(await changeSchoolCode(deps, "  Otters ")).school_code).toBe("otters");
  });
});

describe("phones", () => {
  it("proves the school code per phone, until the code changes", async () => {
    const { deps, advance } = testDeps();
    const first = expectOk(await changeSchoolCode(deps, "otters"));
    const phone = newPhoneId();
    const proof = schoolCodeProof(phone, first);
    expect(hasSchoolCode(first, phone, proof)).toBe(true);
    expect(hasSchoolCode(first, newPhoneId(), proof)).toBe(false);
    expect(hasSchoolCode(first, phone, undefined)).toBe(false);
    advance(1000);
    const second = expectOk(await changeSchoolCode(deps, "beavers"));
    expect(hasSchoolCode(second, phone, proof)).toBe(false);
    // Going back to the old code doesn't bring old proofs back.
    advance(1000);
    const third = expectOk(await changeSchoolCode(deps, "otters"));
    expect(hasSchoolCode(third, phone, proof)).toBe(false);
  });

  it("treats a malformed proof cookie as no proof instead of crashing", async () => {
    const { deps } = testDeps();
    const settings = expectOk(await changeSchoolCode(deps, "otters"));
    const phone = newPhoneId();
    // 32 characters but 64 bytes: timingSafeEqual would throw on it.
    expect(hasSchoolCode(settings, phone, "é".repeat(32))).toBe(false);
    expect(hasSchoolCode(settings, phone, "Z".repeat(32))).toBe(false);
    expect(hasSchoolCode(settings, phone, "a".repeat(64))).toBe(false);
  });

  it("stays an admin until the admin code changes", async () => {
    const { deps } = testDeps();
    const settings = await loadSettings(deps);
    const dana = newPhoneId();
    const lin = newPhoneId();
    await becomeAdmin(deps, dana, settings, "Dana K.");
    await becomeAdmin(deps, lin, settings, "Lin M.");
    expect(isAdminDevice(settings, await getDevice(deps, dana))).toBe(true);

    // Same clock: the version still has to change.
    const changed = expectOk(await changeAdminCode(deps, "cedar heron bridge"));
    expect(changed.admin_code_changed_at).not.toBe(settings.admin_code_changed_at);
    await becomeAdmin(deps, dana, changed, null);
    expect(isAdminDevice(changed, await getDevice(deps, dana))).toBe(true);
    expect(isAdminDevice(changed, await getDevice(deps, lin))).toBe(false);
    expect((await getDevice(deps, lin))?.name).toBe("Lin M.");
  });

  it("refuses to repeat the current admin code", async () => {
    const { deps } = testDeps();
    expect(await changeAdminCode(deps, "Maple otter river")).toEqual({ ok: false, error: "That's already the admin code." });
  });

  it("can leave admin and keep its name", async () => {
    const { deps } = testDeps();
    const settings = await loadSettings(deps);
    const phone = newPhoneId();
    await becomeAdmin(deps, phone, settings, "Dana K.");
    const after = await leaveAdmin(deps, phone);
    expect(isAdminDevice(settings, after)).toBe(false);
    expect(after.name).toBe("Dana K.");
  });

  it("cleans names and rejects bad phone IDs", async () => {
    expect(cleanName("  Lee   family,  Rm 12 ")).toBe("Lee family, Rm 12");
    expect(cleanName("   ")).toBeNull();
    expect(cleanName(42)).toBeNull();
    expect(cleanName("x".repeat(80))).toHaveLength(60);
    expect(() => deviceKey("../settings")).toThrow();
  });

  it("updates last_seen_at at most once a day, even when requests race", async () => {
    const phone = newPhoneId();
    const store = racingStore(memoryObjectStore(), deviceKey(phone), 0);
    const { deps, advance } = testDeps({ store });
    const device = await setDeviceName(deps, phone, "Lee family");
    advance(60 * 60 * 1000);
    await touchDevice(deps, device);
    expect(store.saved()).toBe(1); // just the name

    advance(24 * 60 * 60 * 1000);
    await Promise.all([touchDevice(deps, device), touchDevice(deps, device), touchDevice(deps, device)]);
    expect(store.saved()).toBe(2);
    expect((await getDevice(deps, phone))?.last_seen_at).toBe("2026-12-08T17:00:00.000Z");
  });
});
