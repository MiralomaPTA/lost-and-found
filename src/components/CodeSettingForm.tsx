"use client";

import { useActionState, useState } from "react";
import { changeAdminCodeAction, changeSchoolCodeAction } from "@/app/actions/codes";
import { SubmitButton } from "@/components/SubmitButton";
import { NO_STATE } from "@/lib/form-state";

/** One code on the Settings page: the current value and a way to change it. */
export function CodeSettingForm({ which, current }: { which: "school" | "admin"; current: string | null }) {
  const [state, run, pending] = useActionState(which === "school" ? changeSchoolCodeAction : changeAdminCodeAction, NO_STATE);
  const [shown, setShown] = useState(which === "school");
  const id = `${which}-code`;
  const messageId = `${id}-message`;
  // After a refused change, show what was typed so it can be fixed; otherwise the saved code.
  const value = state.error ? state.values?.code : (current ?? "");
  return (
    <form action={run} className="flex flex-col gap-2">
      <label htmlFor={id} className="sr-only">
        {which === "school" ? "School code" : "Admin code"}
      </label>
      <div className="flex gap-2">
        <input
          key={`${current ?? ""}-${state.attempt ?? 0}`}
          id={id}
          name="code"
          type={shown ? "text" : "password"}
          required
          defaultValue={value}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder={which === "school" ? "A short word" : "Three random words"}
          className="field min-w-0 flex-1 font-bold"
          aria-describedby={state.error || state.saved ? messageId : undefined}
          aria-invalid={state.error ? true : undefined}
        />
        {which === "admin" && (
          <button type="button" className="btn-secondary w-12 flex-none px-0" aria-label="Show the admin code" aria-pressed={shown} onClick={() => setShown(!shown)}>
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </button>
        )}
        <SubmitButton pending={pending} className="btn-primary flex-none">
          {pending ? "Saving…" : current ? "Change" : "Set"}
        </SubmitButton>
      </div>
      {state.error && (
        <p id={messageId} key={`e${state.attempt}`} role="alert" className="text-sm font-semibold text-bad">
          {state.error}
        </p>
      )}
      {state.saved && (
        <p id={messageId} key={`s${state.attempt}`} role="status" className="text-sm font-semibold text-ok">
          {state.saved}
        </p>
      )}
    </form>
  );
}
