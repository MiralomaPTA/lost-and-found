import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ConflictError, Docs } from "@/server/docs";
import { memoryObjectStore } from "@/server/storage/memory";
import type { ObjectStore } from "@/server/storage/types";
import { racingStore } from "./helpers";

const counter = z.object({ count: z.number() });
const loose = z.object({ count: z.number().optional(), rival: z.boolean().optional() });

describe("Docs", () => {
  it("creates a file on first update and reads it back", async () => {
    const docs = new Docs(memoryObjectStore(), 0);
    const result = await docs.update("counter.json", counter, (current) => ({ value: { count: (current?.count ?? 0) + 1 }, result: "made" }));
    expect(result).toBe("made");
    expect(await docs.read("counter.json", counter)).toEqual({ count: 1 });
  });

  it("re-reads and re-applies the change when someone else wrote in between", async () => {
    const base = memoryObjectStore();
    const docs0 = new Docs(base, 0);
    await docs0.update("counter.json", loose, () => ({ value: { count: 1 }, result: null }));

    const store = racingStore(base, "counter.json", 2, '{"count":10,"rival":true}');
    const docs = new Docs(store, 0);
    const seen: (number | undefined)[] = [];
    await docs.update("counter.json", loose, (current) => {
      seen.push(current?.count);
      return { value: { ...current, count: (current?.count ?? 0) + 1 }, result: null };
    });
    // Tried on 1, lost to the rival twice, then applied to the rival's 10.
    expect(seen).toEqual([1, 10, 10]);
    expect(await docs.read("counter.json", loose)).toEqual({ count: 11, rival: true });
  });

  it("gives up after five lost races", async () => {
    const base = memoryObjectStore();
    await new Docs(base, 0).update("counter.json", loose, () => ({ value: { count: 1 }, result: null }));
    const store = racingStore(base, "counter.json", 99, '{"rival":true}');
    await expect(new Docs(store, 0).update("counter.json", loose, () => ({ value: { count: 2 }, result: null }))).rejects.toBeInstanceOf(ConflictError);
    expect(store.puts()).toBe(5);
  });

  it("writes nothing when the change returns no value", async () => {
    const store = racingStore(memoryObjectStore(), "counter.json", 0);
    const docs = new Docs(store, 0);
    expect(await docs.update("counter.json", counter, () => ({ result: "nothing to do" }))).toBe("nothing to do");
    expect(store.puts()).toBe(0);
    expect(await docs.read("counter.json", counter)).toBeNull();
  });

  it("refuses to write a value that doesn't fit the schema", async () => {
    const docs = new Docs(memoryObjectStore(), 0);
    await expect(docs.update("counter.json", counter, () => ({ value: { count: "one" } as unknown as { count: number }, result: null }))).rejects.toThrow();
    expect(await docs.read("counter.json", counter)).toBeNull();
  });

  it("reuses a read for the cache window", async () => {
    let clock = 0;
    const base = memoryObjectStore();
    const docs = new Docs(base, 3000, () => clock);
    await docs.update("counter.json", counter, () => ({ value: { count: 1 }, result: null }));
    // Another server instance writes directly.
    await base.put("counter.json", new TextEncoder().encode('{"count":5}'));
    expect(await docs.read("counter.json", counter)).toEqual({ count: 1 });
    clock = 3001;
    expect(await docs.read("counter.json", counter)).toEqual({ count: 5 });
  });

  it("replaces a stale cached copy with its own write", async () => {
    const base = memoryObjectStore();
    await base.put("counter.json", new TextEncoder().encode('{"count":1}'));
    const docs = new Docs(base, 3000, () => 0);
    expect(await docs.read("counter.json", counter)).toEqual({ count: 1 });
    // Another instance moves it to 5; our cache still says 1.
    await base.put("counter.json", new TextEncoder().encode('{"count":5}'));
    // Our update reads fresh, so it builds on 5, and the cache now holds the result.
    await docs.update("counter.json", counter, (current) => ({ value: { count: (current?.count ?? 0) + 1 }, result: null }));
    expect(await docs.read("counter.json", counter)).toEqual({ count: 6 });
  });

  it("skips the cache when asked for a fresh read", async () => {
    const base = memoryObjectStore();
    const docs = new Docs(base, 3000, () => 0);
    await docs.update("counter.json", counter, () => ({ value: { count: 1 }, result: null }));
    await base.put("counter.json", new TextEncoder().encode('{"count":5}'));
    expect(await docs.read("counter.json", counter)).toEqual({ count: 1 });
    expect(await docs.read("counter.json", counter, { fresh: true })).toEqual({ count: 5 });
  });
});

describe("a write whose answer was lost", () => {
  it("counts as done when the file holds exactly what was sent, without running the change again", async () => {
    const inner = memoryObjectStore();
    let armed = true;
    const store: ObjectStore = {
      ...inner,
      async put(key, body, options) {
        const result = await inner.put(key, body, options);
        // The write lands, but the answer comes back as a refusal.
        if (armed && options?.condition && result.ok) {
          armed = false;
          return { ok: false, reason: "conflict" };
        }
        return result;
      },
    };
    const docs = new Docs(store, 0);
    const schema = z.object({ n: z.number(), at: z.string() });
    await docs.update("x.json", schema, () => ({ value: { n: 1, at: "first" }, result: null }));
    let runs = 0;
    const result = await docs.update("x.json", schema, (current) => {
      runs++;
      return { value: { n: current!.n + 1, at: "second" }, result: `ran ${runs}` };
    });
    expect(result).toBe("ran 1");
    expect(runs).toBe(1);
    expect(await docs.read("x.json", schema, { fresh: true })).toEqual({ n: 2, at: "second" });
  });
});
