"use client";

import { useState } from "react";
import { NameForm } from "@/components/NameForm";

/** "PTA admins see your name as …", with *Change*. */
export function NameChanger({ name }: { name: string | null }) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <div className="flex flex-col gap-2">
        <NameForm next="/mine" defaultValue={name ?? undefined} hint="Admins see it next to your claims and anything you add. Other families don't." />
        <button type="button" onClick={() => setEditing(false)} className="btn-secondary btn-small self-center">
          Cancel
        </button>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-page py-2.5 pr-2 pl-3.5">
      <div className="flex flex-col gap-px">
        <span className="text-xs font-semibold text-muted">{name ? "PTA admins see your name as" : "No name yet"}</span>
        <span className="text-base font-bold">{name ?? "You'll be asked for one with your first claim"}</span>
      </div>
      <button type="button" onClick={() => setEditing(true)} className="h-11 flex-none cursor-pointer rounded-[10px] px-3.5 text-[15px] font-bold text-brand">
        {name ? "Change" : "Add"}
      </button>
    </div>
  );
}
