import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { BottomNav } from "@/components/BottomNav";
import { CodeGate } from "@/components/CodeGate";
import { config } from "@/server/config";
import { getItemsFile, getVisitor } from "@/server/session";
import { openClaimCount } from "@/server/views";

export const metadata: Metadata = { title: "Add an item · Lost & Found" };

/** *Add* in the bottom bar: the two ways in (spec section 4). */
export default async function AddPage() {
  const visitor = await getVisitor();
  if (!visitor.canBrowse) return <CodeGate isOpen={visitor.isOpen} next="/add" />;
  const openClaims = openClaimCount(await getItemsFile(), visitor.phoneId);

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-3">
      <div className="-mx-4 -mt-6 border-b border-line bg-white px-4 pt-5 pb-4 sm:mx-0 sm:mt-0 sm:rounded-2xl sm:border">
        <h1 className="text-[26px] leading-tight font-extrabold">Add an item</h1>
      </div>

      <Choice
        href="/add/bulk"
        title="Bulk add"
        text="At the bin with a pile of things? Photograph them one after another: shutter, then color."
        note="Best at the photo spot, on the plain backdrop"
        dark
        icon={
          <>
            <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
            <circle cx="12" cy="13" r="3.5" />
          </>
        }
      />
      <Choice
        href="/add/photo"
        title="Add one from a photo"
        text="Already took a photo of something you handed in? Pick it, crop it, tag it."
        icon={
          <>
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <circle cx="9" cy="10" r="1.6" />
            <path d="M21 16l-5-5-9 8" />
          </>
        }
      />

      <section aria-labelledby="h-tips" className="card flex flex-col gap-2 p-4">
        <h2 id="h-tips" className="text-[15px] font-extrabold">
          Before you start
        </h2>
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm leading-relaxed text-body">
          <li>Turn name labels away from the camera, or crop them out.</li>
          <li>Phones, keys, wallets, glasses and medication go to the office, not here.</li>
          <li>
            Made a mistake? In bulk add you can undo it until you leave. After adding one from a photo, you can undo it until you pick the next photo. After that, anyone can fix the tags. To have it removed, email{" "}
            <a href={`mailto:${config.contactEmail}`}>{config.contactEmail}</a>.
          </li>
        </ul>
      </section>
      <BottomNav openClaims={openClaims} />
    </div>
  );
}

function Choice({ href, title, text, note, icon, dark = false }: { href: string; title: string; text: string; note?: string; icon: ReactNode; dark?: boolean }) {
  return (
    <Link href={href} className="card flex items-center gap-3.5 py-[18px] pr-3 pl-4 text-ink no-underline hover:border-field hover:text-ink">
      <span className={`flex h-[52px] w-[52px] flex-none items-center justify-center rounded-[14px] ${dark ? "bg-ink text-white" : "bg-brand-soft text-brand-dark"}`}>
        <svg aria-hidden="true" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {icon}
        </svg>
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-lg font-extrabold">{title}</span>
        <span className="text-sm leading-snug text-body">{text}</span>
        {note && <span className="text-xs font-bold text-brand-dark">{note}</span>}
      </span>
      <svg aria-hidden="true" className="flex-none text-muted" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 5l7 7-7 7" />
      </svg>
    </Link>
  );
}
