import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-md flex-col gap-3 py-8 text-center">
      <h1 className="text-[26px] leading-tight font-extrabold">Not found</h1>
      <p className="text-base text-muted">There&apos;s nothing at this address. It may have been an item from before a clear-out.</p>
      <p>
        <Link href="/" className="btn-primary">
          See everything in the bin
        </Link>
      </p>
    </div>
  );
}
