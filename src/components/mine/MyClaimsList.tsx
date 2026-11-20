"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { claimAction, notThereAction, undoNotThereAction, unclaimAction } from "@/app/actions/claims";
import { forgetClaimHere } from "@/components/claims/ClaimsProvider";
import { forgetGridOrigin } from "@/components/nav-origin";
import type { MyClaimState, MyClaimView } from "@/server/views";

const OFFLINE = "Couldn't reach the lost and found. Check the connection and try again.";
const BAR_MS = 8_000;

const BADGES: Record<MyClaimState, { text: string; className: string }> = {
  claimed: { text: "Claimed", className: "bg-brand-soft text-brand-dark" },
  "not there": { text: "Not in the bin", className: "bg-rule text-body" },
  "put back": { text: "Put back by an admin", className: "bg-warn-soft text-warn" },
  "picked up": { text: "Picked up", className: "bg-ok-soft text-ok" },
};

interface Bar {
  text: string;
  undo: () => Promise<{ ok: true } | { ok: false; message: string }>;
}

/**
 * The claims made from this phone, with *Unclaim* and *It wasn't there* on
 * open ones. Each change refreshes the list and offers *Undo* for a few
 * seconds.
 */
export function MyClaimsList({ rows, contactEmail }: { rows: MyClaimView[]; contactEmail: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ claimId: string | null; message: string } | null>(null);
  const [bar, setBar] = useState<Bar | null>(null);

  // An item page opened from here isn't a trip from the grid.
  useEffect(() => forgetGridOrigin(), []);

  useEffect(() => {
    if (!bar) return;
    const timer = setTimeout(() => setBar(null), BAR_MS);
    return () => clearTimeout(timer);
  }, [bar]);

  async function change(row: MyClaimView, kind: "unclaim" | "not there") {
    if (busy) return;
    setBusy(row.claimId);
    setProblem(null);
    try {
      const result = kind === "unclaim" ? await unclaimAction(row.itemId, row.claimId) : await notThereAction(row.itemId, row.claimId);
      if (!result.ok) {
        setProblem({ claimId: row.claimId, message: result.message });
        return;
      }
      forgetClaimHere(row.itemId);
      const type = row.title.split(" · ")[0];
      setBar(
        kind === "unclaim"
          ? { text: `${type} unclaimed. It's back on the grid.`, undo: () => claimAction(row.itemId) }
          : { text: `${type} marked as not in the bin.`, undo: () => undoNotThereAction(row.itemId, row.claimId) },
      );
      router.refresh();
    } catch {
      setProblem({ claimId: row.claimId, message: OFFLINE });
    } finally {
      setBusy(null);
    }
  }

  async function undo(current: Bar) {
    setBar(null);
    try {
      const result = await current.undo();
      if (!result.ok) setProblem({ claimId: null, message: result.message });
      router.refresh();
    } catch {
      setProblem({ claimId: null, message: OFFLINE });
    }
  }

  return (
    <>
      {problem && problem.claimId === null && (
        <p role="alert" className="notice bg-bad-soft text-bad">
          {problem.message}
        </p>
      )}
      {rows.length > 0 && (
        <ul className="card flex flex-col overflow-hidden">
          {rows.map((row) => (
            <li key={row.claimId} className="flex gap-3 border-b border-rule p-3.5 last:border-b-0">
              <Thumb row={row} />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[15px] font-bold">{row.title}</span>
                    <span className="text-[13px] text-muted">{row.claimed}</span>
                    {row.notThere && <span className="text-[13px] text-muted">You said it wasn&apos;t there, {row.notThere}</span>}
                  </div>
                  <span className={`flex-none rounded-full px-[9px] py-[3px] text-xs font-bold ${BADGES[row.state].className}`}>{BADGES[row.state].text}</span>
                </div>
                {row.state === "claimed" && (
                  <div className="flex flex-wrap gap-2">
                    <ActionButton busy={busy === row.claimId} onClick={() => change(row, "unclaim")}>
                      Unclaim
                    </ActionButton>
                    <ActionButton busy={busy === row.claimId} onClick={() => change(row, "not there")}>
                      It wasn&apos;t there
                    </ActionButton>
                  </div>
                )}
                {row.state === "put back" && (
                  <>
                    {row.note && <p className="text-sm text-body">“{row.note}”</p>}
                    <a href={`mailto:${contactEmail}`} className="text-sm font-bold">
                      Questions? Email the PTA
                    </a>
                  </>
                )}
                {problem && problem.claimId === row.claimId && (
                  <p role="alert" className="text-[13px] font-semibold text-bad">
                    {problem.message}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {bar && (
        <div
          role="status"
          className="fixed inset-x-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-30 mx-auto flex max-w-md items-center gap-2.5 rounded-[14px] bg-ink py-1.5 pr-1.5 pl-3.5 text-white shadow-[0_8px_24px_rgba(0,0,0,0.2)]"
        >
          <span className="flex-1 text-sm leading-snug">{bar.text}</span>
          <button type="button" onClick={() => undo(bar)} className="h-11 flex-none cursor-pointer rounded-[10px] px-3.5 text-[15px] font-bold text-[#9DB4FF]">
            Undo
          </button>
        </div>
      )}
    </>
  );
}

function Thumb({ row }: { row: MyClaimView }) {
  const faded = row.state !== "claimed" ? "opacity-55" : "";
  const image = row.thumb ? (
    // eslint-disable-next-line @next/next/no-img-element -- thumbnails are already 400 px
    <img src={row.thumb} alt={row.label} loading="lazy" className={`absolute inset-[8%] h-[84%] w-[84%] object-contain ${faded}`} />
  ) : (
    <svg aria-hidden="true" className="absolute inset-0 m-auto text-muted" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 8h12l-1 12H7L6 8z" />
      <path d="M9 8V6a3 3 0 0 1 6 0v2" />
    </svg>
  );
  const box = "relative h-16 w-16 flex-none overflow-hidden rounded-[10px] bg-tile";
  return row.href ? (
    <Link href={row.href} prefetch={false} className={box} aria-label={`Open ${row.label}`}>
      {image}
    </Link>
  ) : (
    <span className={box}>{image}</span>
  );
}

function ActionButton({ busy, onClick, children }: { busy: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-disabled={busy}
      onClick={() => {
        if (!busy) onClick();
      }}
      className="h-11 cursor-pointer rounded-[10px] border border-field bg-white px-3.5 text-sm font-bold text-ink hover:bg-page aria-disabled:cursor-wait aria-disabled:opacity-60"
    >
      {children}
    </button>
  );
}
