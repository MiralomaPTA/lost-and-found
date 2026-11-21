"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useUploads } from "@/components/add/upload-store";

const plural = (n: number, one: string, many: string) => (n === 1 ? one : `${n} ${many}`);

/**
 * Bulk add's uploads carry on after the screen is left. This line above the
 * bottom bar says so, and when they're done offers to show them (the page
 * otherwise keeps what it loaded, so cards don't move under someone's thumb).
 */
export function UploadsBar() {
  const entries = useUploads();
  const router = useRouter();
  const active = entries.filter((entry) => entry.state === "waiting" || entry.state === "uploading").length;
  const failed = entries.filter((entry) => entry.state === "failed").length;
  const [lastActive, setLastActive] = useState(active);
  const [finished, setFinished] = useState(false);
  if (active !== lastActive) {
    setLastActive(active);
    if (active === 0 && lastActive > 0) setFinished(true);
  }

  if (!active && !failed && !finished) return null;
  return (
    <div role="status" className="flex items-center justify-between gap-3 border-t border-line bg-brand-soft px-4 py-2 text-[13px] font-semibold text-brand-dark">
      {active > 0 ? (
        <span>Uploading {plural(active, "a photo", "photos")}…</span>
      ) : failed > 0 ? (
        <>
          <span>{plural(failed, "A photo", "photos")} didn&apos;t upload.</span>
          <Link href="/add/bulk" className="font-bold">
            Open bulk add
          </Link>
        </>
      ) : (
        <>
          <span>Your photos are saved.</span>
          <button
            type="button"
            className="cursor-pointer font-bold text-brand"
            onClick={() => {
              setFinished(false);
              router.refresh();
            }}
          >
            Show them
          </button>
        </>
      )}
    </div>
  );
}
