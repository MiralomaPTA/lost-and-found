"use client";

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type FocusEvent, type PointerEvent, type ReactNode } from "react";
import { UndoOffers, type Offer } from "@/lib/undo-offers";

/**
 * The admin section's bar at the bottom: "L-0142 removed: duplicate or
 * mistake · Undo" (spec section 6: removing, replacing a photo and undoing a
 * claim each offer *Undo* for a few seconds), or a plain notice. It lives in
 * the admin layout, so it stays while moving between admin pages. It takes
 * keyboard focus when it offers *Undo*, and waits while a mouse is over it
 * or it's keyboard-focused. Screen readers hear it through a live region
 * that's always on the page.
 */

interface UndoValue {
  offer(text: string, undo: () => Promise<string | null>, options?: { onExpire?: () => void }): void;
  notify(text: string): void;
}

const UndoContext = createContext<UndoValue | null>(null);

export function useUndo(): UndoValue {
  const value = useContext(UndoContext);
  if (!value) throw new Error("useUndo needs an UndoProvider");
  return value;
}

/** For components used both inside the admin section and outside it. */
export function useOptionalUndo(): UndoValue | null {
  return useContext(UndoContext);
}

const BAR_MS = 8_000;
let nextId = 0;

export function UndoProvider({ children }: { children: ReactNode }) {
  const [book] = useState(() => new UndoOffers());
  const [shown, setShown] = useState<Offer | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const show = useCallback(
    (offer: Offer) => {
      book.show(offer);
      setShown(offer);
      setAnnouncement(offer.undo ? `${offer.text} Undo is at the bottom of the screen.` : offer.text);
    },
    [book],
  );

  // Leaving the admin section ends the last offer: its change stands.
  useEffect(() => () => book.leave(), [book]);

  const close = useCallback(
    (id: number, expired: boolean) => {
      if (book.close(id, expired)) setShown(null);
    },
    [book],
  );

  const value: UndoValue = {
    offer: (text, undo, options) => show({ id: ++nextId, text, undo, onExpire: options?.onExpire }),
    notify: (text) => show({ id: ++nextId, text }),
  };

  return (
    <UndoContext.Provider value={value}>
      {children}
      <p role="status" className="sr-only">
        {announcement}
      </p>
      {shown && <Bar key={shown.id} offer={shown} onClose={close} onSpoken={setAnnouncement} />}
    </UndoContext.Provider>
  );
}

function Bar({ offer, onClose, onSpoken }: { offer: Offer; onClose: (id: number, expired: boolean) => void; onSpoken: (text: string) => void }) {
  const [paused, setPaused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const textId = useId();
  const canUndo = Boolean(offer.undo) && !error;

  useEffect(() => {
    if (offer.undo) button.current?.focus();
  }, [offer]);

  useEffect(() => {
    if (paused || busy) return;
    const timer = setTimeout(() => {
      // Don't drop keyboard focus to the page when the bar goes.
      if (bar.current?.contains(document.activeElement)) document.querySelector<HTMLElement>("main h1")?.focus();
      onClose(offer.id, true);
    }, BAR_MS);
    return () => clearTimeout(timer);
  }, [paused, busy, onClose, offer.id]);

  // A finger tapping the bar fires pointerenter with no matching leave on phones; only a mouse pauses it.
  const mouse = (paused: boolean) => (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType === "mouse") setPaused(paused);
  };
  const pauseOnKeyboardFocus = (event: FocusEvent<HTMLElement>) => setPaused(event.target.matches(":focus-visible"));

  return (
    <div
      ref={bar}
      onPointerEnter={mouse(true)}
      onPointerLeave={mouse(false)}
      onFocus={pauseOnKeyboardFocus}
      onBlur={() => setPaused(false)}
      className="fixed inset-x-3 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-md items-center gap-2.5 rounded-[14px] bg-ink py-1.5 pr-1.5 pl-3.5 text-white shadow-[0_8px_24px_rgba(0,0,0,0.2)]"
    >
      <span id={textId} className="flex-1 py-2 text-sm leading-snug">
        {error ?? offer.text}
      </span>
      {canUndo && (
        <button
          ref={button}
          type="button"
          aria-describedby={textId}
          aria-disabled={busy}
          onClick={async () => {
            if (busy || !offer.undo) return;
            setBusy(true);
            const failure = await offer.undo().catch(() => "Couldn't reach the lost and found. Try again.");
            setBusy(false);
            if (failure) {
              // Undo can't work now: the bar becomes a plain notice and goes as usual.
              setError(failure);
              onSpoken(failure);
              document.querySelector<HTMLElement>("main h1")?.focus();
            } else {
              onSpoken("Undone.");
              document.querySelector<HTMLElement>("main h1")?.focus();
              onClose(offer.id, false);
            }
          }}
          className="h-11 flex-none cursor-pointer rounded-[10px] px-3.5 text-[15px] font-extrabold text-[#9DB5FF] aria-disabled:cursor-wait aria-disabled:opacity-60"
        >
          {busy ? "Undoing…" : "Undo"}
        </button>
      )}
    </div>
  );
}
