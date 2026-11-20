import Link from "next/link";

/** The app's mark and name, as in the mockups' header. */
export function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5 text-ink no-underline hover:text-ink">
      <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-brand text-white">
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 8l9-5 9 5v8l-9 5-9-5z" />
          <path d="M3 8l9 5 9-5M12 13v8" />
        </svg>
      </span>
      <span className="flex flex-col">
        <span className="text-lg leading-tight font-extrabold">Lost &amp; Found</span>
        <span className="text-xs font-medium text-muted">Miraloma PTA</span>
      </span>
    </Link>
  );
}
