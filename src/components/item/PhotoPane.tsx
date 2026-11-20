"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

const SWIPE_PX = 60;

/**
 * The item's large photo. Pinch-zoom is the browser's own. Swiping sideways,
 * the arrow buttons and the arrow keys move through the grid's current list;
 * each move replaces the history entry, so *back* still goes to the grid.
 */
export function PhotoPane({ src, alt, prev, next }: { src: string; alt: string; prev: string | null; next: string | null }) {
  const router = useRouter();
  const start = useRef<{ x: number; y: number; at: number } | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, dialog, [contenteditable]")) return;
      const href = event.key === "ArrowLeft" ? prev : event.key === "ArrowRight" ? next : null;
      if (href) router.replace(href);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prev, next, router]);

  return (
    <div
      className="relative aspect-square w-full touch-pan-y touch-pinch-zoom bg-tile sm:mx-auto sm:max-w-[560px] sm:rounded-2xl"
      onTouchStart={(event) => {
        // One finger and not zoomed in: a pan of a zoomed photo isn't a swipe.
        const zoomed = (window.visualViewport?.scale ?? 1) > 1.01;
        start.current = event.touches.length === 1 && !zoomed ? { x: event.touches[0].clientX, y: event.touches[0].clientY, at: Date.now() } : null;
      }}
      onTouchEnd={(event) => {
        const from = start.current;
        start.current = null;
        const touch = event.changedTouches[0];
        if (!from || !touch || Date.now() - from.at > 800) return;
        const dx = touch.clientX - from.x;
        const dy = touch.clientY - from.y;
        if (Math.abs(dx) < SWIPE_PX || Math.abs(dy) > Math.abs(dx) * 0.6) return;
        const href = dx > 0 ? prev : next;
        if (href) router.replace(href);
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- photos are resized in the browser at upload, at most 1600 px */}
      <img src={src} alt={alt} className="absolute inset-[8%] h-[84%] w-[84%] object-contain" />
      {prev && <Arrow href={prev} label="Previous item" side="left" />}
      {next && <Arrow href={next} label="Next item" side="right" />}
      <span aria-hidden="true" className="absolute right-3 bottom-3 inline-flex items-center gap-1.5 rounded-full bg-ink/75 px-2.5 py-1.5 text-xs font-semibold text-white sm:hidden">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="6" />
          <path d="M20 20l-4.5-4.5M11 8v6M8 11h6" />
        </svg>
        Pinch to zoom
      </span>
    </div>
  );
}

function Arrow({ href, label, side }: { href: string; label: string; side: "left" | "right" }) {
  return (
    <Link
      href={href}
      replace
      prefetch={false}
      aria-label={label}
      className={`absolute top-1/2 ${side === "left" ? "left-2.5" : "right-2.5"} flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-ink shadow-[0_2px_8px_rgba(0,0,0,0.15)] hover:text-ink`}
    >
      <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d={side === "left" ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7"} />
      </svg>
    </Link>
  );
}
