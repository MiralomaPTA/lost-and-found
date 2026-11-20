"use client";

import { useActionState, useState } from "react";
import { changeAdminCodeAction, changeSchoolCodeAction } from "@/app/actions/codes";
import { NO_STATE } from "@/lib/form-state";

/** One code on the Settings page: the current value and a way to change it. */
export function CodeSettingForm({ which, current }: { which: "school" | "admin"; current: string | null }) {
  const [state, run, pending] = useActionState(which === "school" ? changeSchoolCodeAction : changeAdminCodeAction, NO_STATE);
  const [shown, setShown] = useState(which === "school");
  const id = `${which}-code`;
  return (
    <form action={run} className="flex flex-col gap-2">
      <label htmlFor={id} className="sr-only">
        {which === "school" ? "School code" : "Admin code"}
      </label>
      <div className="flex gap-2">
        <input
          key={current ?? ""}
          id={id}
          name="code"
          type={shown ? "text" : "password"}
          required
          defaultValue={current ?? ""}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder={which === "school" ? "A short word" : "Three random words"}
          className="field min-w-0 flex-1 font-bold"
        />
        {which === "admin" && (
          <button type="button" className="btn-secondary w-12 flex-none px-0" aria-label={shown ? "Hide the admin code" : "Show the admin code"} aria-pressed={shown} onClick={() => setShown(!shown)}>
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </button>
        )}
        <button type="submit" className="btn-primary flex-none" disabled={pending}>
          {pending ? "Saving…" : current ? "Change" : "Set"}
        </button>
      </div>
      {state.error && (
        <p key={`e${state.attempt}`} role="alert" className="text-sm font-semibold text-bad">
          {state.error}
        </p>
      )}
      {state.saved && (
        <p key={`s${state.attempt}`} role="status" className="text-sm font-semibold text-ok">
          {state.saved}
        </p>
      )}
    </form>
  );
}
