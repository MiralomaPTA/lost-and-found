/**
 * Everything the app keeps lives in one bucket: a few JSON files and the
 * photos. In production that's Cloudflare R2 (through its S3 interface); in
 * development it's a folder on disk. Both go through this interface.
 */

export interface StoredObject {
  body: Uint8Array;
  /** The object's version tag, passed back as `ifMatch` to change it safely. Opaque: compare, don't parse. */
  etag: string;
  contentType?: string;
}

/**
 * - `ifMatch`: write only if the object still has this ETag (nobody changed it since it was read).
 * - `ifNoneMatch: "*"`: write only if the object doesn't exist yet.
 */
export type PutCondition = { ifMatch: string } | { ifNoneMatch: "*" };

export type PutResult = { ok: true; etag: string } | { ok: false; reason: "conflict" };

export interface PutOptions {
  contentType?: string;
  cacheControl?: string;
  condition?: PutCondition;
}

export interface ObjectStore {
  /** Null when there is no object at that key. */
  get(key: string): Promise<StoredObject | null>;
  /**
   * With a condition, the check and the write are one step: when two writes
   * race with the same `ifMatch`, exactly one succeeds and the other gets
   * `{ ok: false, reason: "conflict" }`.
   */
  put(key: string, body: Uint8Array, options?: PutOptions): Promise<PutResult>;
  /** Deleting a key that isn't there is not an error. */
  delete(key: string): Promise<void>;
  /** Every key that starts with `prefix`, in no particular order. */
  list(prefix: string): Promise<string[]>;
}

const KEY_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9._-]*(\/[A-Za-z0-9_][A-Za-z0-9._-]*)*$/;

/**
 * Keys are slash-separated names made of letters, digits, dots, dashes and
 * underscores, with no empty, dash-leading or dot-leading segments. That rules out `..`, a
 * leading `/` and anything else that could escape the local folder.
 */
export function assertValidKey(key: string): void {
  if (key.length > 512 || !KEY_PATTERN.test(key)) {
    throw new Error(`Invalid storage key: ${JSON.stringify(key)}`);
  }
}

/** Prefixes follow the same rules as keys, but may be empty or end with "/". */
export function assertValidPrefix(prefix: string): void {
  if (prefix === "") return;
  assertValidKey(prefix.endsWith("/") ? prefix.slice(0, -1) : prefix);
}
