import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { ClaimControls } from "@/components/claims/ClaimControls";
import { ClaimsProvider } from "@/components/claims/ClaimsProvider";
import { CodeGate } from "@/components/CodeGate";
import { BackLink } from "@/components/item/BackLink";
import { ItemTags } from "@/components/item/ItemTags";
import { PhotoPane } from "@/components/item/PhotoPane";
import { gridSearch, parseGridQuery } from "@/lib/grid-query";
import { findArchivedItem } from "@/server/archives";
import { config } from "@/server/config";
import { getDeps } from "@/server/deps";
import { ITEM_ID } from "@/server/items";
import { getItemsFile, getVisitor } from "@/server/session";
import { activeColors, activeTypes, archivedItemView, itemLabel, itemPageView, openClaimItemIds, swatchFor } from "@/server/views";

/**
 * "Navy jacket · Lost & Found". A title per item lets screen readers announce
 * each move to the next item. Only for phones with the code; anyone else
 * gets the code box and a plain title.
 */
export async function generateMetadata({ params }: PageProps<"/items/[id]">): Promise<Metadata> {
  const { id } = await params;
  const visitor = await getVisitor();
  const item = visitor.canBrowse && ITEM_ID.test(id) ? (await getItemsFile()).items.find((i) => i.id === id) : undefined;
  const label = item && (item.status === "available" || item.status === "claimed") ? itemLabel(item) : "Item";
  return { title: `${label} · Lost & Found` };
}

/** One item: the large photo, its tags and age, and *This is mine* (spec section 1, *Item page*). */
export default async function ItemPage({ params, searchParams }: PageProps<"/items/[id]">) {
  const { id } = await params;
  const query = parseGridQuery(await searchParams);
  const gridHref = `/${gridSearch(query)}`;
  const visitor = await getVisitor();
  if (!visitor.canBrowse) return <CodeGate isOpen={visitor.isOpen} next={`/items/${encodeURIComponent(id)}${gridSearch(query)}`} />;
  if (!ITEM_ID.test(id)) notFound();

  const deps = await getDeps();
  const { settings } = visitor;
  const file = await getItemsFile();
  const item = file.items.find((i) => i.id === id);
  let view;
  if (item) {
    view = itemPageView(item, file, settings, visitor.phoneId, query, deps.now());
  } else {
    const archived = await findArchivedItem(deps, file, id);
    if (!archived) notFound();
    view = archivedItemView(archived.item, settings);
  }

  const contact = (
    <a href={`mailto:${config.contactEmail}`} className="font-bold">
      email the PTA
    </a>
  );

  return (
    <div className="flex flex-col">
      <div className="-mx-4 -mt-6 flex flex-col sm:mx-0 sm:mt-0 sm:gap-3">
        <div className="flex h-14 items-center justify-between gap-3 border-b border-line bg-white px-4 sm:rounded-2xl sm:border">
          <BackLink href={gridHref} />
          {view.kind === "on-list" && view.position && (
            <span className="text-[13px] font-semibold text-muted">
              {view.position.index + 1} of {view.position.total} · {query.sort === "newest" ? "Newest first" : "Oldest first"}
            </span>
          )}
        </div>
        {view.kind === "on-list" ? (
          <PhotoPane src={view.photo} alt={view.card.label} prev={view.position?.prev ?? null} next={view.position?.next ?? null} />
        ) : (
          <div className="flex aspect-square w-full items-center justify-center bg-tile text-sm font-semibold text-muted sm:mx-auto sm:max-w-[560px] sm:rounded-2xl">
            {view.kind === "archived" ? "Photo removed at the clear-out" : "No photo"}
          </div>
        )}
      </div>

      <div className="mx-auto flex w-full max-w-[560px] flex-col gap-[18px] pt-5">
        {view.kind === "removed" ? (
          <Notice>
            This item isn&apos;t on the list any more.
            <Sub>
              If you have a question about it, {contact}. <Link href={gridHref}>See everything in the bin</Link>
            </Sub>
          </Notice>
        ) : (
          <>
            <ItemTags
              key={id}
              itemId={view.kind === "on-list" ? view.card.id : null}
              initial={
                view.kind === "on-list"
                  ? { type: view.card.type, color: view.card.color, hasName: view.card.hasName }
                  : { type: view.type, color: view.color, hasName: view.hasName }
              }
              types={activeTypes(settings)}
              colors={activeColors(settings)}
              palette={Object.fromEntries(settings.colors.map((c) => [c.name, swatchFor(settings, c.name)]))}
            />
            <dl className="grid grid-cols-2 gap-3">
              {view.kind === "on-list" && <Fact label="In the bin" value={view.card.age} />}
              <Fact label="Added" value={view.added} />
            </dl>
          </>
        )}

        {view.kind === "on-list" && view.state === "claimed" && (
          <Notice>
            This item has been claimed
            <Sub>If it&apos;s yours, {contact}.</Sub>
          </Notice>
        )}

        {view.kind === "on-list" && view.state !== "claimed" && (
          <ClaimsProvider
            hasName={Boolean(visitor.device?.name)}
            openClaimIds={openClaimItemIds(file, visitor.phoneId)}
            initialMine={view.claimId ? { [view.card.id]: view.claimId } : {}}
            available={view.state === "available" ? [view.card.id] : []}
            bin={settings.bin_description}
            contactEmail={config.contactEmail}
          >
            <div className="flex flex-col gap-3">
              <ClaimControls target={{ id: view.card.id, label: view.card.label, thumb: view.card.thumb, title: `${view.card.type} · ${view.card.color}` }} size="page" />
              <p className="flex items-center gap-1.5 text-[13px] text-muted">
                <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z" />
                  <circle cx="12" cy="9" r="2.5" />
                </svg>
                In the bin {settings.bin_description}
                {view.state === "mine" && (
                  <>
                    {" · "}
                    <Link href="/mine" className="font-bold">
                      My items
                    </Link>
                  </>
                )}
              </p>
            </div>
          </ClaimsProvider>
        )}

        {view.kind === "archived" && (
          <Notice>
            {view.donatedOn ? (
              `This item was donated on ${view.donatedOn}.`
            ) : (
              <>
                This item has been claimed
                <Sub>If it&apos;s yours, {contact}.</Sub>
              </>
            )}
          </Notice>
        )}
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-xl border border-line bg-white px-3.5 py-3">
      <dt className="text-xs font-bold tracking-[0.04em] text-muted uppercase">{label}</dt>
      <dd className="text-[17px] font-bold">{value}</dd>
    </div>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <div role="status" className="flex flex-col gap-0.5 rounded-xl border border-line bg-white px-4 py-3.5 text-base font-bold">
      {children}
    </div>
  );
}

function Sub({ children }: { children: ReactNode }) {
  return <span className="text-sm font-medium text-muted">{children}</span>;
}
