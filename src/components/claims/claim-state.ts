/** What a card's claim area shows. Kept apart from the React code so the counting can be tested. */
export type CardState =
  | { kind: "open"; message?: string }
  | { kind: "busy" }
  | { kind: "mine"; claimId: string; message?: string }
  | { kind: "taken" }
  | { kind: "gone"; message: string };

/**
 * How many items this phone has claimed: the ones the server listed, plus
 * the ones claimed on this page, less the ones undone or lost here. Counted
 * as a set of item IDs, so it stays right when the server's list already
 * includes a claim made on the page (after a filter change) or doesn't yet
 * (a page restored from history).
 */
export function countOpenClaims(serverOpen: readonly string[], states: Readonly<Record<string, CardState>>): number {
  const ids = new Set(serverOpen);
  for (const [itemId, state] of Object.entries(states)) {
    if (state.kind === "mine") ids.add(itemId);
    else if (state.kind !== "busy") ids.delete(itemId);
  }
  return ids.size;
}
