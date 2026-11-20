"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { cameFromGrid } from "@/components/nav-origin";

/**
 * "All items". Opened from the grid, it steps back so the grid comes back
 * where it was scrolled to; otherwise it opens the grid with the same filters.
 */
export function BackLink({ href }: { href: string }) {
  const router = useRouter();
  return (
    <Link
      href={href}
      onClick={(event) => {
        if (!cameFromGrid()) return;
        event.preventDefault();
        router.back();
      }}
      className="-ml-2.5 inline-flex h-11 items-center gap-0.5 pr-2.5 pl-1 text-base font-bold text-ink no-underline hover:text-ink"
    >
      <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M15 5l-7 7 7 7" />
      </svg>
      All items
    </Link>
  );
}
