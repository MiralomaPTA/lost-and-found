import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The server actions and the cookie layer, with Next's request APIs replaced
 * by a cookie jar, a fixed address and a redirect that throws (as Next's does).
 */
const h = vi.hoisted(() => {
  class Redirect extends Error {
    constructor(public url: string) {
      super(`redirect to ${url}`);
    }
  }
  return { jar: new Map<string, string>(), address: { value: "203.0.113.7" }, Redirect, deps: { current: null as unknown } };
});

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (h.jar.has(name) ? { name, value: h.jar.get(name)! } : undefined),
    set: (name: string, value: string) => void h.jar.set(name, value),
    delete: (name: string) => void h.jar.delete(name),
  }),
  headers: async () => ({ get: (name: string) => (name.toLowerCase() === "x-forwarded-for" ? h.address.value : null) }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new h.Redirect(url);
  },
}));
vi.mock("next/cache", () => ({ refresh: () => {} }));
vi.mock("next/server", () => ({ after: (task: () => unknown) => void Promise.resolve().then(task) }));
vi.mock("@/server/deps", () => ({ getDeps: async () => (h.deps.current as { deps: unknown }).deps }));

import { changeAdminCodeAction, changeSchoolCodeAction, enterCodeAction, leaveAdminAction, saveNameAction } from "@/app/actions/codes";
import type { FormState } from "@/lib/form-state";
import { CODE_COOKIE, PHONE_COOKIE, TRIES_COOKIE } from "@/server/cookies";
import { getDevice, newPhoneId, setDeviceName } from "@/server/phones";
import { MAX_WRONG_PER_ADDRESS, resetWrongCodeCounts } from "@/server/rate-limit";
import { getVisitor } from "@/server/session";
import { changeSchoolCode, SETTINGS_KEY } from "@/server/settings";
import { memoryObjectStore } from "@/server/storage/memory";
import { racingStore, testDeps } from "./helpers";

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

async function submit(action: Action, fields: Record<string, string>, prev: FormState = {}): Promise<FormState> {
  return action(prev, form(fields));
}

async function redirectOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof h.Redirect) return error.url;
    throw error;
  }
  throw new Error("Expected a redirect");
}

let store: ReturnType<typeof racingStore>;
let t: ReturnType<typeof testDeps>;

beforeEach(async () => {
  h.jar.clear();
  h.address.value = "203.0.113.7";
  resetWrongCodeCounts();
  store = racingStore(memoryObjectStore(), SETTINGS_KEY, 0);
  t = testDeps({ store });
  h.deps.current = t;
  await changeSchoolCode(t.deps, "otters");
});

/** The admin code in the one code box, then the name Settings asks for. Returns where the code box went. */
async function becomeAdminViaForm(name: string | null = "Dana K.") {
  const to = await redirectOf(submit(enterCodeAction, { code: "maple otter river" }));
  if (name) await redirectOf(submit(saveNameAction, { name, next: "/admin/settings" }));
  return to;
}

describe("the code box", () => {
  it("lets a phone in with the school code and remembers it", async () => {
    expect(await redirectOf(submit(enterCodeAction, { code: " Otters " }))).toBe("/");
    expect(h.jar.get(PHONE_COOKIE)).toMatch(/^[0-9a-f]{32}$/);
    expect(h.jar.get(CODE_COOKIE)).toMatch(/^[0-9a-f]{32}$/);
    const visitor = await getVisitor();
    expect(visitor.canBrowse).toBe(true);
    expect(visitor.isAdmin).toBe(false);
    // Nothing is stored about a phone that has only entered the school code.
    expect(await t.store.list("devices/")).toEqual([]);
  });

  it("makes a browser wait after 5 wrong codes, even for the right one", async () => {
    for (let i = 1; i <= 4; i++) {
      const state = await submit(enterCodeAction, { code: `wrong${i}` });
      expect(state.error).toMatch(/doesn't match/);
      expect(state.values?.code).toBe(`wrong${i}`);
    }
    expect((await submit(enterCodeAction, { code: "wrong5" })).error).toMatch(/5 wrong codes/);
    expect((await submit(enterCodeAction, { code: "otters" })).error).toMatch(/5 wrong codes/);
    t.advance(61_000);
    expect(await redirectOf(submit(enterCodeAction, { code: "otters" }))).toBe("/");
  });

  it("caps wrong codes from one address even when the browser drops its cookie", async () => {
    for (let i = 0; i < MAX_WRONG_PER_ADDRESS; i++) {
      h.jar.delete(TRIES_COOKIE);
      await submit(enterCodeAction, { code: `guess${i}` });
    }
    h.jar.delete(TRIES_COOKIE);
    expect((await submit(enterCodeAction, { code: "maple otter river" })).error).toMatch(/from this network/);
    // Someone on another network is unaffected.
    h.address.value = "198.51.100.9";
    expect(await redirectOf(submit(enterCodeAction, { code: "otters" }))).toBe("/");
  });

  it("takes the school code again from a phone that's already in (Enter a new code), and goes home", async () => {
    await redirectOf(submit(enterCodeAction, { code: "otters" }));
    expect((await submit(enterCodeAction, { code: "wrong" })).error).toMatch(/doesn't match/);
    expect(h.jar.get(TRIES_COOKIE)).toBe("1.0");
    expect(await redirectOf(submit(enterCodeAction, { code: "otters" }))).toBe("/");
    const visitor = await getVisitor();
    expect(visitor.canBrowse).toBe(true);
    expect(visitor.isAdmin).toBe(false);
    expect(h.jar.get(TRIES_COOKIE)).toBeUndefined();
  });

  it("never mentions admins in its answers", async () => {
    const state = await submit(enterCodeAction, { code: "wrong" });
    expect(state.error).not.toMatch(/admin/i);
  });

  it("makes a phone an admin with the admin code, and Settings takes its name", async () => {
    expect(await becomeAdminViaForm()).toBe("/admin/settings");
    const visitor = await getVisitor();
    expect(visitor.isAdmin).toBe(true);
    expect(visitor.device?.name).toBe("Dana K.");
    // The admin code counts as the school code too.
    expect(visitor.canBrowse).toBe(true);
    expect(h.jar.get(CODE_COOKIE)).toBeDefined();
  });

  it("sends a phone with no name to Settings after the admin code, and a named one to where it was going", async () => {
    expect(await redirectOf(submit(enterCodeAction, { code: "maple otter river", next: "/items/L-0001" }))).toBe("/admin/settings");
    expect((await getVisitor()).isAdmin).toBe(true);
    await redirectOf(submit(saveNameAction, { name: "Dana K." }));
    expect(await redirectOf(submit(enterCodeAction, { code: "maple otter river", next: "/items/L-0001" }))).toBe("/items/L-0001");
  });

  it("never grants the admin code to a phone ID it didn't record", async () => {
    const planted = newPhoneId();
    h.jar.set(PHONE_COOKIE, planted);
    await becomeAdminViaForm();
    expect(h.jar.get(PHONE_COOKIE)).not.toBe(planted);
    expect(await getDevice(t.deps, planted)).toBeNull();
  });

  it("keeps a recorded phone's ID (and its My items) when it enters the admin code", async () => {
    const family = newPhoneId();
    await setDeviceName(t.deps, family, "Lee family");
    h.jar.set(PHONE_COOKIE, family);
    await redirectOf(submit(enterCodeAction, { code: "maple otter river" }));
    expect(h.jar.get(PHONE_COOKIE)).toBe(family);
  });

  it("ignores where a next= would send someone off the site", async () => {
    expect(await redirectOf(submit(enterCodeAction, { code: "otters", next: "/\t/evil.example" }))).toBe("/");
  });
});

describe("pages and cookies", () => {
  it("treats a malformed proof cookie as no code instead of crashing", async () => {
    h.jar.set(PHONE_COOKIE, newPhoneId());
    h.jar.set(CODE_COOKIE, "é".repeat(32));
    expect((await getVisitor()).canBrowse).toBe(false);
  });
});

describe("admin actions", () => {
  it("answer with a message, not an error page, when the phone isn't an admin", async () => {
    expect((await submit(changeSchoolCodeAction, { code: "beavers" })).error).toMatch(/isn't an admin/);
    expect((await submit(changeAdminCodeAction, { code: "cedar heron bridge" })).error).toMatch(/isn't an admin/);
    expect(await redirectOf(leaveAdminAction())).toBe("/");
  });

  it("change the school code and keep the admin's own phone in", async () => {
    await becomeAdminViaForm();
    const state = await submit(changeSchoolCodeAction, { code: "Beavers" });
    expect(state.saved).toMatch(/now “beavers”/);
    expect((await getVisitor()).canBrowse).toBe(true);
  });

  it("send back what was typed when a new code is refused", async () => {
    await becomeAdminViaForm();
    const state = await submit(changeAdminCodeAction, { code: "miraloma pta" });
    expect(state.error).toMatch(/at least 3 words/);
    expect(state.values?.code).toBe("miraloma pta");
  });

  it("keep the changer an admin when the admin code changes", async () => {
    await becomeAdminViaForm();
    t.advance(1000);
    expect((await submit(changeAdminCodeAction, { code: "cedar heron bridge" })).saved).toMatch(/Admin code changed/);
    expect((await getVisitor()).isAdmin).toBe(true);
  });

  it("say 'try again' when settings.json keeps changing underneath", async () => {
    await becomeAdminViaForm();
    store.arm(99);
    expect((await submit(changeSchoolCodeAction, { code: "beavers" })).error).toMatch(/Try again/);
  });

  it("leaving admin keeps the school code", async () => {
    await becomeAdminViaForm();
    expect(await redirectOf(leaveAdminAction())).toBe("/");
    const visitor = await getVisitor();
    expect(visitor.isAdmin).toBe(false);
    expect(visitor.canBrowse).toBe(true);
  });
});

describe("the name", () => {
  it("needs the school code first, then saves", async () => {
    expect((await submit(saveNameAction, { name: "Lee family" })).error).toMatch(/school code first/);
    await redirectOf(submit(enterCodeAction, { code: "otters" }));
    expect(await redirectOf(submit(saveNameAction, { name: "  Lee   family ", next: "/mine" }))).toBe("/mine");
    expect((await getVisitor()).device?.name).toBe("Lee family");
  });
});
