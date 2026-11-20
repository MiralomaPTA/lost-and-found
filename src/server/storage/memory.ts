import { assertValidKey, assertValidPrefix, type ObjectStore } from "@/server/storage/types";

/**
 * The bucket in memory, for tests. Checks and writes happen without an await
 * in between, so conditional writes are atomic like R2's.
 */
export function memoryObjectStore(): ObjectStore {
  const objects = new Map<string, { body: Uint8Array; etag: string; contentType?: string }>();
  let version = 0;
  return {
    async get(key) {
      assertValidKey(key);
      const object = objects.get(key);
      return object ? { body: object.body.slice(), etag: object.etag, contentType: object.contentType } : null;
    },
    async put(key, body, options = {}) {
      assertValidKey(key);
      const current = objects.get(key);
      const condition = options.condition;
      if (condition && "ifMatch" in condition && current?.etag !== condition.ifMatch) return { ok: false, reason: "conflict" };
      if (condition && "ifNoneMatch" in condition && current) return { ok: false, reason: "conflict" };
      const etag = `"m${++version}"`;
      objects.set(key, { body: body.slice(), etag, contentType: options.contentType });
      return { ok: true, etag };
    },
    async delete(key) {
      assertValidKey(key);
      objects.delete(key);
    },
    async list(prefix) {
      assertValidPrefix(prefix);
      return [...objects.keys()].filter((key) => key.startsWith(prefix));
    },
  };
}
