"use client";

import Link from "next/link";
import { useOptionalClaims } from "@/components/claims/ClaimsProvider";

/**
 * The last week before a clear-out, or a clear-out that's overdue: everything
 * left goes to donation, so pick up what's claimed.
 */
export function PickupReminder({ day, overdue, openClaims }: { day: string; overdue: boolean; openClaims: number }) {
  const count = useOptionalClaims()?.openCount ?? openClaims;
  return (
    <div className="flex gap-2.5 border-b border-[#EED48A] bg-warn-soft px-4 py-2.5 text-warn sm:rounded-xl sm:border">
      <svg aria-hidden="true" className="mt-px flex-none" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M3 10h18M8 3v4M16 3v4" />
      </svg>
      <div className="flex flex-col gap-0.5 text-[13px] leading-snug">
        <span className="font-bold">
          {overdue ? `The ${day} clear-out hasn't happened yet. Everything still here goes to donation when it does.` : `Everything still here on ${day} goes to donation.`}
        </span>
        {count > 0 && (
          <Link href="/mine" className="text-warn underline hover:text-warn">
            Pick up your {count} claimed {count === 1 ? "item" : "items"} {overdue ? "soon" : "before then"}.
          </Link>
        )}
      </div>
    </div>
  );
}
