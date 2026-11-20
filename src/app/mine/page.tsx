import type { Metadata } from "next";
import Link from "next/link";
import { BottomNav } from "@/components/BottomNav";
import { CodeGate } from "@/components/CodeGate";
import { MyClaimsList } from "@/components/mine/MyClaimsList";
import { NameChanger } from "@/components/mine/NameChanger";
import { dayLabel } from "@/lib/dates";
import { lastArchive } from "@/server/archives";
import { config } from "@/server/config";
import { getDeps } from "@/server/deps";
import { loadItems } from "@/server/items";
import { getVisitor } from "@/server/session";
import { myItemsView, nextClearOutFor } from "@/server/views";

export const metadata: Metadata = { title: "My items · Lost & Found" };

/** The claims made from this phone, and the name admins see (spec section 3). */
export default async function MinePage() {
  const visitor = await getVisitor();
  if (!visitor.canBrowse || !visitor.phoneId) return <CodeGate isOpen={visitor.isOpen} next="/mine" />;

  const deps = await getDeps();
  const now = deps.now();
  // Fresh: this page has to show the phone's own change right after it.
  const file = await loadItems(deps, { fresh: true });
  const archive = await lastArchive(deps, file);
  const view = myItemsView(file, archive, visitor.phoneId, now);
  const open = view.current.filter((row) => row.state === "claimed").length;
  const clearOut = nextClearOutFor(visitor.settings, file, now);
  const name = visitor.device?.name ?? null;

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-3">
      <div className="-mx-4 -mt-6 flex flex-col gap-3 border-b border-line bg-white px-4 pt-4 pb-3.5 sm:mx-0 sm:mt-0 sm:rounded-2xl sm:border">
        <h1 className="text-[26px] leading-tight font-extrabold">My items</h1>
        <NameChanger key={name ?? ""} name={name} />
      </div>

      {open > 0 && clearOut && (
        <p className="notice bg-warn-soft text-warn">
          Pick up your {open === 1 ? "claimed item" : `${open} claimed items`}{" "}
          {clearOut.overdue ? `soon: the ${dayLabel(clearOut.date)} clear-out is overdue` : `before ${dayLabel(clearOut.date)}`}.
        </p>
      )}

      <MyClaimsList rows={view.current} contactEmail={config.contactEmail} />

      {view.current.length === 0 && (
        <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
          <p className="text-base font-bold">Nothing here yet</p>
          <p className="max-w-sm text-sm text-muted">
            When you tap <strong>This is mine</strong> on something, it shows up here until you pick it up.
          </p>
          <Link href="/" className="btn-secondary btn-small mt-2">
            See everything in the bin
          </Link>
        </div>
      )}

      {view.pickedUp.length > 0 && (
        <section aria-labelledby="h-picked-up" className="flex flex-col gap-2 pt-2">
          <h2 id="h-picked-up" className="text-[13px] font-bold tracking-[0.04em] text-muted uppercase">
            Before the {view.clearOutDate} clear-out
          </h2>
          <MyClaimsList rows={view.pickedUp} contactEmail={config.contactEmail} />
        </section>
      )}

      <p className="hint text-center">My items is kept on this phone. Claims from another phone or browser show up there instead.</p>
      <BottomNav openClaims={open} />
    </div>
  );
}
