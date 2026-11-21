"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/admin/items", label: "Items" },
  { href: "/admin/claims", label: "Claims" },
  { href: "/admin/clear-out", label: "Clear out" },
  { href: "/admin/settings", label: "Settings" },
];

/** The admin section's tabs (spec section 6). */
export function AdminTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Admin" className="-mx-4 -mt-6 mb-4 grid grid-cols-4 border-b border-line bg-white sm:mx-0 sm:mt-0 sm:rounded-2xl sm:border">
      {TABS.map((tab) => {
        const current = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={current ? "page" : undefined}
            className={`flex h-12 items-center justify-center text-sm no-underline ${current ? "font-extrabold text-ink shadow-[inset_0_-3px_0_var(--color-brand)] hover:text-ink" : "font-bold text-muted hover:text-ink"}`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
