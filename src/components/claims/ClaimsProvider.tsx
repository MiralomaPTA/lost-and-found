"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { claimAction, unclaimAction } from "@/app/actions/claims";
import { countOpenClaims, type CardState } from "@/components/claims/claim-state";

/**
 * Claiming from the grid and the item page (spec section 2): one tap, no
 * confirmation, and *Undo* right on the card. The first claim from a phone
 * asks for the name the PTA will see, in a sheet, then claims.
 */

export interface ClaimTarget {
  id: string;
  /** "Navy jacket". */
  label: string;
  thumb: string;
  title: string;
}

export type { CardState };

interface ClaimsValue {
  stateOf(itemId: string): CardState;
  claim(target: ClaimTarget): void;
  undo(target: ClaimTarget): void;
  /** This phone's open claims, counting the ones made and undone on this page. */
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
 * still shows "In My items" on the other, even when the page comes back from
 * history as it was before the claim. A reload starts over, and by then the
 * claimed item has left the grid.
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
  openClaimIds,
  initialMine = {},
  available = [],
  bin,
  contactEmail,
  children,
}: {
  hasName: boolean;
  /** The items this phone already has claimed, as the server last saw them. */
  openClaimIds: string[];
  /** Of those, the ones whose claim IDs this page needs for *Undo*. */
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
  const [asking, setAsking] = useState<ClaimTarget | null>(null);
  const [toast, setToast] = useState(0);
  const [toastPaused, setToastPaused] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  const set = useCallback((itemId: string, state: CardState) => setStates((all) => ({ ...all, [itemId]: state })), []);
  // Screen readers hear changes through one live region that's always on the page.
  const announce = useCallback((text: string) => setAnnouncement((previous) => (previous === text ? `${text} ` : text)), []);
  const rememberNamed = useCallback(() => {
    namedHere = true;
    setNamed(true);
  }, []);

  useEffect(() => {
    if (!toast || toastPaused) return;
    const timer = setTimeout(() => setToast(0), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast, toastPaused]);

  /** Claims, with the typed name on a first claim. Answers the sheet's error, if any. */
  const run = useCallback(
    async (target: ClaimTarget, name?: string): Promise<string | null> => {
      set(target.id, { kind: "busy" });
      let result;
      try {
        result = await claimAction(target.id, name);
      } catch {
        set(target.id, { kind: "open", message: OFFLINE });
        announce(OFFLINE);
        return OFFLINE;
      }
      if (result.ok) {
        claimedHere.set(target.id, result.claimId);
        rememberNamed();
        set(target.id, { kind: "mine", claimId: result.claimId });
        setToast((n) => n + 1);
        announce(`${target.label} is in My items. Pick it up from the lost-and-found bin ${bin}.`);
        return null;
      }
      // The name may have been saved even though the claim didn't go through.
      if (result.named) rememberNamed();
      switch (result.reason) {
        case "need-name":
          setNamed(false);
          set(target.id, { kind: "open" });
          setAsking(target);
          return result.message;
        case "taken":
          set(target.id, { kind: "taken" });
          announce(`Someone just claimed the ${target.label.toLowerCase()}. If it's yours, email the PTA.`);
          return null;
        case "gone":
          set(target.id, { kind: "gone", message: result.message });
          announce(result.message);
          return null;
        default:
          set(target.id, { kind: "open", message: result.message });
          announce(result.message);
          return result.message;
      }
    },
    [set, announce, rememberNamed, bin],
  );

  const claim = useCallback(
    (target: ClaimTarget) => {
      if (named) void run(target);
      else setAsking(target);
    },
    [named, run],
  );

  const undo = useCallback(
    async (target: ClaimTarget) => {
      const current = latest.current[target.id];
      if (current?.kind !== "mine") return;
      const { claimId } = current;
      set(target.id, { kind: "busy" });
      let result;
      try {
        result = await unclaimAction(target.id, claimId);
      } catch {
        set(target.id, { kind: "mine", claimId, message: OFFLINE });
        announce(OFFLINE);
        return;
      }
      if (result.ok) {
        claimedHere.delete(target.id);
        set(target.id, { kind: "open" });
        setToast(0);
        announce(`${target.label} is back on the list.`);
      } else if (result.reason === "busy" || result.reason === "no-code") {
        set(target.id, { kind: "mine", claimId, message: result.message });
        announce(result.message);
      } else {
        // An admin closed the claim, or the item left the list: there's nothing to undo.
        claimedHere.delete(target.id);
        set(target.id, { kind: "gone", message: result.message });
        announce(result.message);
      }
    },
    [set, announce],
  );

  const value = useMemo<ClaimsValue>(
    () => ({
      stateOf: (itemId) => states[itemId] ?? { kind: "open" },
      claim,
      undo: (target) => void undo(target),
      openCount: countOpenClaims(openClaimIds, states),
      contactEmail,
    }),
    [states, claim, undo, openClaimIds, contactEmail],
  );

  return (
    <ClaimsContext.Provider value={value}>
      {children}
      <p role="status" className="sr-only">
        {announcement}
      </p>
      <NameSheet target={asking} onClose={() => setAsking(null)} onSubmit={run} />
      {toast > 0 && <PickupToast bin={bin} onClose={() => setToast(0)} onPause={setToastPaused} />}
    </ClaimsContext.Provider>
  );
}

/** "What name should the PTA see?", before a phone's first claim. */
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
              What name should the PTA see?
            </h2>
            <p className="text-sm leading-relaxed text-muted">
              The PTA sees it next to your claims and anything you add, in case of a mix-up. Other families don&apos;t. We only ask once.
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

/** Where to pick it up. The live region announces it; the bar stays while it's pointed at or focused. */
function PickupToast({ bin, onClose, onPause }: { bin: string; onClose: () => void; onPause: (paused: boolean) => void }) {
  useEffect(() => () => onPause(false), [onPause]);
  return (
    <div
      onMouseEnter={() => onPause(true)}
      onMouseLeave={() => onPause(false)}
      onFocus={() => onPause(true)}
      onBlur={() => onPause(false)}
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
