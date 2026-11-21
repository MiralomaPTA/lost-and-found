import type { Metadata } from "next";
import Link from "next/link";
import { RestoreButton } from "@/components/admin/RestoreButton";
import { UndoClaimForm } from "@/components/admin/UndoClaimForm";
import { phoneNames, recentClaims, reportedMissing, undoerIds, type AdminClaimRow } from "@/server/admin-views";
import { getDeps } from "@/server/deps";
import { loadItems, sweepReplacedPhotos } from "@/server/items";
import { requireAdmin } from "@/server/session";
import { after } from "next/server";

export const metadata: Metadata = { title: "Claims · Admin · Lost & Found" };

/** Admin *Claims* (spec section 6): reported missing at the top, with *Restore*; then recent claims, with *Undo claim*. */
export default async function AdminClaimsPage() {
  await requireAdmin();
  const deps = await getDeps();
  const file = await loadItems(deps, { fresh: true });
  const names = await phoneNames(deps, undoerIds(file.items));
  // Old photos whose Undo time is over go now, not whenever the list is next saved.
  after(() => sweepReplacedPhotos(deps).catch((error) => console.error("Couldn't sweep replaced photos", error)));
  const now = deps.now();
  const missing = reportedMissing(file, names, now);
  const claims = recentClaims(file, names, now);

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      <h1 tabIndex={-1} className="sr-only">
        Claims
      </h1>
      <section aria-labelledby="h-missing" className="flex flex-col gap-2">
        <div className="flex flex-col gap-0.5">
          <h2 id="h-missing" className="text-[17px] font-extrabold">
            Reported missing <span className="font-semibold text-muted">· {missing.length}</span>
          </h2>
          <span className="text-[13px] text-muted">Families tapped “It wasn&apos;t there”. Restore it if you find it in the bin.</span>
        </div>
        {missing.length === 0 ? (
          <p className="card px-4 py-3 text-sm text-muted">Nothing reported missing.</p>
        ) : (
          <ul className="card flex flex-col divide-y divide-rule">
            {missing.map((row) => (
              <li key={row.claimId} className="flex items-center gap-3 p-3">
                <Thumb row={row} />
                <Who row={row} when={`Reported ${row.reported}`} />
                <RestoreButton itemId={row.itemId} label={row.label} className="flex-none" />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="h-recent" className="flex flex-col gap-2">
        <h2 id="h-recent" className="text-[17px] font-extrabold">
          Recent claims
        </h2>
        {claims.length === 0 ? (
          <p className="card px-4 py-3 text-sm text-muted">No claims since the last clear-out.</p>
        ) : (
          <ul className="card flex flex-col divide-y divide-rule">
            {claims.map((row) => (
              <li key={row.claimId} className="flex flex-col gap-2 p-3">
                <div className="flex items-center gap-3">
                  <Thumb row={row} />
                  <Who row={row} when={row.when} />
                </div>
                {row.state === "open" ? (
                  <UndoClaimForm itemId={row.itemId} claimId={row.claimId} label={row.label} />
                ) : (
                  <span className="text-[13px] text-muted">
                    {row.outcome}
                    {row.note ? ` · “${row.note}”` : ""}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Thumb({ row }: { row: AdminClaimRow }) {
  return (
    <Link href={row.href} prefetch={false} aria-label={`${row.itemId}, ${row.label}`} className="relative h-14 w-14 flex-none overflow-hidden rounded-[10px] bg-tile">
      {/* eslint-disable-next-line @next/next/no-img-element -- thumbnails are already 400 px */}
      <img src={row.thumb} alt="" loading="lazy" className="absolute inset-[8%] h-[84%] w-[84%] object-contain" />
    </Link>
  );
}

function Who({ row, when }: { row: AdminClaimRow; when: string }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-px">
      <span className="text-sm font-bold">
        {row.title} <span className="font-semibold text-muted">{row.itemId}</span>
      </span>
      <span className="text-sm">{row.name}</span>
      <span className="text-xs text-muted">
        Phone {row.phone} · {when}
      </span>
    </div>
  );
}
