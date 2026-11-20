"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { claimAction, unclaimAction } from "@/app/actions/claims";

/**
 * Claiming from the grid and the item page (spec section 2): one tap, no
 * confirmation, and *Undo* right on the card. The first claim from a phone
 * asks for the name admins will see, in a sheet, then claims.
 */

export interface ClaimTarget {
  id: string;
  label: string;
  thumb: string;
  title: string;
}

export type CardState =
  | { kind: "open"; message?: string }
  | { kind: "busy" }
  | { kind: "mine"; claimId: string; message?: string }
  | { kind: "taken" }
  | { kind: "gone"; message: string };

interface ClaimsValue {
  stateOf(itemId: string): CardState;
  claim(target: ClaimTarget): void;
  undo(itemId: string): void;
  /** This phone's open claims, counting the ones made on this page. */
  openCount: number;
  contactEmail: string;
}

const ClaimsContext = createContext<ClaimsValue | null>(null);

export function useClaims(): ClaimsValue {
  const value = useContext(ClaimsContext);
  if (!value) throw new Error("useClaims needs a ClaimsProvider");
  return value;
}

export function useOptionalClaims(): ClaimsValue | null {
  return useContext(ClaimsContext);
}

/*
 * Claims made since the page was opened, kept across moves between the grid
 * and item pages (which don't reload the page), so a card claimed on one
 * still shows "In My items" on the other. A reload starts over, and by then
 * the claimed item has left the grid.
 */
const claimedHere = new Map<string, string>();
let namedHere = false;

/** For My items: a claim that was closed there must not show as "In My items" back on the grid. */
export function forgetClaimHere(itemId: string): void {
  claimedHere.delete(itemId);
}

const OFFLINE = "Couldn't reach the lost and found. Check the connection and try again.";
const TOAST_MS = 10_000;

export function ClaimsProvider({
  hasName,
  openClaims,
  initialMine = {},
  available = [],
  bin,
  contactEmail,
  children,
}: {
  hasName: boolean;
  openClaims: number;
  /** Items this phone already has claimed, by item ID: their claim IDs, for *Undo*. */
  initialMine?: Record<string, string>;
  /** Items the server just said are available, which overrules what this page remembers. */
  available?: string[];
  /** Finishes "Pick it up from the lost-and-found bin …". */
  bin: string;
  contactEmail: string;
  children: ReactNode;
}) {
  const [states, setStates] = useState<Record<string, CardState>>(() =>
    Object.fromEntries(
      [...claimedHere, ...Object.entries(initialMine)]
        .filter(([itemId]) => !available.includes(itemId))
        .map(([itemId, claimId]) => [itemId, { kind: "mine", claimId } satisfies CardState]),
    ),
  );
  // Bring the remembered claims up to date with what the server said.
  useEffect(() => {
    for (const [itemId, claimId] of Object.entries(initialMine)) claimedHere.set(itemId, claimId);
    for (const itemId of available) claimedHere.delete(itemId);
    // Only what the page arrived with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const latest = useRef(states);
  useEffect(() => {
    latest.current = states;
  }, [states]);
  const [named, setNamed] = useState(hasName || namedHere);
  const [delta, setDelta] = useState(0);
  const [asking, setAsking] = useState<ClaimTarget | null>(null);
  const [toast, setToast] = useState(false);

  const set = useCallback((itemId: string, state: CardState) => setStates((all) => ({ ...all, [itemId]: state })), []);

  const showToast = useCallback(() => setToast(true), []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(false), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast, states]);

  /** Claims, with the typed name on a first claim. Answers the sheet's error, if any. */
  const run = useCallback(
    async (target: ClaimTarget, name?: string): Promise<string | null> => {
      set(target.id, { kind: "busy" });
      let result;
      try {
        result = await claimAction(target.id, name);
      } catch {
        set(target.id, { kind: "open", message: OFFLINE });
        return OFFLINE;
      }
      if (result.ok) {
        setDelta((d) => d + 1);
        claimedHere.set(target.id, result.claimId);
        namedHere = true;
        setNamed(true);
        set(target.id, { kind: "mine", claimId: result.claimId });
        showToast();
        return null;
      }
      switch (result.reason) {
        case "need-name":
          setNamed(false);
          set(target.id, { kind: "open" });
          setAsking(target);
          return result.message;
        case "taken":
          set(target.id, { kind: "taken" });
          return null;
        case "gone":
          set(target.id, { kind: "gone", message: result.message });
          return null;
        default:
          set(target.id, { kind: "open", message: result.message });
          return result.message;
      }
    },
    [set, showToast],
  );

  const claim = useCallback(
    (target: ClaimTarget) => {
      if (named) void run(target);
      else setAsking(target);
    },
    [named, run],
  );

  const undo = useCallback(
    async (itemId: string) => {
      const current = latest.current[itemId];
      if (current?.kind !== "mine") return;
      const { claimId } = current;
      set(itemId, { kind: "busy" });
      let result;
      try {
        result = await unclaimAction(itemId, claimId);
      } catch {
        set(itemId, { kind: "mine", claimId, message: OFFLINE });
        return;
      }
      if (result.ok) {
        claimedHere.delete(itemId);
        setDelta((d) => d - 1);
        set(itemId, { kind: "open" });
        setToast(false);
      } else {
        set(itemId, { kind: "mine", claimId, message: result.message });
      }
    },
    [set],
  );

  const value = useMemo<ClaimsValue>(
    () => ({
      stateOf: (itemId) => states[itemId] ?? { kind: "open" },
      claim,
      undo: (itemId) => void undo(itemId),
      openCount: Math.max(0, openClaims + delta),
      contactEmail,
    }),
    [states, claim, undo, openClaims, delta, contactEmail],
  );

  return (
    <ClaimsContext.Provider value={value}>
      {children}
      <NameSheet target={asking} onClose={() => setAsking(null)} onSubmit={run} />
      {toast && <PickupToast bin={bin} onClose={() => setToast(false)} />}
    </ClaimsContext.Provider>
  );
}

/** "What name should PTA admins see?", before a phone's first claim. */
function NameSheet({
  target,
  onClose,
  onSubmit,
}: {
  target: ClaimTarget | null;
  onClose: () => void;
  onSubmit: (target: ClaimTarget, name: string) => Promise<string | null>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (target && !element.open) {
      setError(null);
      element.showModal();
    } else if (!target && element.open) {
      element.close();
    }
  }, [target]);

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      aria-labelledby="name-sheet-title"
      className="m-0 mt-auto w-full max-w-none rounded-t-[20px] bg-white p-0 text-ink backdrop:bg-ink/45 sm:m-auto sm:max-w-md sm:rounded-[20px]"
    >
      {target && (
        <form
          className="flex flex-col gap-4 px-5 pt-3 pb-[calc(1.25rem+env(safe-area-inset-bottom))]"
          onSubmit={async (event) => {
            event.preventDefault();
            if (pending) return;
            const name = String(new FormData(event.currentTarget).get("name") ?? "");
            setPending(true);
            const problem = await onSubmit(target, name);
            setPending(false);
            if (problem) setError(problem);
            else onClose();
          }}
        >
          <span aria-hidden="true" className="mx-auto h-1 w-10 rounded-full bg-field sm:hidden" />
          <div className="flex items-center gap-3 rounded-xl bg-page p-2.5">
            <span className="relative h-12 w-12 flex-none overflow-hidden rounded-lg bg-tile">
              {/* eslint-disable-next-line @next/next/no-img-element -- photos come from the bucket, already sized */}
              <img src={target.thumb} alt="" className="absolute inset-[8%] h-[84%] w-[84%] object-contain" />
            </span>
            <span className="flex flex-col">
              <span className="text-xs font-semibold text-muted">Claiming</span>
              <span className="text-[15px] font-bold">{target.title}</span>
            </span>
          </div>
          <div className="flex flex-col gap-1.5">
            <h2 id="name-sheet-title" className="text-[21px] leading-tight font-extrabold">
              What name should PTA admins see?
            </h2>
            <p className="text-sm leading-relaxed text-muted">
              Admins see it next to your claims and anything you add, in case of a mix-up. Other families don&apos;t. We only ask once.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <label htmlFor="claim-name" className="label">
              Your name
            </label>
            <input
              id="claim-name"
              name="name"
              required
              maxLength={60}
              autoComplete="name"
              placeholder="e.g. Lee family, Rm 12"
              className="field"
              aria-describedby={error ? "claim-name-hint claim-name-error" : "claim-name-hint"}
              aria-invalid={error ? true : undefined}
            />
            <span id="claim-name-hint" className="hint">
              You can change it later in My items.
            </span>
            {error && (
              <p id="claim-name-error" role="alert" className="text-sm font-semibold text-bad">
                {error}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <button type="submit" aria-disabled={pending} className="btn-primary aria-disabled:cursor-wait aria-disabled:opacity-60">
              {pending ? "Claiming…" : "Save and claim"}
            </button>
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}

function PickupToast({ bin, onClose }: { bin: string; onClose: () => void }) {
  return (
    <div
      role="status"
      className="fixed inset-x-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-30 mx-auto flex max-w-md items-center gap-2.5 rounded-[14px] bg-ink py-1.5 pr-1 pl-3.5 text-white shadow-[0_8px_24px_rgba(0,0,0,0.2)]"
    >
      <svg aria-hidden="true" className="flex-none" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z" />
        <circle cx="12" cy="9" r="2.5" />
      </svg>
      <span className="flex-1 text-sm leading-snug">Pick it up from the lost-and-found bin {bin}.</span>
      <button type="button" onClick={onClose} aria-label="Dismiss" className="flex h-11 w-11 flex-none cursor-pointer items-center justify-center text-white">
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  );
}
