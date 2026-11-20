import type { Metadata, Viewport } from "next";
import { Figtree } from "next/font/google";
import { config } from "@/server/config";
import "./globals.css";

const figtree = Figtree({ variable: "--font-figtree", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Lost & Found · Miraloma PTA",
  description: "Look through Miraloma's lost-and-found bin from home, and claim what's yours.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#ffffff" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${figtree.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-6 pb-10">{children}</main>
        <footer className="border-t border-line px-4 py-6 text-center text-[13px] text-muted">
          Questions or concerns? <a href={`mailto:${config.contactEmail}`}>{config.contactEmail}</a>
        </footer>
      </body>
    </html>
  );
}
