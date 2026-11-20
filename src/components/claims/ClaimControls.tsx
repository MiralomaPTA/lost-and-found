"use client";

import { useEffect, useRef } from "react";
import { useClaims, type ClaimTarget } from "@/components/claims/ClaimsProvider";

/**
 * *This is mine*, and what replaces it: "In My items" with *Undo*, or
 * "Someone just claimed this". `card` is the grid's compact version; `page`
 * is the item page's. Changes are announced by the provider's live region.
 */
export function ClaimControls({ target, size }: { target: ClaimTarget; size: "card" | "page" }) {
  const { stateOf, claim, undo, contactEmail } = useClaims();
  const state = stateOf(target.id);
  const undoButton = useRef<HTMLButtonElement>(null);
  const claimButton = useRef<HTMLButtonElement>(null);
  const message = useRef<HTMLParagraphElement>(null);
  // Set when this card's button is pressed, so focus follows when that button is swapped out.
  const keepFocus = useRef(false);
  const page = size === "page";

  useEffect(() => {
    if (!keepFocus.current || state.kind === "busy") return;
    keepFocus.current = false;
    (undoButton.current ?? claimButton.current ?? message.current)?.focus({ preventScroll: true });
  }, [state.kind]);

  /** Which item, for screen readers: "This is mine, navy jacket". */
  const which = <span className="sr-only">, {target.label.toLowerCase()}</span>;

  const note = (text?: string) => (text ? <p className="text-[12.5px] leading-snug font-semibold text-bad">{text}</p> : null);

  if (state.kind === "open" || state.kind === "busy") {
    const busy = state.kind === "busy";
    return (
      <div className="flex flex-col gap-1.5">
        <button
          ref={claimButton}
          type="button"
          aria-disabled={busy}
          onClick={() => {
            if (busy) return;
            keepFocus.current = true;
            claim(target);
          }}
          className={`${page ? "btn-primary w-full" : "h-11 w-full cursor-pointer rounded-[10px] bg-brand text-[15px] font-bold text-white hover:bg-brand-dark"} aria-disabled:cursor-wait aria-disabled:opacity-60`}
        >
          {busy ? "Saving…" : "This is mine"}
          {which}
        </button>
        {state.kind === "open" && note(state.message)}
      </div>
    );
  }

  if (state.kind === "mine") {
    return (
      <div className="flex flex-col gap-1.5">
        <div className={`flex items-center justify-between gap-1.5 ${page ? "rounded-xl bg-brand-soft py-1.5 pr-1.5 pl-3.5" : "h-11"}`}>
          <span className={`inline-flex items-center gap-1 font-bold whitespace-nowrap text-brand-dark ${page ? "text-base" : "text-[13px]"}`}>
            <svg aria-hidden="true" className="flex-none" width={page ? 16 : 14} height={page ? 16 : 14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12l5 5 9-10" />
            </svg>
            In My items
          </span>
          <button
            ref={undoButton}
            type="button"
            onClick={() => {
              keepFocus.current = true;
              undo(target);
            }}
            className={`h-11 flex-none cursor-pointer rounded-[10px] border border-field bg-white text-sm font-bold text-ink hover:bg-page ${page ? "px-4" : "px-2.5"}`}
          >
            Undo
            {which}
          </button>
        </div>
        {note(state.message)}
      </div>
    );
  }

  return (
    <p
      ref={message}
      tabIndex={-1}
      className={`${page ? "rounded-xl bg-page px-4 py-3.5 text-[15px]" : "min-h-11 text-[12.5px]"} leading-snug font-semibold text-[#8A2A12] outline-none`}
    >
      {state.kind === "taken" ? (
        <>
          Someone just claimed this. If it&apos;s yours,{" "}
          <a href={`mailto:${contactEmail}`} className="text-[#8A2A12] underline">
            email the PTA
          </a>
          .
        </>
      ) : (
        state.message
      )}
    </p>
  );
}
