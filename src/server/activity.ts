import { randomBytes } from "node:crypto";
import { pacificDate, pacificTime } from "@/lib/dates";
import type { Deps } from "@/server/deps";

export interface ActivityEntry {
  /** A phone's ID. */
  actor: string;
  /** Whether the phone was an admin when it acted. */
  as_admin: boolean;
  action: string;
  item_id?: string;
  claim_id?: string;
  detail?: Record<string, string | number | boolean | null>;
}

const encoder = new TextEncoder();

/**
 * Appends one entry as its own file, `activity/<date>/<time>-<random>.json`,
 * which is never rewritten. Best effort: a failure here is logged, not shown,
 * because the change it records has already been saved.
 */
export async function logActivity(deps: Deps, entry: ActivityEntry): Promise<void> {
  const now = deps.now();
  const key = `activity/${pacificDate(now)}/${pacificTime(now)}-${randomBytes(4).toString("hex")}.json`;
  try {
    await deps.store.put(key, encoder.encode(JSON.stringify({ at: now.toISOString(), ...entry }) + "\n"), {
      contentType: "application/json",
      condition: { ifNoneMatch: "*" },
    });
  } catch (error) {
    console.error(`Couldn't write activity entry ${key}`, error);
  }
}
