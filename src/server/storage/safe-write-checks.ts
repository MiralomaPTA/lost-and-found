import type { ObjectStore } from "@/server/storage/types";

export interface CheckResult {
  name: string;
  passed: boolean;
  detail?: string;
}

const encode = (text: string) => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

/**
 * The guarantees `items.json` and `settings.json` rely on (spec: *Safe
 * writes*), checked against a real store. Uses one scratch key and deletes it
 * afterward. `npm run check:r2` runs these against the R2 bucket; the tests
 * run them against the local store.
 */
export async function runSafeWriteChecks(store: ObjectStore, key: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const check = (name: string, passed: boolean, detail?: string) => {
    results.push({ name, passed, detail });
    return passed;
  };

  try {
    const createName = "Creates a new file only if it doesn't exist (If-None-Match: *)";
    const created = await store.put(key, encode("v1"), { contentType: "application/json", condition: { ifNoneMatch: "*" } });
    if (!created.ok) {
      check(createName, false, "the first create was refused");
      return results;
    }
    check(createName, true);
    const firstEtag = created.etag;

    const again = await store.put(key, encode("v1-again"), { condition: { ifNoneMatch: "*" } });
    check("Refuses to create a file that already exists", !again.ok, again.ok ? "the second create was accepted" : undefined);

    const read = await store.get(key);
    check(
      "Reads back the same content and version tag",
      read !== null && decode(read.body) === "v1" && read.etag === firstEtag,
      read ? `content ${JSON.stringify(decode(read.body))}, ETag ${read.etag} vs ${firstEtag}` : "the file wasn't found",
    );

    const updated = await store.put(key, encode("v2"), { condition: { ifMatch: firstEtag } });
    check("Writes when the version tag still matches (If-Match)", updated.ok, updated.ok ? undefined : "a write with the current ETag was refused");
    if (updated.ok) {
      check("Gives the new version a new tag", updated.etag !== firstEtag, `both versions have ETag ${firstEtag}`);
    }

    const stale = await store.put(key, encode("stale"), { condition: { ifMatch: firstEtag } });
    check(
      "Refuses a write with an out-of-date version tag",
      !stale.ok,
      stale.ok ? "THE KEY CHECK FAILED: a write with an out-of-date ETag was accepted, so two people could overwrite each other" : undefined,
    );

    const current = await store.get(key);
    if (current) {
      const racers = 5;
      const outcomes = await Promise.all(
        Array.from({ length: racers }, (_, i) => store.put(key, encode(`racer-${i}`), { condition: { ifMatch: current.etag } })),
      );
      const winners = outcomes.flatMap((outcome, i) => (outcome.ok ? [i] : []));
      check(
        `When ${racers} writes race with the same tag, exactly one wins`,
        winners.length === 1,
        `${winners.length} of ${racers} writes succeeded`,
      );
      const final = await store.get(key);
      if (winners.length === 1) {
        check(
          "The file holds the winner's content",
          final !== null && decode(final.body) === `racer-${winners[0]}`,
          final ? `content ${JSON.stringify(decode(final.body))}` : "the file wasn't found",
        );
      }
    } else {
      check("Reads the file before the race", false, "the file wasn't found");
    }
  } finally {
    await store.delete(key);
  }
  return results;
}
