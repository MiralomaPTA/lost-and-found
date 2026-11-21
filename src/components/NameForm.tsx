"use client";

import { useActionState } from "react";
import { saveNameAction } from "@/app/actions/codes";
import { SubmitButton } from "@/components/SubmitButton";
import { NO_STATE } from "@/lib/form-state";

/** Asks for the name the PTA sees. Used once per phone; it can be changed later in My items. */
export function NameForm({ next, hint, defaultValue, placeholder = "e.g. Lee family, Rm 12" }: { next?: string; hint: string; defaultValue?: string; placeholder?: string }) {
  const [state, run, pending] = useActionState(saveNameAction, NO_STATE);
  return (
    <form action={run} className="card flex flex-col gap-4 p-5">
      {next && <input type="hidden" name="next" value={next} />}
      <div className="flex flex-col gap-2">
        <label htmlFor="name" className="label">
          Your name
        </label>
        <input
          key={`name-${state.attempt ?? 0}`}
          id="name"
          name="name"
          required
          maxLength={60}
          autoComplete="name"
          defaultValue={state.values?.name ?? defaultValue}
          placeholder={placeholder}
          className="field"
          aria-describedby={state.error ? "name-hint name-error" : "name-hint"}
          aria-invalid={state.error ? true : undefined}
        />
        <p id="name-hint" className="hint">
          {hint}
        </p>
      </div>
      {state.error && (
        <p id="name-error" key={state.attempt} role="alert" className="text-sm font-semibold text-bad">
          {state.error}
        </p>
      )}
      <SubmitButton pending={pending} className="btn-primary">
        {pending ? "Saving…" : "Save"}
      </SubmitButton>
    </form>
  );
}
