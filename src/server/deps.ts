import { config } from "@/server/config";
import { Docs } from "@/server/docs";
import { getObjectStore } from "@/server/storage";
import type { ObjectStore } from "@/server/storage/types";

/**
 * What the server code works with: the bucket, its JSON files, a clock and the
 * one setting that only matters on first run. Tests build their own with an
 * in-memory bucket and a fixed clock.
 */
export interface Deps {
  store: ObjectStore;
  docs: Docs;
  now: () => Date;
  initialAdminCode: string | null;
}

let deps: Deps | null = null;

export async function getDeps(): Promise<Deps> {
  if (deps) return deps;
  const store = await getObjectStore();
  deps = { store, docs: new Docs(store, config.docCacheMs), now: () => new Date(), initialAdminCode: config.initialAdminCode };
  return deps;
}
