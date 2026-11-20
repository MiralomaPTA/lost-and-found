"use client";

import { useRouter } from "next/navigation";
import { useEffect, useTransition, type ReactNode } from "react";
import { forgetGridOrigin } from "@/components/nav-origin";
import { gridSearch, type GridQuery } from "@/lib/grid-query";
import type { Swatch } from "@/server/views";

/**
 * Sort, *Has a name*, *New this week*, then a row of types and a row of
 * colors (one of each at a time). Each change replaces the address, so the
 * back button leaves the grid rather than stepping through filters.
 */
export function FilterBar({ query, types, colors }: { query: GridQuery; types: string[]; colors: { name: string; swatch: Swatch }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const go = (next: Partial<GridQuery>) => start(() => router.replace(`/${gridSearch({ ...query, ...next })}`, { scroll: false }));

  // Back on the grid: the next item page opened starts a new trip from here.
  useEffect(() => forgetGridOrigin(), []);

  return (
    <div aria-busy={pending} className={`flex flex-col gap-2 transition-opacity ${pending ? "opacity-70" : ""}`}>
      <Row label="Sort and quick filters">
        <Chip round pressed={null} onClick={() => go({ sort: query.sort === "newest" ? "oldest" : "newest" })}>
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3" />
          </svg>
          {query.sort === "newest" ? "Newest first" : "Oldest first"}
        </Chip>
        <Chip round pressed={query.named} onClick={() => go({ named: !query.named })}>
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9-9-9z" />
            <circle cx="8" cy="8" r="1.5" />
          </svg>
          Has a name
        </Chip>
        <Chip round pressed={query.recent} onClick={() => go({ recent: !query.recent })}>
          New this week
        </Chip>
      </Row>
      <Row label="Type">
        <Chip pressed={!query.type} onClick={() => go({ type: null })}>
          All types
        </Chip>
        {types.map((type) => (
          <Chip key={type} pressed={query.type === type} onClick={() => go({ type: query.type === type ? null : type })}>
            {type}
          </Chip>
        ))}
      </Row>
      <Row label="Color" tight>
        <Chip pressed={!query.color} onClick={() => go({ color: null })}>
          Any color
        </Chip>
        {colors.map((color) => {
          const on = query.color === color.name;
          return (
            <button
              key={color.name}
              type="button"
              aria-pressed={on}
              aria-label={color.name}
              title={color.name}
              onClick={() => go({ color: on ? null : color.name })}
              className={`h-10 w-10 flex-none cursor-pointer rounded-full border-2 bg-transparent p-1 ${on ? "border-ink" : "border-transparent"}`}
            >
              <span
                className="block h-7 w-7 rounded-full"
                style={{ background: color.swatch.background, boxShadow: `inset 0 0 0 1px ${color.swatch.light ? "#9AA0A8" : "rgba(0, 0, 0, 0.12)"}` }}
              />
            </button>
          );
        })}
      </Row>
    </div>
  );
}

function Row({ label, tight = false, children }: { label: string; tight?: boolean; children: ReactNode }) {
  return (
    <div
      role="group"
      aria-label={label}
      className={`flex items-center overflow-x-auto px-4 [scrollbar-width:none] sm:flex-wrap sm:overflow-visible ${tight ? "gap-1" : "gap-2"} sm:gap-y-2`}
    >
      {children}
    </div>
  );
}

function Chip({ pressed, round = false, onClick, children }: { pressed: boolean | null; round?: boolean; onClick: () => void; children: ReactNode }) {
  const on = pressed === true;
  return (
    <button
      type="button"
      aria-pressed={pressed === null ? undefined : pressed}
      onClick={onClick}
      className={`inline-flex h-10 flex-none cursor-pointer items-center gap-1.5 border px-3.5 text-sm font-semibold whitespace-nowrap ${
        round ? "rounded-full" : "rounded-[10px]"
      } ${on ? "border-ink bg-ink text-white" : "border-[#D5D8DE] bg-white text-ink hover:bg-page"}`}
    >
      {children}
    </button>
  );
}
