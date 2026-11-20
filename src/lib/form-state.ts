/** What a server action hands back to its form when it doesn't redirect. */
export interface FormState {
  error?: string;
  /** A confirmation to show after a change that stays on the page. */
  saved?: string;
  /** Bumped on every submit, so a form can tell a new message from the last one. */
  attempt?: number;
  /**
   * What was typed, sent back so the form can show it again. React resets a
   * form's fields after every action, which would otherwise wipe them.
   */
  values?: Record<string, string>;
}

export const NO_STATE: FormState = {};

const ORIGIN = "http://lost-and-found.invalid";

/**
 * A path inside this app to go to afterward, or null. Rejects anything a
 * browser could read as another site: "//x", "/\x", and paths with tabs,
 * newlines or other control characters or spaces, which URL parsers strip
 * ("/\t/evil.example" becomes "//evil.example").
 */
export function safeNext(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 200) return null;
  if (!value.startsWith("/") || /[\u0000- \u007f\\]/.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value, ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== ORIGIN || url.pathname.startsWith("//")) return null;
  return url.pathname + url.search + url.hash;
}
