import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { AdminItemActions } from "@/components/admin/AdminItemActions";
import { UndoClaimForm } from "@/components/admin/UndoClaimForm";
import { AdminItemTags } from "@/components/admin/AdminItemTags";
import { adminItemView, itemActorIds, phoneNames } from "@/server/admin-views";
import { getDeps } from "@/server/deps";
import { ITEM_ID, loadItems, sweepReplacedPhotos } from "@/server/items";
import { requireAdmin } from "@/server/session";
import { after } from "next/server";
import { activeColors, activeTypes, swatchFor } from "@/server/views";

export const metadata: Metadata = { title: "Item · Admin · Lost & Found" };

/** One item for admins (spec section 6): its tags, plus *Replace photo*, *Remove* or *Restore*, *Undo claim* and its claims. */
export default async function AdminItemPage({ params }: PageProps<"/admin/items/[id]">) {
  const { settings } = await requireAdmin();
  const { id } = await params;
  if (!ITEM_ID.test(id)) notFound();
  const deps = await getDeps();
  const file = await loadItems(deps, { fresh: true });
  const item = file.items.find((i) => i.id === id);
  // Old photos whose Undo time is over go now, not whenever the list is next saved.
  after(() => sweepReplacedPhotos(deps).catch((error) => console.error("Couldn't sweep replaced photos", error)));
  if (!item) notFound();
  const names = await phoneNames(deps, itemActorIds(item));
  const view = adminItemView(item, names, deps.now());
  const onList = view.status === "available" || view.status === "claimed";

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      <Link href="/admin/items" className="-ml-1 inline-flex h-11 items-center gap-0.5 self-start pr-2 text-[15px] font-bold text-ink no-underline hover:text-ink">
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 5l-7 7 7 7" />
        </svg>
        Items
      </Link>
      <h1 tabIndex={-1} className="text-[13px] font-extrabold tracking-[0.05em] text-muted uppercase outline-none">
        {view.id}
      </h1>
      <div className="relative aspect-square w-full overflow-hidden rounded-2xl bg-tile">
        {/* eslint-disable-next-line @next/next/no-img-element -- photos are already sized */}
        <img src={view.photo} alt={view.label} className={`absolute inset-[8%] h-[84%] w-[84%] object-contain ${view.status === "removed" ? "opacity-50" : ""}`} />
      </div>
      <AdminItemTags
        key={`${view.id}-${view.type}-${view.color}-${view.hasName}`}
        itemId={onList ? view.id : null}
        initial={{ type: view.type, color: view.color, hasName: view.hasName }}
        types={activeTypes(settings)}
        colors={activeColors(settings)}
        palette={Object.fromEntries(settings.colors.map((c) => [c.name, swatchFor(settings, c.name)]))}
      />

      <dl className="card flex flex-col divide-y divide-rule">
        <Fact label="Added">
          {view.added} by {view.addedBy} · Phone {view.addedPhone}
        </Fact>
        <Fact label="Status">{view.statusText}</Fact>
        {view.removed && (
          <Fact label="Removed">
            {view.removed.reason}, by {view.removed.by} · {view.removed.when}
          </Fact>
        )}
        {view.open && (
          <Fact label="Claimed">
            <span className="flex flex-col gap-2">
              <span>
                {view.open.name} · Phone {view.open.phone} · {view.open.when}
              </span>
              <UndoClaimForm itemId={view.id} claimId={view.open.claimId} label={view.label} />
            </span>
          </Fact>
        )}
      </dl>

      <AdminItemActions itemId={view.id} label={view.label} status={view.status} />

      {view.claims.length > 0 && (
        <section aria-labelledby="h-claims" className="flex flex-col gap-2">
          <h2 id="h-claims" className="text-[13px] font-extrabold tracking-[0.05em] text-muted uppercase">
            Claims
          </h2>
          <ul className="card flex flex-col divide-y divide-rule">
            {view.claims.map((claim) => (
              <li key={claim.claimId} className="flex flex-col gap-0.5 px-4 py-3 text-sm">
                <span className="font-bold">{claim.name}</span>
                <span className="text-muted">
                  Phone {claim.phone} · claimed {claim.when}
                </span>
                {claim.outcome && <span className="text-muted">{claim.outcome}</span>}
                {claim.note && <span className="text-body">“{claim.note}”</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {onList && (
        <p className="text-center text-[13px]">
          <Link href={view.publicHref}>See it as families do</Link>
        </p>
      )}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 px-4 py-3">
      <dt className="text-xs font-bold tracking-[0.04em] text-muted uppercase">{label}</dt>
      <dd className="text-[15px]">{children}</dd>
    </div>
  );
}
