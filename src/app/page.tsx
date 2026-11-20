import Link from "next/link";
import { CodeForm } from "@/components/CodeForm";
import { getVisitor } from "@/server/session";

const STEPS = [
  <>Scroll the photos</>,
  <>
    Tap <strong>This is mine</strong>
  </>,
  <>Pick it up from the bin</>,
];

export default async function Home() {
  const visitor = await getVisitor();
  if (!visitor.canBrowse) return <CodeGate isOpen={visitor.isOpen} />;

  // The grid arrives in the next pull request.
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-[28px] leading-tight font-extrabold">You&apos;re in</h1>
      <p className="max-w-prose text-base leading-relaxed text-body">
        Photos of everything in the lost-and-found bin will show up here soon. This phone remembers the code, so you won&apos;t be asked again.
      </p>
      {visitor.isAdmin && (
        <p className="text-base">
          <Link href="/admin/settings">Admin settings</Link>
        </p>
      )}
    </div>
  );
}

/** The first-visit screen: the school code (or the admin code) and nothing else. */
function CodeGate({ isOpen }: { isOpen: boolean }) {
  return (
    <div className="mx-auto flex max-w-md flex-col gap-7">
      <div className="flex flex-col gap-2.5">
        <h1 className="text-[30px] leading-[1.12] font-extrabold tracking-tight">Look through the lost-and-found bin from home</h1>
        <p className="text-base leading-relaxed text-muted">
          Everything that lands in the bin gets photographed and posted here. If something is yours, tap it and pick it up. Found something? Add it.
        </p>
      </div>
      {!isOpen && (
        <p role="status" className="notice bg-warn-soft text-warn">
          The lost and found isn&apos;t open yet. The PTA newsletter will say when it is.
        </p>
      )}
      <ol className="flex flex-col gap-3">
        {STEPS.map((step, i) => (
          <li key={i} className="flex items-center gap-3 text-[15px] font-semibold">
            <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-brand-soft text-sm font-extrabold text-brand-dark">{i + 1}</span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
      <CodeForm mode="school" />
      <p className="text-center text-[13px] text-muted">No account or sign-in. This phone remembers the code.</p>
    </div>
  );
}
