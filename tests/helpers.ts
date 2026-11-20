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
export function racingStore(inner: ObjectStore, key: string, times: number, rivalBody = '{"rival":true}'): ObjectStore & { puts: () => number } {
  let left = times;
  let puts = 0;
  return {
    ...inner,
    async put(k, body, options) {
      if (k === key) {
        puts++;
        if (left > 0) {
          left--;
          await inner.put(k, new TextEncoder().encode(rivalBody));
        }
      }
      return inner.put(k, body, options);
    },
    puts: () => puts,
  };
}
