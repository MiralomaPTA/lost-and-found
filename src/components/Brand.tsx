import Image from "next/image";
import Link from "next/link";
import dragon from "@/images/dragon.png";

/** The Miraloma dragon (the same as the reimbursements app's) and the app's name. */
export function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5 text-ink no-underline hover:text-ink">
      {/* Decorative: the name next to it says what the link is. Sized for 3x screens and served as is. */}
      <Image src={dragon} alt="" width={40} height={40} priority unoptimized className="h-10 w-10" />
      <span className="flex flex-col">
        <span className="text-lg leading-tight font-extrabold">Lost &amp; Found</span>
        <span className="text-xs font-medium text-muted">Miraloma PTA</span>
      </span>
    </Link>
  );
}
