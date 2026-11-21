"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type FocusEvent, type ReactNode } from "react";

/**
 * The admin section's bar at the bottom: "L-0142 removed: duplicate or
 * mistake · Undo" (spec section 6: removing, replacing a photo and undoing a
 * claim each offer *Undo* for a few seconds), or a plain notice. It lives in
 * the admin layout, so it stays while moving between admin pages. It takes
 * keyboard focus when it offers *Undo*, and waits while pointed at or
 * keyboard-focused.
 */

interface Offer {
  id: number;
  text: string;
  /** Answers an error message, or null when undone. */
  undo?: () => Promise<string | null>;
  /** When the bar goes without *Undo*. */
  onExpire?: () => void;
}

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

const BAR_MS = 8_000;
let nextId = 0;

export function UndoProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<Offer | null>(null);
  const latest = useRef<Offer | null>(null);

  const show = useCallback((next: Offer) => {
    // A new bar replaces the last; the last one's change stands.
    latest.current?.onExpire?.();
    latest.current = next;
    setCurrent(next);
  }, []);

  const value: UndoValue = {
    offer: (text, undo, options) => show({ id: ++nextId, text, undo, onExpire: options?.onExpire }),
    notify: (text) => show({ id: ++nextId, text }),
  };

  // Leaving the admin section ends the last offer: its change stands.
  useEffect(() => () => latest.current?.onExpire?.(), []);

  const close = useCallback((expired: boolean) => {
    if (expired) latest.current?.onExpire?.();
    latest.current = null;
    setCurrent(null);
  }, []);

  return (
    <UndoContext.Provider value={value}>
      {children}
      {current && <Bar key={current.id} offer={current} onClose={close} />}
    </UndoContext.Provider>
  );
}

function Bar({ offer, onClose }: { offer: Offer; onClose: (expired: boolean) => void }) {
  const [paused, setPaused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (offer.undo) button.current?.focus();
  }, [offer]);

  useEffect(() => {
    if (paused || busy) return;
    const timer = setTimeout(() => {
      // Don't drop keyboard focus to the page when the bar goes.
      if (bar.current?.contains(document.activeElement)) document.querySelector<HTMLElement>("main h1")?.focus();
      onClose(true);
    }, BAR_MS);
    return () => clearTimeout(timer);
  }, [paused, busy, onClose]);

  const pauseOnKeyboardFocus = (event: FocusEvent<HTMLElement>) => setPaused(event.target.matches(":focus-visible"));

  return (
    <div
      ref={bar}
      role="status"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={pauseOnKeyboardFocus}
      onBlur={() => setPaused(false)}
      className="fixed inset-x-3 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-md items-center gap-2.5 rounded-[14px] bg-ink py-1.5 pr-1.5 pl-3.5 text-white shadow-[0_8px_24px_rgba(0,0,0,0.2)]"
    >
      <span className="flex-1 py-2 text-sm leading-snug">{error ?? offer.text}</span>
      {offer.undo && (
        <button
          ref={button}
          type="button"
          aria-disabled={busy}
          onClick={async () => {
            if (busy || !offer.undo) return;
            setBusy(true);
            const failure = await offer.undo().catch(() => "Couldn't reach the lost and found. Try again.");
            setBusy(false);
            if (failure) setError(failure);
            else {
              document.querySelector<HTMLElement>("main h1")?.focus();
              onClose(false);
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
