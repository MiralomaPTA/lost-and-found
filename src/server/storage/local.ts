import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  assertValidKey,
  assertValidPrefix,
  type ListedObject,
  type ObjectStore,
  type PutOptions,
  type PutResult,
  type StoredObject,
} from "@/server/storage/types";

/**
 * The bucket as a folder on disk, for development and tests. Each object is a
 * file at its key; its ETag is a hash of its contents, like R2's.
 *
 * Conditional writes are made atomic by running every write to the same key
 * one after another within this process. That is enough for `next dev` and
 * tests; it does not protect against two processes writing the same folder.
 */
export function localObjectStore(rootDir: string): ObjectStore {
  const root = path.resolve(rootDir);
  const queues = new Map<string, Promise<unknown>>();

  function fileFor(key: string): string {
    assertValidKey(key);
    const file = path.join(root, ...key.split("/"));
    // assertValidKey already rules this out; this is a second fence.
    if (!file.startsWith(root + path.sep)) throw new Error(`Storage key escapes the data folder: ${key}`);
    return file;
  }

  /** Runs `task` after every earlier write to `key` has finished. */
  function serialized<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = queues.get(key) ?? Promise.resolve();
    const next = previous.then(task, task);
    const settled = next.catch(() => undefined);
    queues.set(key, settled);
    void settled.then(() => {
      if (queues.get(key) === settled) queues.delete(key);
    });
    return next;
  }

  async function readObject(key: string): Promise<StoredObject | null> {
    let body: Buffer;
    try {
      body = await readFile(fileFor(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    return { body: new Uint8Array(body), etag: etagOf(body) };
  }

  async function listObjects(prefix: string): Promise<ListedObject[]> {
    assertValidPrefix(prefix);
    const objects: ListedObject[] = [];
    async function walk(dir: string, keyPrefix: string): Promise<void> {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw error;
      }
      for (const entry of entries) {
        if (entry.name.endsWith(".tmp")) continue;
        const key = keyPrefix + entry.name;
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(file, key + "/");
        else if (key.startsWith(prefix)) {
          // A file deleted since the directory was read just isn't listed.
          const info = await stat(file).catch(() => null);
          if (info) objects.push({ key, modified: info.mtime });
        }
      }
    }
    await walk(root, "");
    return objects;
  }

  return {
    get: readObject,

    async put(key: string, body: Uint8Array, options: PutOptions = {}): Promise<PutResult> {
      const file = fileFor(key);
      return serialized(key, async () => {
        const condition = options.condition;
        if (condition) {
          const current = await readObject(key);
          if ("ifMatch" in condition && current?.etag !== condition.ifMatch) return { ok: false, reason: "conflict" };
          if ("ifNoneMatch" in condition && current) return { ok: false, reason: "conflict" };
        }
        await mkdir(path.dirname(file), { recursive: true });
        // Write to a temporary file and rename it over the old one, so a reader
        // never sees half a file.
        const temp = `${file}.${randomUUID()}.tmp`;
        await writeFile(temp, body);
        await rename(temp, file);
        return { ok: true, etag: etagOf(body) };
      });
    },

    async delete(key: string): Promise<void> {
      const file = fileFor(key);
      return serialized(key, () => rm(file, { force: true }));
    },

    async list(prefix: string): Promise<string[]> {
      return (await listObjects(prefix)).map((object) => object.key);
    },

    listObjects,
  };
}

function etagOf(body: Uint8Array): string {
  return `"${createHash("sha256").update(body).digest("hex").slice(0, 32)}"`;
}
