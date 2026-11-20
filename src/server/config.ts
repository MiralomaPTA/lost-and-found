/**
 * Runtime configuration, read once from environment variables.
 * See .env.example for the full list and README.md for how to fill it in.
 */

const env = process.env;

function required(name: string): string {
  const value = env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

const isProduction = env.NODE_ENV === "production";

export type StorageKind = "local" | "r2";

/**
 * Only the two exact spellings are accepted. A typo must not quietly select
 * local storage, which on Vercel would write to the function's disk and lose
 * every change while looking like success.
 */
function storageKind(): StorageKind {
  const value = env.STORAGE ?? "local";
  if (value === "local" || value === "r2") return value;
  throw new Error(`STORAGE must be "local" or "r2", not "${value}"`);
}

export const config = {
  /** Public base URL, e.g. https://lostandfound.miralomasf.com */
  appUrl: (env.APP_URL ?? "http://localhost:3000").replace(/\/$/, ""),
  /** "local" writes to ./.data; "r2" uses the Cloudflare R2 bucket. */
  storage: storageKind(),
  /** Shown to people who need a person: "Questions? Email …". */
  contactEmail: env.CONTACT_EMAIL ?? "lostandfound@miralomasf.com",
  localDataDir: env.LOCAL_DATA_DIR ?? ".data",
  timeZone: "America/Los_Angeles",
  isProduction,
};

/** R2 settings are only read when they're needed, so a local dev box needs none of them. */
export function r2Config() {
  const accountId = required("R2_ACCOUNT_ID");
  return {
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    accessKeyId: required("R2_ACCESS_KEY_ID"),
    secretAccessKey: required("R2_SECRET_ACCESS_KEY"),
    bucket: env.R2_BUCKET || "miraloma-pta-lost-and-found",
  };
}
