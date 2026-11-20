"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useOptionalClaims } from "@/components/claims/ClaimsProvider";

/** The bottom bar (spec section 1): *All items*, *Add* and *My items*, with a count of this phone's open claims. */
export function BottomNav({ openClaims }: { openClaims: number }) {
  const pathname = usePathname();
  // On the grid, claims made on the page count straight away.
  const count = useOptionalClaims()?.openCount ?? openClaims;
  return (
    <nav
      aria-label="Main"
      data-bottom-nav
      className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-white pb-[env(safe-area-inset-bottom)]"
    >
      <div className="mx-auto grid max-w-md grid-cols-3">
        <Tab href="/" current={pathname === "/"} label="All items">
          <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
            <rect x="4" y="4" width="7" height="7" rx="1.5" />
            <rect x="13" y="4" width="7" height="7" rx="1.5" />
            <rect x="4" y="13" width="7" height="7" rx="1.5" />
            <rect x="13" y="13" width="7" height="7" rx="1.5" />
          </svg>
        </Tab>
        <Tab href="/add" current={pathname.startsWith("/add")} label="Add">
          <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
            <circle cx="12" cy="13" r="3.5" />
          </svg>
        </Tab>
        <Tab href="/mine" current={pathname === "/mine"} label="My items" badge={count > 0 ? count : null}>
          <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 8h12l-1 12H7L6 8z" />
            <path d="M9 8V6a3 3 0 0 1 6 0v2" />
          </svg>
        </Tab>
      </div>
    </nav>
  );
}

function Tab({ href, current, label, badge = null, children }: { href: string; current: boolean; label: string; badge?: number | null; children: ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={`flex h-16 flex-col items-center justify-center gap-[3px] text-xs font-bold no-underline ${current ? "text-brand hover:text-brand" : "text-muted hover:text-ink"}`}
    >
      <span className="relative flex">
        {children}
        {badge !== null && (
          <span className="absolute -top-1 -right-2.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-brand px-[5px] text-[11px] font-extrabold text-white">
            {badge}
            <span className="sr-only"> claimed</span>
          </span>
        )}
      </span>
      {label}
    </Link>
  );
}
