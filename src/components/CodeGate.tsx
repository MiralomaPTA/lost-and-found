import { CodeForm } from "@/components/CodeForm";
import { CurrentTotalsTiles } from "@/components/Totals";

const STEPS = [
  <>Scroll the photos</>,
  <>
    Tap <strong>This is mine</strong>
  </>,
  <>Pick it up from the bin</>,
];

/**
 * The code screen: the school code and nothing else. Pages that need the code
 * show it in their place, and send the phone back to `next` once it's in;
 * `/code` shows it to any phone, for *Enter a new code* in the footer. The box
 * also takes the admin code, without saying so.
 */
export function CodeGate({ isOpen, next }: { isOpen: boolean; next?: string }) {
  return (
    <div className="mx-auto flex max-w-md flex-col gap-7">
      <div className="flex flex-col gap-2.5">
        <h1 className="text-[30px] leading-[1.12] font-extrabold tracking-tight">Look through the lost-and-found bin from home</h1>
        <p className="text-base leading-relaxed text-muted">
          Everything that lands in the bin gets photographed and posted here. If something is yours, tap it and pick it up. Found something? Add it.
        </p>
      </div>
      {isOpen && <CurrentTotalsTiles />}
      {!isOpen && (
        <p role="status" className="notice bg-warn-soft text-warn">
          The lost and found isn&apos;t open yet. The Dragon Digest will say when it is.
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
      <CodeForm next={next} />
    </div>
  );
}
