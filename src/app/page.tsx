import Link from "next/link";
import { BottomNav } from "@/components/BottomNav";
import { ClaimsProvider } from "@/components/claims/ClaimsProvider";
import { CodeGate } from "@/components/CodeGate";
import { FilterBar } from "@/components/grid/FilterBar";
import { ItemCard } from "@/components/grid/ItemCard";
import { PickupReminder } from "@/components/grid/PickupReminder";
import { showReminder } from "@/lib/clear-out";
import { dayLabel, pacificDate } from "@/lib/dates";
import { gridSearch, hasFilters, NO_FILTERS, parseGridQuery } from "@/lib/grid-query";
import { config } from "@/server/config";
import { getDeps } from "@/server/deps";
import { getItemsFile, getVisitor } from "@/server/session";
import { activeColors, activeTypes, cardView, gridItems, nextClearOutFor, openClaimItemIds } from "@/server/views";

/** The first-visit code box, then the grid of everything in the bin (spec section 1). */
export default async function Home({ searchParams }: PageProps<"/">) {
  const visitor = await getVisitor();
  if (!visitor.canBrowse) return <CodeGate isOpen={visitor.isOpen} />;

  const { settings } = visitor;
  const now = (await getDeps()).now();
  const file = await getItemsFile();
  const query = parseGridQuery(await searchParams);
  const list = gridItems(file, query, now);
  const inBin = file.items.filter((item) => item.status === "available").length;
  const openClaimIds = openClaimItemIds(file, visitor.phoneId);
  const clearOut = nextClearOutFor(settings, file, now);

  return (
    <ClaimsProvider hasName={Boolean(visitor.device?.name)} openClaimIds={openClaimIds} bin={settings.bin_description} contactEmail={config.contactEmail}>
      <h1 className="sr-only">Everything in the lost-and-found bin</h1>
      <div className="-mx-4 -mt-6 mb-3 flex flex-col sm:mx-0 sm:mt-0 sm:gap-3">
        {showReminder(pacificDate(now), clearOut) && <PickupReminder day={dayLabel(clearOut.date)} overdue={clearOut.overdue} openClaims={openClaimIds.length} />}
        <section aria-label="Sort and filter" className="border-b border-line bg-white py-2.5 sm:rounded-2xl sm:border">
          <FilterBar query={query} types={activeTypes(settings)} colors={activeColors(settings)} />
        </section>
      </div>

      {inBin === 0 ? (
        <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
          <p className="text-base font-bold">The bin is empty right now</p>
          <p className="max-w-sm text-sm text-muted">New things show up here as soon as someone photographs them.</p>
          <Link href="/add" className="btn-secondary btn-small mt-2">
            Add something
          </Link>
        </div>
      ) : list.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
          <p className="text-base font-bold">Nothing matches these filters</p>
          <Link href={`/${gridSearch({ ...NO_FILTERS, sort: query.sort })}`} replace scroll={false} className="btn-secondary btn-small">
            Clear filters
          </Link>
        </div>
      ) : (
        <>
          <p role="status" className="mb-2 text-[13px] font-semibold text-muted">
            {hasFilters(query) ? `${list.length} of ${inBin} items` : `${inBin} ${inBin === 1 ? "item" : "items"} in the bin`}
          </p>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {list.map((item) => (
              <li key={item.id} className="flex">
                <ItemCard card={cardView(item, settings, now, query)} />
              </li>
            ))}
          </ul>
        </>
      )}
      <BottomNav openClaims={openClaimIds.length} />
    </ClaimsProvider>
  );
}
