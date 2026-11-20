/**
 * The app's cookies. All are HttpOnly and set by the server, never by page
 * scripts (some browsers expire script-set cookies after a week).
 *
 * In production their names start with `__Host-`. Browsers only accept such a
 * cookie from this exact host, over HTTPS, with `Path=/` and no `Domain`, so a
 * page on another miralomasf.com subdomain can't plant one ("cookie tossing").
 * The prefix needs HTTPS, so development uses plain names.
 *
 * This file has no Node-only imports, so the proxy can use it too.
 */

const secure = process.env.NODE_ENV === "production";
const prefix = secure ? "__Host-" : "";

/**
 * The phone's random ID. It works like a password for that phone (its name, its
 * claims, admin status), so it must never be sent to the browser in a page,
 * an API response or a photo URL.
 */
export const PHONE_COOKIE = `${prefix}lf_phone`;
/** Proof that this phone entered the current school code. */
export const CODE_COOKIE = `${prefix}lf_code`;
/** Wrong codes in a row, for the one-minute wait. */
export const TRIES_COOKIE = `${prefix}lf_tries`;
/**
 * Set for a minute after this phone adds an item. While it's there, pages
 * read items.json fresh instead of from the few-second cache, which may be
 * on another server and not have the item yet: an adder who taps *Done*
 * sees everything they just added.
 */
export const FRESH_COOKIE = `${prefix}lf_fresh`;
export const FRESH_SECONDS = 60;

export const YEAR_SECONDS = 365 * 24 * 60 * 60;

export const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure,
  path: "/",
  maxAge: YEAR_SECONDS,
};

/** Both the phone ID and the school code proof are 32 lowercase hex characters. */
export const HEX32 = /^[0-9a-f]{32}$/;
