import type { Deps } from "@/server/deps";
import { Docs } from "@/server/docs";
import { memoryObjectStore } from "@/server/storage/memory";
import type { ObjectStore } from "@/server/storage/types";

/** An in-memory bucket and a clock the test can move. */
export function testDeps({ initialAdminCode = "maple otter river", start = "2026-12-07T16:00:00Z", store = memoryObjectStore() }: { initialAdminCode?: string | null; start?: string; store?: ObjectStore } = {}) {
  let now = new Date(start);
  const deps: Deps = { store, docs: new Docs(store, 0), now: () => now, initialAdminCode };
  return {
    deps,
    store,
    advance(ms: number) {
      now = new Date(now.getTime() + ms);
    },
  };
}

/**
 * A bucket where someone else writes `key` just before each of our next
 * `times` writes to it, so our conditional write loses the race.
 */
export function racingStore(
  inner: ObjectStore,
  key: string,
  times: number,
  rivalBody?: string,
): ObjectStore & { puts: () => number; saved: () => number; arm: (times: number) => void } {
  let left = times;
  let puts = 0;
  let saved = 0;
  return {
    ...inner,
    async put(k, body, options) {
      if (k === key) {
        puts++;
        if (left > 0) {
          left--;
          // By default the rival writes back what's there, which still changes the ETag.
          const rival = rivalBody !== undefined ? new TextEncoder().encode(rivalBody) : ((await inner.get(k))?.body ?? new TextEncoder().encode("{}"));
          await inner.put(k, rival);
        }
      }
      const result = await inner.put(k, body, options);
      if (k === key && result.ok) saved++;
      return result;
    },
    /** Our writes to the key, including ones that lost. */
    puts: () => puts,
    /** Our writes to the key that succeeded. */
    saved: () => saved,
    /** Make the rival win our next `times` writes. */
    arm(times: number) {
      left = times;
    },
  };
}

/** Phone IDs for tests: 32 hex characters, like the real ones. */
export const PHONE_A = "a".repeat(32);
export const PHONE_B = "b".repeat(32);
export const PHONE_C = "c".repeat(32);

let photoCounter = 0;

/** A photo name pair like the app's. */
export function photoNames(): { photo: string; thumb: string } {
  const id = (++photoCounter).toString(16).padStart(32, "0");
  return { photo: `${id}.jpg`, thumb: `${id}-thumb.jpg` };
}
