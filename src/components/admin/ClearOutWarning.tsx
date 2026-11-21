"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * "The Dec 11 clear-out hasn't been done yet." on every admin tab but
 * *Clear out*, which says so itself (spec section 7).
 */
export function ClearOutWarning({ text }: { text: string }) {
  const pathname = usePathname();
  if (pathname === "/admin/clear-out") return null;
  return (
    <p className="notice mb-4 items-center justify-between bg-warn-soft text-warn">
      <span>{text}</span>
      <Link href="/admin/clear-out" className="flex-none font-bold text-warn underline hover:text-ink">
        Clear out
      </Link>
    </p>
  );
}
