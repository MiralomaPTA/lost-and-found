import path from "node:path";
import { config, r2Config } from "@/server/config";
import type { ObjectStore } from "@/server/storage/types";

let store: ObjectStore | null = null;

/** The bucket selected by the STORAGE env var. */
export async function getObjectStore(): Promise<ObjectStore> {
  if (store) return store;
  if (config.storage === "r2") {
    const { r2ObjectStore } = await import("@/server/storage/r2");
    store = r2ObjectStore(r2Config());
  } else {
    // On Vercel, local storage writes to the function's temporary disk: every
    // change would look saved and then vanish. Refuse unless someone is
    // knowingly trying a production build on their own machine.
    if (config.isProduction && process.env.ALLOW_LOCAL_STORAGE_IN_PRODUCTION !== "1") {
      throw new Error(
        "STORAGE=local in production would lose every change. Set STORAGE=r2, or ALLOW_LOCAL_STORAGE_IN_PRODUCTION=1 to try a production build on a laptop.",
      );
    }
    const { localObjectStore } = await import("@/server/storage/local");
    store = localObjectStore(path.join(config.localDataDir, "bucket"));
  }
  return store;
}
