"use client";

import Link from "next/link";
import { ClaimControls } from "@/components/claims/ClaimControls";
import { useClaims } from "@/components/claims/ClaimsProvider";
import { rememberGridOrigin } from "@/components/nav-origin";
import { Swatch } from "@/components/Swatch";
import type { CardView } from "@/server/views";

/** One square photo card in the grid, with *This is mine* under it. */
export function ItemCard({ card }: { card: CardView }) {
  const { stateOf } = useClaims();
  const kind = stateOf(card.id).kind;
  const dim = kind === "mine" || kind === "taken" || kind === "gone" ? "opacity-40" : "";
  return (
    <article className="flex w-full flex-col overflow-hidden rounded-[14px] border border-line bg-white">
      <Link
        href={card.href}
        prefetch={false}
        onClick={rememberGridOrigin}
        aria-label={`Open ${card.label}`}
        className={`relative block aspect-square bg-tile transition-opacity ${dim}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- thumbnails are made in the browser at upload, already 400 px */}
        <img src={card.thumb} alt="" loading="lazy" decoding="async" className="absolute inset-[10%] h-[80%] w-[80%] object-contain" />
        {card.hasName && (
          <span className="absolute top-2 left-2 inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[11px] font-bold text-ink shadow-[0_1px_2px_rgba(0,0,0,0.15)]">
            <TagIcon />
            Has a name
          </span>
        )}
      </Link>
      <div className="flex flex-1 flex-col justify-between gap-2 p-2.5">
        <div className={`flex flex-col gap-0.5 transition-opacity ${dim}`}>
          <span className="text-[15px] font-bold">{card.type}</span>
          <span className="flex items-center gap-1.5 text-[13px] text-muted">
            <Swatch swatch={card.swatch} />
            {card.color} · {card.age}
          </span>
        </div>
        <ClaimControls target={{ id: card.id, label: card.label, thumb: card.thumb, title: `${card.type} · ${card.color}` }} size="card" />
      </div>
    </article>
  );
}

export function TagIcon({ size = 12 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9-9-9z" />
    </svg>
  );
}
