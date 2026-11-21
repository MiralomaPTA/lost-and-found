"use client";

import { useActionState, useState } from "react";
import { saveBinDescriptionAction } from "@/app/actions/settings";
import { SubmitButton } from "@/components/SubmitButton";
import { NO_STATE } from "@/lib/form-state";

/** Where the bin is: it finishes "Pick it up from the lost-and-found bin …", which families see after claiming. */
export function BinDescriptionForm({ current }: { current: string }) {
  const [state, run, pending] = useActionState(saveBinDescriptionAction, NO_STATE);
  // Controlled, so saving doesn't reset or remount it (and keyboard focus stays put).
  const [typed, setTyped] = useState(current);
  const [saved, setSaved] = useState(current);
  if (current !== saved) {
    setSaved(current);
    setTyped(current);
  }
  const preview = typed.trim().replace(/[.\s]+$/, "") || "…";
  return (
    <form action={run} className="flex flex-col gap-2.5">
      <label htmlFor="bin" className="text-[13px] font-semibold text-muted">
        Pick it up from the lost-and-found bin…
      </label>
      <div className="flex gap-2">
        <input
          id="bin"
          name="bin"
          type="text"
          required
          maxLength={120}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          placeholder="by the main office"
          className="field min-w-0 flex-1"
          aria-describedby={state.error ? "bin-preview bin-error" : "bin-preview"}
          aria-invalid={state.error ? true : undefined}
        />
        <SubmitButton pending={pending} className="btn-primary flex-none">
          {pending ? "Saving…" : "Save"}
        </SubmitButton>
      </div>
      <div id="bin-preview" className="flex flex-col gap-0.5 rounded-xl bg-page px-3.5 py-2.5">
        <span className="text-[11px] font-bold tracking-[0.04em] text-muted uppercase">People see after claiming</span>
        <span className="text-sm">Pick it up from the lost-and-found bin {preview}.</span>
      </div>
      {/* Always on the page, so a screen reader hears "Saved." when it appears. */}
      <p id="bin-saved" role="status" className="text-sm font-semibold text-ok empty:hidden">
        {state.saved && !pending ? state.saved : ""}
      </p>
      {state.error && (
        <p id="bin-error" key={`e${state.attempt}`} role="alert" className="text-sm font-semibold text-bad">
          {state.error}
        </p>
      )}
    </form>
  );
}
