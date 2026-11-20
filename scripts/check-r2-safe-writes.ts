/**
 * Phase 0: confirms that the R2 bucket refuses out-of-date writes, which the
 * app's safe writes depend on (spec: *Safe writes* and *Rollout plan*).
 *
 *   npm run check:r2
 *
 * Reads R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET
 * from .env.local. Writes and then deletes one scratch file under _checks/;
 * nothing else in the bucket is touched.
 */
import { randomUUID } from "node:crypto";
import { r2Config } from "@/server/config";
import { r2ObjectStore } from "@/server/storage/r2";
import { runSafeWriteChecks } from "@/server/storage/safe-write-checks";

async function main() {
  const settings = r2Config();
  const key = `_checks/safe-writes-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}.json`;
  console.log(`Checking safe writes on bucket "${settings.bucket}" with ${key}\n`);

  const results = await runSafeWriteChecks(r2ObjectStore(settings), key);
  for (const result of results) {
    console.log(`${result.passed ? "PASS" : "FAIL"}  ${result.name}${!result.passed && result.detail ? `\n      ${result.detail}` : ""}`);
  }

  const failed = results.filter((r) => !r.passed);
  if (failed.length === 0) {
    console.log("\nAll checks passed. R2 refuses out-of-date writes, so the app can use it directly for items.json and settings.json.");
    return;
  }
  console.log(
    `\n${failed.length} check(s) failed. Don't build on R2's S3 interface for safe writes yet.\n` +
      "The fallback in the spec: write items.json and settings.json through a small Cloudflare Worker\n" +
      "that uses R2's own conditional write (onlyIf). Share this output when deciding.",
  );
  process.exitCode = 1;
}

main().catch((error) => {
  console.error("Couldn't run the check:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
