"use server";

import { logActivity } from "@/server/activity";
import { getDeps } from "@/server/deps";
import { ConflictError } from "@/server/docs";
import { CLAIM_ID, ITEM_ID, changeClaim, claim, markNotThere, unclaimItem, undoNotThere, undoUnclaim, type ClaimChange } from "@/server/items";
import { cleanName, setDeviceName } from "@/server/phones";
import { getVisitor } from "@/server/session";

/*
 * Claiming, called from the grid, the item page and My items. Like the code
 * actions, these answer with a message rather than throwing, because Next.js
 * hides a thrown error's text in production.
 *
 * None of them refresh the page: a claimed card stays where it is, dimmed,
 * until the grid next loads (spec section 2). My items refreshes itself.
 */

export type ClaimResult =
  | { ok: true; claimId: string }
  | {
      ok: false;
      reason: "need-name" | "taken" | "gone" | "no-code" | "busy";
      message: string;
      /** Whether the phone has a name now, so the page doesn't ask again after a claim that failed. */
      named: boolean;
    };

export type ChangeReason = Exclude<ClaimChange, { ok: true }>["reason"] | "no-code" | "busy";

export type ChangeResult = { ok: true } | { ok: false; reason: ChangeReason; message: string };

const NO_CODE = "Enter the school code first.";
const BUSY = "Lots of changes are happening at once. Try again.";
const GONE = "This item isn't on the list any more.";

async function visitorWithCode() {
  const visitor = await getVisitor();
  return visitor.canBrowse && visitor.phoneId ? { ...visitor, phoneId: visitor.phoneId } : null;
}

/**
 * "This is mine". The first claim from a phone needs the name admins will
 * see; without one this answers `need-name`, and the page asks for it and
 * tries again with `name`. A name passed in is saved even if the phone has
 * one, since the person just typed it.
 */
export async function claimAction(itemId: unknown, name?: unknown): Promise<ClaimResult> {
  const visitor = await visitorWithCode();
  let named = Boolean(visitor?.device?.name);
  const fail = (reason: Exclude<ClaimResult, { ok: true }>["reason"], message: string): ClaimResult => ({ ok: false, reason, message, named });
  if (!visitor) return fail("no-code", NO_CODE);
  if (typeof itemId !== "string" || !ITEM_ID.test(itemId)) return fail("gone", GONE);
  const deps = await getDeps();
  const { phoneId } = visitor;
  try {
    const typed = cleanName(name);
    let phoneName = visitor.device?.name ?? null;
    if (typed && typed !== phoneName) {
      await setDeviceName(deps, phoneId, typed);
      phoneName = typed;
      named = true;
      await logActivity(deps, { actor: phoneId, as_admin: visitor.isAdmin, action: "name_changed", detail: { name: typed } });
    }
    if (!phoneName) return fail("need-name", "Type a name, such as “Lee family, Rm 12”.");
    const outcome = await claim(deps, { itemId, phoneId, name: phoneName });
    if (!outcome.ok) return outcome.reason === "taken" ? fail("taken", "Someone just claimed this.") : fail("gone", GONE);
    if (outcome.changed) {
      await logActivity(deps, { actor: phoneId, as_admin: visitor.isAdmin, action: "claimed", item_id: itemId, claim_id: outcome.claim.id });
    }
    return { ok: true, claimId: outcome.claim.id };
  } catch (error) {
    if (error instanceof ConflictError) return fail("busy", BUSY);
    throw error;
  }
}

const MESSAGES: Record<Exclude<ClaimChange, { ok: true }>["reason"], string> = {
  gone: GONE,
  ended: "This claim was already closed, maybe by a PTA admin. Reload to see where it stands.",
  changed: "This item has changed since, so it can't be undone here.",
  taken: "Someone else has claimed it since.",
};

async function changeOwnClaim(
  apply: Parameters<typeof changeClaim>[1],
  action: string,
  itemId: unknown,
  claimId: unknown,
): Promise<ChangeResult> {
  const visitor = await visitorWithCode();
  if (!visitor) return { ok: false, reason: "no-code", message: NO_CODE };
  if (typeof itemId !== "string" || !ITEM_ID.test(itemId) || typeof claimId !== "string" || !CLAIM_ID.test(claimId)) {
    return { ok: false, reason: "gone", message: GONE };
  }
  const deps = await getDeps();
  try {
    const outcome = await changeClaim(deps, apply, { itemId, claimId, phoneId: visitor.phoneId });
    if (!outcome.ok) return { ok: false, reason: outcome.reason, message: MESSAGES[outcome.reason] };
    await logActivity(deps, { actor: visitor.phoneId, as_admin: visitor.isAdmin, action, item_id: itemId, claim_id: claimId });
    return { ok: true };
  } catch (error) {
    if (error instanceof ConflictError) return { ok: false, reason: "busy", message: BUSY };
    throw error;
  }
}

/** *Unclaim* in My items, or *Undo* on a card just claimed. The item goes back on the grid. */
export async function unclaimAction(itemId: unknown, claimId: unknown): Promise<ChangeResult> {
  return changeOwnClaim(unclaimItem, "unclaimed", itemId, claimId);
}

/** *Undo* after *Unclaim* in My items: the same claim, reopened. */
export async function undoUnclaimAction(itemId: unknown, claimId: unknown): Promise<ChangeResult> {
  return changeOwnClaim(undoUnclaim, "unclaim_undone", itemId, claimId);
}

/** *It wasn't there*: the claim closes and the item leaves the grid for everyone. */
export async function notThereAction(itemId: unknown, claimId: unknown): Promise<ChangeResult> {
  return changeOwnClaim(markNotThere, "not_there", itemId, claimId);
}

/** *Undo* after *It wasn't there*. */
export async function undoNotThereAction(itemId: unknown, claimId: unknown): Promise<ChangeResult> {
  return changeOwnClaim(undoNotThere, "not_there_undone", itemId, claimId);
}
