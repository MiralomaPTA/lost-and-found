import type { z } from "zod";
import type { ObjectStore } from "@/server/storage/types";

/** A safe write that kept losing races. Rare: writes come a few a minute at the busiest. */
export class ConflictError extends Error {}

/**
 * What a change function returns: the new value to save (leave it out to save
 * nothing) and the result to hand back to the caller.
 */
export type Change<T, R> = { value?: T; result: R };

interface Cached {
  value: unknown;
  etag: string;
  at: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Enough for settings, items and the phones seen in a few seconds; the oldest entries go first. */
const MAX_CACHED = 2000;

/**
 * The bucket's JSON files (`items.json`, `settings.json`, `devices/<id>.json`),
 * validated with zod on the way in and out.
 *
 * Reads are reused for a few seconds, which smooths out a burst of visits
 * after a newsletter goes out. Every change re-reads the file, applies the
 * change, and writes it back only if nobody else wrote in between (the spec's
 * *Safe writes*). On a clash it re-reads and tries again.
 */
export class Docs {
  private cache = new Map<string, Cached>();

  constructor(
    private store: ObjectStore,
    private cacheMs: number,
    private clock: () => number = Date.now,
  ) {}

  /**
   * The file's current value, or null when it doesn't exist. Treat the value
   * as read-only. With `fresh`, skip the cache: for a file only one phone
   * changes, where a few-second-old copy on another server instance would
   * show that phone stale data right after its own change.
   */
  async read<T>(key: string, schema: z.ZodType<T>, { fresh = false }: { fresh?: boolean } = {}): Promise<T | null> {
    const hit = this.cache.get(key);
    if (!fresh && hit && this.cacheMs > 0 && this.clock() - hit.at < this.cacheMs) return hit.value as T;
    return (await this.readFresh(key, schema))?.value ?? null;
  }

  /**
   * Re-reads the file and passes its value (or null when it doesn't exist yet)
   * to `change`. `change` may run more than once, so it must only compute:
   * no side effects.
   */
  async update<T, R>(key: string, schema: z.ZodType<T>, change: (current: T | null) => Change<T, R>, attempts = 5): Promise<R> {
    for (let attempt = 0; attempt < attempts; attempt++) {
      const current = await this.readFresh(key, schema);
      const { value, result } = change(current ? structuredClone(current.value) : null);
      if (value === undefined) return result;
      const checked = schema.parse(value);
      const body = encoder.encode(JSON.stringify(checked, null, 2) + "\n");
      const put = await this.store.put(key, body, {
        contentType: "application/json",
        condition: current ? { ifMatch: current.etag } : { ifNoneMatch: "*" },
      });
      if (put.ok) {
        this.remember(key, checked, put.etag);
        return result;
      }
      // Refused as out of date, but perhaps only because the write went
      // through, its answer was lost, and the storage client's own retry was
      // then refused. If the file now holds exactly what was sent, it's this
      // write: done. (Running the change again would act twice.) Every saved
      // change carries a fresh timestamp, so another writer's file won't match.
      const now = await this.store.get(key);
      if (now && sameBytes(now.body, body)) {
        this.remember(key, checked, now.etag);
        return result;
      }
      this.cache.delete(key);
    }
    throw new ConflictError(`Couldn't save ${key} because it kept changing. Try again.`);
  }

  private async readFresh<T>(key: string, schema: z.ZodType<T>): Promise<{ value: T; etag: string } | null> {
    const object = await this.store.get(key);
    if (!object) {
      this.cache.delete(key);
      return null;
    }
    const value = schema.parse(JSON.parse(decoder.decode(object.body)));
    this.remember(key, value, object.etag);
    return { value, etag: object.etag };
  }

  private remember(key: string, value: unknown, etag: string) {
    this.cache.delete(key);
    this.cache.set(key, { value, etag, at: this.clock() });
    if (this.cache.size > MAX_CACHED) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
  }
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
