"use client"; // Error boundaries must be Client Components

import Link from "next/link";
import { useEffect } from "react";

/**
 * Shown when a page fails. In production Next.js hides the real message (it
 * may hold server details), so this only offers a retry and a way home.
 */
export default function Error({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div role="alert" className="mx-auto flex max-w-md flex-col gap-4 py-6">
      <h1 className="text-[26px] leading-tight font-extrabold">Something went wrong</h1>
      <p className="text-base leading-relaxed text-body">That didn&apos;t work, probably for a moment only. Try again, or start over from the home page.</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primary" onClick={() => retry()}>
          Try again
        </button>
        <Link href="/" className="btn-secondary">
          Home
        </Link>
      </div>
    </div>
  );
}
