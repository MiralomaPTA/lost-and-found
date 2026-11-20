"use client";

import { useActionState } from "react";
import { saveNameAction } from "@/app/actions/codes";
import { NO_STATE } from "@/lib/form-state";

/** Asks for the name admins see. Used once per phone; it can be changed later in My items. */
export function NameForm({ next, hint, defaultValue }: { next?: string; hint: string; defaultValue?: string }) {
  const [state, run, pending] = useActionState(saveNameAction, NO_STATE);
  return (
    <form action={run} className="card flex flex-col gap-4 p-5">
      {next && <input type="hidden" name="next" value={next} />}
      <div className="flex flex-col gap-2">
        <label htmlFor="name" className="label">
          Your name
        </label>
        <input
          id="name"
          name="name"
          required
          maxLength={60}
          autoComplete="name"
          defaultValue={defaultValue}
          placeholder="e.g. Lee family, Rm 12"
          className="field"
          aria-describedby="name-hint"
        />
        <p id="name-hint" className="hint">
          {hint}
        </p>
      </div>
      {state.error && (
        <p key={state.attempt} role="alert" className="text-sm font-semibold text-bad">
          {state.error}
        </p>
      )}
      <button type="submit" className="btn-primary" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
