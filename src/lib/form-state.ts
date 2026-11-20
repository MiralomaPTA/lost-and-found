/** What a server action hands back to its form when it doesn't redirect. */
export interface FormState {
  error?: string;
  /** A confirmation to show after a change that stays on the page. */
  saved?: string;
  /** Bumped on every submit, so a form can tell a new message from the last one. */
  attempt?: number;
}

export const NO_STATE: FormState = {};

/** A path inside this app to go to afterward, or null. Guards against open redirects. */
export function safeNext(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 200) return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return null;
  return value;
}
