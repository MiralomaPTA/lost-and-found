import type { Metadata } from "next";
import Link from "next/link";
import { RestoreButton } from "@/components/admin/RestoreButton";
import { adminCard, adminItems, adminSearch, parseAdminQuery, STATUS_FILTERS, statusCounts, type AdminCard } from "@/server/admin-views";
import { getDeps } from "@/server/deps";
import { loadItems } from "@/server/items";
import { requireAdmin } from "@/server/session";
import { tidyAfterAdminPage } from "@/server/tidy";

export const metadata: Metadata = { title: "Items · Admin · Lost & Found" };

const FILTER_LABELS = { all: "All", available: "Available", claimed: "Claimed", removed: "Removed" } as const;

const PILLS: Record<AdminCard["status"], string> = {
  available: "bg-ok-soft text-ok",
  claimed: "bg-brand-soft text-brand-dark",
  removed: "bg-rule text-body",
  donated: "bg-rule text-body",
};

/** Admin *Items* (spec section 6): every item since the last clear-out, by status, with its number and who added it. */
export default async function AdminItemsPage({ searchParams }: PageProps<"/admin/items">) {
  await requireAdmin();
  const deps = await getDeps();
  // Admins see changes at once, their own and other admins'.
  const file = await loadItems(deps, { fresh: true });
  const query = parseAdminQuery(await searchParams);
  // Old photos go now, not whenever the list is next saved; leftovers from a clear-out are retried.
  tidyAfterAdminPage(deps);
  const counts = statusCounts(file);
  const now = deps.now();
  const cards = adminItems(file, query).map((item) => adminCard(item, now));

  return (
    <div className="flex flex-col gap-3">
      <h1 tabIndex={-1} className="sr-only">
        Items
      </h1>
      <nav aria-label="Status" className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none]">
        {STATUS_FILTERS.map((status) => {
          const on = query.status === status;
          return (
            <Link
              key={status}
              href={`/admin/items${adminSearch({ ...query, status })}`}
              replace
              scroll={false}
              aria-current={on ? "page" : undefined}
              className={`inline-flex h-10 flex-none items-center gap-1.5 rounded-full border px-3 text-sm font-bold whitespace-nowrap no-underline ${on ? "border-ink bg-ink text-white hover:text-white" : "border-[#D5D8DE] bg-white text-ink hover:text-ink"}`}
            >
              {FILTER_LABELS[status]}
              <span className="font-semibold opacity-75">{counts[status]}</span>
            </Link>
          );
        })}
      </nav>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] text-muted">Tap an item to fix its tags, replace its photo or remove it</span>
        <Link
          href={`/admin/items${adminSearch({ ...query, sort: query.sort === "newest" ? "oldest" : "newest" })}`}
          replace
          scroll={false}
          className="inline-flex h-9 flex-none items-center gap-1 px-2 text-[13px] font-bold text-ink no-underline hover:text-ink"
        >
          <span className="sr-only">Sorted: </span>
          {query.sort === "newest" ? "Newest first" : "Oldest first"}
        </Link>
      </div>
      {cards.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted">Nothing here.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {cards.map((card) => (
            <li key={card.id} className="flex">
              <article className="flex w-full flex-col overflow-hidden rounded-[14px] border border-line bg-white">
                <Link href={card.href} prefetch={false} aria-label={`${card.id}, ${card.label}`} className="relative block aspect-square bg-tile">
                  {/* eslint-disable-next-line @next/next/no-img-element -- thumbnails are already 400 px */}
                  <img src={card.thumb} alt="" loading="lazy" className={`absolute inset-[12%] h-[76%] w-[76%] object-contain ${card.status === "removed" ? "opacity-45" : ""}`} />
                  <span className="absolute top-2 left-2 rounded-md bg-ink/80 px-[7px] py-0.5 text-[11px] font-bold text-white">{card.id}</span>
                  {card.hasName && (
                    <span title="Has a name" className="absolute top-2 right-2 flex h-[22px] w-[22px] items-center justify-center rounded-full bg-white text-ink shadow-[0_1px_2px_rgba(0,0,0,0.15)]">
                      <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9-9-9z" />
                      </svg>
                      <span className="sr-only">Has a name</span>
                    </span>
                  )}
                </Link>
                <div className="flex flex-1 flex-col gap-1.5 p-2.5">
                  <div className="flex flex-col gap-px">
                    <span className="text-sm font-bold">{card.title}</span>
                    <span className="text-xs text-muted">
                      {card.age} · added by {card.addedBy}
                    </span>
                  </div>
                  <span className={`self-start rounded-md px-2 py-[3px] text-xs leading-tight font-bold ${PILLS[card.status]}`}>{card.statusText}</span>
                  {card.status === "removed" && <RestoreButton itemId={card.id} label={card.label} className="mt-auto" />}
                </div>
              </article>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
