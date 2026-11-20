/**
 * Wrong codes per network address, counted in memory.
 *
 * The one-minute wait after 5 wrong codes lives in a cookie, which a script
 * can simply not send. This count doesn't depend on the browser. It's best
 * effort: on Vercel each server instance keeps its own count, and a cold start
 * resets it. So it slows a script down rather than stopping it; the real
 * defense is an admin code too long to guess (three or more words).
 *
 * The limit is generous because families on the school Wi-Fi share an address.
 */

export const MAX_WRONG_PER_ADDRESS = 20;
export const ADDRESS_WINDOW_MS = 15 * 60 * 1000;

const wrong = new Map<string, number[]>();

function recent(address: string, nowMs: number): number[] {
  return (wrong.get(address) ?? []).filter((t) => nowMs - t < ADDRESS_WINDOW_MS);
}

export function tooManyWrongCodes(address: string, nowMs: number): boolean {
  return recent(address, nowMs).length >= MAX_WRONG_PER_ADDRESS;
}

export function recordWrongCodeFrom(address: string, nowMs: number): void {
  wrong.set(address, [...recent(address, nowMs), nowMs]);
  if (wrong.size > 5000) {
    // Drop addresses with nothing recent, so the map can't grow without bound.
    for (const [key] of wrong) if (recent(key, nowMs).length === 0) wrong.delete(key);
  }
}

/** For tests. */
export function resetWrongCodeCounts(): void {
  wrong.clear();
}
