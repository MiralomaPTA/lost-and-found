"use client";

import { useActionState } from "react";
import { enterCodeAction } from "@/app/actions/codes";
import { SubmitButton } from "@/components/SubmitButton";
import { NO_STATE } from "@/lib/form-state";

/**
 * The code box. `school` is the first-visit screen, which also takes the
 * admin code; `admin` is the admin code page, which can ask for a name too.
 */
export function CodeForm({ mode, askName = false, next }: { mode: "school" | "admin"; askName?: boolean; next?: string }) {
  const [state, run, pending] = useActionState(enterCodeAction, NO_STATE);
  const admin = mode === "admin";
  const describedBy = (hint: string) => (state.error ? `${hint} code-error` : hint);
  return (
    <form action={run} className="card flex flex-col gap-4 p-5">
      {admin && <input type="hidden" name="want" value="admin" />}
      {next && <input type="hidden" name="next" value={next} />}
      <div className="flex flex-col gap-2">
        <label htmlFor="code" className="label">
          {admin ? "Admin code" : "School code"}
        </label>
        {/* Keyed by attempt so the typed value comes back after React resets the form. */}
        <input
          key={`code-${state.attempt ?? 0}`}
          id="code"
          name="code"
          type={admin ? "password" : "text"}
          required
          defaultValue={state.values?.code}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder={admin ? "Three words" : "Enter the code"}
          className="field text-lg font-semibold"
          aria-describedby={describedBy("code-hint")}
          aria-invalid={state.error ? true : undefined}
        />
        <p id="code-hint" className="hint">
          {admin ? "Only PTA admins have this code. It isn't the school code." : "It's in the PTA newsletter and on the sign at the bin. PTA admins can type the admin code here instead."}
        </p>
      </div>
      {askName && (
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
            defaultValue={state.values?.name}
            autoComplete="name"
            placeholder="e.g. Dana K."
            className="field"
            aria-describedby="name-hint"
          />
          <p id="name-hint" className="hint">
            This phone doesn&apos;t have a name yet. Other admins see it next to what you do.
          </p>
        </div>
      )}
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
