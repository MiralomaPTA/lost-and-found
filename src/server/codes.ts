import { createHash, timingSafeEqual } from "node:crypto";

/** Codes are compared ignoring case, surrounding spaces and runs of spaces. */
export function normalizeCode(input: string): string {
  return input.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
}

function digest(text: string): Buffer {
  return createHash("sha256").update(text).digest();
}

/** Constant-time, so how long a wrong guess takes says nothing about the code. */
export function sameCode(a: string, b: string): boolean {
  return timingSafeEqual(digest(normalizeCode(a)), digest(normalizeCode(b)));
}

export type CodeMatch = "admin" | "school" | "wrong";

/** Which code someone typed into a code box. The admin code is checked first. */
export function matchCode(codes: { school_code: string | null; admin_code: string | null }, input: string): CodeMatch {
  if (!normalizeCode(input)) return "wrong";
  if (codes.admin_code && sameCode(input, codes.admin_code)) return "admin";
  if (codes.school_code && sameCode(input, codes.school_code)) return "school";
  return "wrong";
}

export const SCHOOL_CODE_LENGTH = { min: 3, max: 40 };
/**
 * The admin code is the real lock, so it has to be long enough that a script
 * can't guess it: at least three words of three or more letters, and 15
 * characters in all. Three random words pass; "miraloma pta" doesn't.
 */
export const ADMIN_CODE_RULES = { minWords: 3, minWordLength: 3, minLength: 15, maxLength: 80 };

/** Null when the new school code is fine, otherwise what to tell the admin. */
export function schoolCodeProblem(code: string, adminCode: string | null): string | null {
  const normalized = normalizeCode(code);
  if (normalized.length < SCHOOL_CODE_LENGTH.min) return `The school code needs at least ${SCHOOL_CODE_LENGTH.min} characters.`;
  if (normalized.length > SCHOOL_CODE_LENGTH.max) return `Keep the school code under ${SCHOOL_CODE_LENGTH.max} characters, so it's easy to type.`;
  if (adminCode && sameCode(normalized, adminCode)) return "The school code can't be the same as the admin code.";
  return null;
}

/** Null when the new admin code is fine, otherwise what to tell the admin. */
export function adminCodeProblem(code: string, schoolCode: string | null): string | null {
  const normalized = normalizeCode(code);
  const words = normalized.split(" ");
  if (
    words.length < ADMIN_CODE_RULES.minWords ||
    words.some((word) => word.length < ADMIN_CODE_RULES.minWordLength) ||
    normalized.length < ADMIN_CODE_RULES.minLength
  ) {
    return `Use at least ${ADMIN_CODE_RULES.minWords} words of ${ADMIN_CODE_RULES.minWordLength} or more letters (${ADMIN_CODE_RULES.minLength}+ characters in all), such as three random words. Shorter codes can be guessed.`;
  }
  if (normalized.length > ADMIN_CODE_RULES.maxLength) return `Keep the admin code under ${ADMIN_CODE_RULES.maxLength} characters.`;
  if (schoolCode && sameCode(normalized, schoolCode)) return "The admin code can't be the same as the school code.";
  return null;
}

// --- Wrong-code slowdown: after 5 wrong codes in a row, that browser waits a minute. ---

export const MAX_WRONG_CODES = 5;
export const WRONG_CODE_WAIT_MS = 60_000;

export interface Tries {
  wrong: number;
  lockedUntil: number;
}

const NO_TRIES: Tries = { wrong: 0, lockedUntil: 0 };

/** Reads the tries cookie, "<wrong>.<lockedUntil>". Anything unexpected counts as no tries. */
export function parseTries(value: string | undefined): Tries {
  const match = value?.match(/^(\d{1,2})\.(\d{1,15})$/);
  if (!match) return NO_TRIES;
  return { wrong: Number(match[1]), lockedUntil: Number(match[2]) };
}

export function formatTries(tries: Tries): string {
  return `${tries.wrong}.${tries.lockedUntil}`;
}

export function isLocked(tries: Tries, nowMs: number): boolean {
  return tries.lockedUntil > nowMs;
}

/** One more wrong code. The fifth in a row starts the wait and resets the count. */
export function recordWrongCode(tries: Tries, nowMs: number): Tries {
  const wrong = (isLocked(tries, nowMs) ? 0 : tries.wrong) + 1;
  return wrong >= MAX_WRONG_CODES ? { wrong: 0, lockedUntil: nowMs + WRONG_CODE_WAIT_MS } : { wrong, lockedUntil: 0 };
}
