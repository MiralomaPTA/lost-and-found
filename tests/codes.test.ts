import { describe, expect, it } from "vitest";
import { adminCodeProblem, isLocked, matchCode, normalizeCode, parseTries, recordWrongCode, schoolCodeProblem, formatTries } from "@/server/codes";
import { becomeAdmin, cleanName, deviceKey, getDevice, hasSchoolCode, isAdminDevice, leaveAdmin, newPhoneId, schoolCodeProof, setDeviceName, touchDevice } from "@/server/phones";
import { changeAdminCode, changeSchoolCode, loadSettings, SETTINGS_KEY } from "@/server/settings";
import { testDeps } from "./helpers";

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

  it("keeps the codes apart and the admin code long", () => {
    expect(schoolCodeProblem("ab", null)).toMatch(/at least 3/);
    expect(schoolCodeProblem("Maple Otter River", "maple otter river")).toMatch(/same as the admin code/);
    expect(schoolCodeProblem("otters", "maple otter river")).toBeNull();
    expect(adminCodeProblem("short one", null)).toMatch(/at least 12/);
    expect(adminCodeProblem("otters otters", "otters otters")).toMatch(/same as the school code/);
    expect(adminCodeProblem("maple otter river", "otters")).toBeNull();
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

  it("ignores an initial admin code that's too short", async () => {
    const { deps } = testDeps({ initialAdminCode: "abc" });
    expect((await loadSettings(deps)).admin_code).toBeNull();
  });

  it("is created once when two first visits race", async () => {
    const { deps } = testDeps();
    const [a, b] = await Promise.all([loadSettings(deps), loadSettings(deps)]);
    expect(a).toEqual(b);
  });

  it("changes the school code, normalized, and refuses the admin code", async () => {
    const { deps } = testDeps();
    expect(await changeSchoolCode(deps, "maple otter river")).toEqual({ ok: false, error: expect.stringMatching(/same as the admin code/) });
    const outcome = await changeSchoolCode(deps, "  Otters ");
    expect(outcome.ok && outcome.settings.school_code).toBe("otters");
  });
});

describe("phones", () => {
  it("proves the school code per phone, until the code changes", async () => {
    const { deps, advance } = testDeps();
    const first = await changeSchoolCode(deps, "otters");
    if (!first.ok) throw new Error(first.error);
    const phone = newPhoneId();
    const proof = schoolCodeProof(phone, "otters");
    expect(hasSchoolCode(first.settings, phone, proof)).toBe(true);
    expect(hasSchoolCode(first.settings, newPhoneId(), proof)).toBe(false);
    expect(hasSchoolCode(first.settings, phone, undefined)).toBe(false);
    advance(1000);
    const second = await changeSchoolCode(deps, "beavers");
    if (!second.ok) throw new Error(second.error);
    expect(hasSchoolCode(second.settings, phone, proof)).toBe(false);
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
    const changed = await changeAdminCode(deps, "cedar heron bridge");
    if (!changed.ok) throw new Error(changed.error);
    expect(changed.settings.admin_code_changed_at).not.toBe(settings.admin_code_changed_at);
    await becomeAdmin(deps, dana, changed.settings, null);
    expect(isAdminDevice(changed.settings, await getDevice(deps, dana))).toBe(true);
    expect(isAdminDevice(changed.settings, await getDevice(deps, lin))).toBe(false);
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

  it("updates last_seen_at at most once a day", async () => {
    const { deps, store, advance } = testDeps();
    const phone = newPhoneId();
    const device = await setDeviceName(deps, phone, "Lee family");
    const before = (await store.get(deviceKey(phone)))!.etag;
    advance(60 * 60 * 1000);
    await touchDevice(deps, device);
    expect((await store.get(deviceKey(phone)))!.etag).toBe(before);
    advance(24 * 60 * 60 * 1000);
    await touchDevice(deps, device);
    expect((await getDevice(deps, phone))?.last_seen_at).toBe("2026-12-08T17:00:00.000Z");
  });
});
