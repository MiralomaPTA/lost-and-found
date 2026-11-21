"use client";

import { useActionState } from "react";
import { enterCodeAction } from "@/app/actions/codes";
import { SubmitButton } from "@/components/SubmitButton";
import { NO_STATE } from "@/lib/form-state";

/** The one code box, on the code screen. It takes either code, and only ever talks about the school code. */
export function CodeForm({ next }: { next?: string }) {
  const [state, run, pending] = useActionState(enterCodeAction, NO_STATE);
  return (
    <form action={run} className="card flex flex-col gap-4 p-5">
      {next && <input type="hidden" name="next" value={next} />}
      <div className="flex flex-col gap-2">
        <label htmlFor="code" className="label">
          School code
        </label>
        {/* Keyed by attempt so the typed value comes back after React resets the form. */}
        <input
          key={`code-${state.attempt ?? 0}`}
          id="code"
          name="code"
          type="text"
          required
          defaultValue={state.values?.code}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="Enter the code"
          className="field text-lg font-semibold"
          aria-describedby={state.error ? "code-hint code-error" : "code-hint"}
          aria-invalid={state.error ? true : undefined}
        />
        <p id="code-hint" className="hint">
          It&apos;s in the Dragon Digest and on the sign at the bin.
        </p>
      </div>
      {state.error && (
        <p id="code-error" key={state.attempt} role="alert" className="text-sm font-semibold text-bad">
          {state.error}
        </p>
      )}
      <SubmitButton pending={pending} className="btn-primary">
        {pending ? "Checking…" : "Continue"}
      </SubmitButton>
    </form>
  );
}
