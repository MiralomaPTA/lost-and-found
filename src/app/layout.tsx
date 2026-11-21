import type { Metadata, Viewport } from "next";
import { Figtree } from "next/font/google";
import Link from "next/link";
import { Brand } from "@/components/Brand";
import { readTotals, TotalsLine } from "@/components/Totals";
import { dayLabel } from "@/lib/dates";
import { config } from "@/server/config";
import { getDeps } from "@/server/deps";
import { getItemsFile, getVisitor } from "@/server/session";
import { nextClearOutFor } from "@/server/views";
import "./globals.css";

const figtree = Figtree({ variable: "--font-figtree", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Lost & Found · Miraloma PTA",
  description: "Look through Miraloma's lost-and-found bin from home, and claim what's yours.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#ffffff" };

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const visitor = await getVisitor();
  const clearOut = visitor.canBrowse ? nextClearOutFor(visitor.settings, await getItemsFile(), (await getDeps()).now()) : null;
  // For every phone once the lost and found is open, the code screen included.
  const totals = visitor.isOpen ? await readTotals() : null;
  return (
    <html lang="en" className={`${figtree.variable} h-full antialiased`}>
      {/* Pages with the bottom bar get room for it, so the footer isn't hidden underneath. */}
      <body className="flex min-h-full flex-col font-sans has-[[data-bottom-nav]]:pb-[calc(4rem+env(safe-area-inset-bottom))]">
        <header className="border-b border-line bg-white">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
            <Brand />
            <div className="flex items-center gap-3">
              {visitor.isAdmin && (
                <Link href="/admin/items" className="admin-badge no-underline hover:text-ink">
                  Admin
                </Link>
              )}
              {clearOut && (
                <div className="flex flex-col items-end">
                  <span className="text-[11px] font-bold tracking-[0.04em] text-muted uppercase">Next clear-out</span>
                  <span className="text-sm font-bold">{clearOut.overdue ? "Any day now" : dayLabel(clearOut.date)}</span>
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-6 pb-10">{children}</main>
        <footer className="flex flex-col items-center gap-1.5 border-t border-line px-4 py-6 text-center text-[13px] text-muted">
          {totals && <TotalsLine totals={totals} />}
          <span>
            Questions or concerns? <a href={`mailto:${config.contactEmail}`}>{config.contactEmail}</a>
          </span>
          <span>
            <Link href="/help">How it works</Link>
          </span>
          {visitor.isAdmin ? (
            <span>
              This phone is an admin{visitor.device?.name ? `: ${visitor.device.name}` : ""} · <Link href="/admin/items">Admin</Link>
            </span>
          ) : (
            <span>
              <Link href="/admin-code">Enter a new code</Link>
            </span>
          )}
          <span>
            Made with{" "}
            {/* Apple's emoji font leaves a space's width of blank to the right of the heart; a 1em box trims it. */}
            <span role="img" aria-label="love" className="inline-block w-[1em] text-left">
              ❤️
            </span>{" "}
            by <a href="https://www.miralomasf.com/pta">the Miraloma PTA</a>
          </span>
        </footer>
      </body>
    </html>
  );
}
