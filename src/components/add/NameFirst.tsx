import { NameForm } from "@/components/NameForm";

/** The first add from a phone asks for the name the PTA will see, as the first claim does. */
export function NameFirst({ next }: { next: string }) {
  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h1 className="text-[26px] leading-tight font-extrabold">What name should the PTA see?</h1>
        <p className="text-base leading-relaxed text-muted">
          The PTA sees it next to anything you add or claim, in case of a mix-up. Other families don&apos;t. We only ask once.
        </p>
      </div>
      <NameForm next={next} hint="You can change it later in My items." />
    </div>
  );
}
