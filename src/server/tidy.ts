import { after } from "next/server";
import { tidyBucket } from "@/server/clear-out";
import type { Deps } from "@/server/deps";
import { sweepReplacedPhotos } from "@/server/items";

/**
 * After an admin page renders: replaced photos whose *Undo* time is over go
 * now, not whenever the list is next saved, and the bucket is tidied after
 * clear-outs (see tidyBucket). `force` tidies even if this server did a
 * moment ago: the *Clear out* tab uses it.
 */
export function tidyAfterAdminPage(deps: Deps, { force = false }: { force?: boolean } = {}): void {
  after(async () => {
    await sweepReplacedPhotos(deps).catch((error) => console.error("Couldn't sweep replaced photos", error));
    await tidyBucket(deps, { force }).catch((error) => console.error("Couldn't tidy the bucket", error));
  });
}
