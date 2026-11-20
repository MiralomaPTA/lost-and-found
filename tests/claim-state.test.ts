import { describe, expect, it } from "vitest";
import { countOpenClaims, type CardState } from "@/components/claims/claim-state";

const mine = (claimId = "c-0000000001"): CardState => ({ kind: "mine", claimId });

describe("the My items count", () => {
  it("counts a claim once, whether or not the server's list has caught up", () => {
    // Claimed on the page, then the grid was re-rendered with a filter: the server now lists it too.
    expect(countOpenClaims(["L-0001"], { "L-0001": mine() })).toBe(1);
    // A page restored from history, from before the claim.
    expect(countOpenClaims([], { "L-0001": mine() })).toBe(1);
  });

  it("drops claims undone or lost on the page", () => {
    expect(countOpenClaims(["L-0001", "L-0002"], { "L-0001": { kind: "open" } })).toBe(1);
    expect(countOpenClaims(["L-0001"], { "L-0001": { kind: "gone", message: "x" } })).toBe(0);
    expect(countOpenClaims([], { "L-0003": { kind: "taken" } })).toBe(0);
  });

  it("leaves an item that's mid-save as it was", () => {
    expect(countOpenClaims(["L-0001"], { "L-0001": { kind: "busy" } })).toBe(1);
    expect(countOpenClaims([], { "L-0002": { kind: "busy" } })).toBe(0);
  });
});
