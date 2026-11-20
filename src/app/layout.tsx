import type { Metadata, Viewport } from "next";
import { Figtree } from "next/font/google";
import Link from "next/link";
import { Brand } from "@/components/Brand";
import { config } from "@/server/config";
import { getVisitor } from "@/server/session";
import "./globals.css";

const figtree = Figtree({ variable: "--font-figtree", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Lost & Found · Miraloma PTA",
  description: "Look through Miraloma's lost-and-found bin from home, and claim what's yours.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#ffffff" };

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const visitor = await getVisitor();
  return (
    <html lang="en" className={`${figtree.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">
        <header className="border-b border-line bg-white">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
            <Brand />
            {visitor.isAdmin && (
              <Link href="/admin/settings" className="admin-badge no-underline hover:text-ink">
                Admin
              </Link>
            )}
          </div>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-6 pb-10">{children}</main>
        <footer className="flex flex-col items-center gap-1.5 border-t border-line px-4 py-6 text-center text-[13px] text-muted">
          <span>
            Questions or concerns? <a href={`mailto:${config.contactEmail}`}>{config.contactEmail}</a>
          </span>
          {visitor.isAdmin ? (
            <span>
              This phone is an admin{visitor.device?.name ? `: ${visitor.device.name}` : ""} · <Link href="/admin/settings">Settings</Link>
            </span>
          ) : (
            <span>
              PTA admin? <Link href="/admin-code">Enter the admin code</Link>
            </span>
          )}
        </footer>
      </body>
    </html>
  );
}
