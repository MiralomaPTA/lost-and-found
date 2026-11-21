"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { addTagAction, editTagAction, reorderTagsAction, type ListAnswer } from "@/app/actions/settings";
import { Sheet } from "@/components/admin/Sheet";
import { useUndo } from "@/components/admin/UndoProvider";
import { Swatch } from "@/components/Swatch";
import { swatchOf } from "@/lib/swatch";

export interface TagEntry {
  name: string;
  active: boolean;
  /** Colors only: the stored swatch, "#2F6FD6" or "multicolor". */
  swatch?: string;
  /** Items on the list (still available or claimed) with it. */
  inUse: number;
}

type Kind = "types" | "colors";

const WORDS = {
  types: { title: "Types", one: "type", tagged: "a" },
  colors: { title: "Colors", one: "color", tagged: "in" },
} as const;

const OFFLINE: ListAnswer = { ok: false, message: "Couldn't reach the lost and found. Try again." };

const PencilIcon = () => (
  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 20h4L19 9l-4-4L4 16v4z" />
  </svg>
);

/**
 * Types or colors on Settings: tap one to rename, re-color or hide it; *Add*
 * puts a new one at the end; *Reorder* sets the order the add screens and
 * filters use. A hidden one isn't offered any more, but items keep it.
 */
export function TagListEditor({ kind, entries }: { kind: Kind; entries: TagEntry[] }) {
  const { notify } = useUndo();
  const words = WORDS[kind];
  const [editing, setEditing] = useState<TagEntry | "new" | null>(null);
  const [reordering, setReordering] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);

  const done = (message: string) => {
    setEditing(null);
    setReordering(false);
    notify(message);
    heading.current?.focus();
  };

  return (
    <section aria-labelledby={`h-${kind}`} className="card flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 ref={heading} id={`h-${kind}`} tabIndex={-1} className="text-[17px] font-extrabold outline-none">
          {words.title}
        </h2>
        <button type="button" onClick={() => setReordering(true)} aria-label={`Reorder ${kind}`} className="h-10 cursor-pointer px-2 text-sm font-bold text-brand">
          Reorder
        </button>
      </div>
      <ul className="flex flex-wrap gap-1.5">
        {entries.map((entry) => (
          <li key={entry.name}>
            <button
              type="button"
              onClick={() => setEditing(entry)}
              aria-label={`Edit ${entry.name}${entry.active ? "" : " (hidden)"}`}
              className={`inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-sm font-semibold ${
                entry.active ? "border-field bg-white text-ink" : "border-dashed border-field bg-page text-muted"
              }`}
            >
              {entry.swatch && <Swatch swatch={swatchOf(entry.swatch)} size={16} />}
              <span className={entry.active ? "" : "line-through"}>{entry.name}</span>
              {!entry.active && <span className="text-xs font-bold no-underline">Hidden</span>}
              <span className="text-muted">
                <PencilIcon />
              </span>
            </button>
          </li>
        ))}
      </ul>
      <button type="button" onClick={() => setEditing("new")} className="btn-secondary btn-small self-start">
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
        Add a {words.one}
      </button>
      <EntrySheet kind={kind} entry={editing} onClose={() => setEditing(null)} onDone={done} />
      <ReorderSheet kind={kind} open={reordering} entries={entries} onClose={() => setReordering(false)} onDone={done} />
    </section>
  );
}

function EntrySheet({ kind, entry, onClose, onDone }: { kind: Kind; entry: TagEntry | "new" | null; onClose: () => void; onDone: (message: string) => void }) {
  const words = WORDS[kind];
  const adding = entry === "new";
  const existing = entry && entry !== "new" ? entry : null;
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [rainbow, setRainbow] = useState(false);
  const [hex, setHex] = useState("#2F6FD6");
  const titleId = `${kind}-entry-title`;

  // Start from the entry each time the sheet opens.
  const [shown, setShown] = useState(entry);
  if (entry !== shown) {
    setShown(entry);
    setProblem(null);
    setRainbow(existing?.swatch === "multicolor");
    setHex(existing?.swatch && existing.swatch !== "multicolor" ? existing.swatch : "#2F6FD6");
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "");
    const swatch = kind === "colors" ? (rainbow ? "multicolor" : hex) : undefined;
    const active = existing ? form.get("active") === "on" : true;
    setBusy(true);
    setProblem(null);
    const result = await (existing ? editTagAction(kind, existing.name, { newName: name, swatch, active }) : addTagAction(kind, name, swatch)).catch(() => OFFLINE);
    setBusy(false);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    const clean = name.trim().replace(/\s+/g, " ");
    const what = !existing
      ? `“${clean}” added.`
      : existing.name !== clean
        ? `Renamed to “${clean}”.`
        : existing.active !== active
          ? active
            ? `“${clean}” shows again.`
            : `“${clean}” is hidden.`
          : "Saved.";
    onDone(result.message ? `${what} ${result.message}` : what);
  }

  return (
    <Sheet open={entry !== null} onClose={() => !busy && onClose()} busy={busy} labelledBy={titleId}>
      <form onSubmit={save} className="flex flex-col gap-4 px-4 pt-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
        <h2 id={titleId} className="text-xl font-extrabold">
          {adding ? `Add a ${words.one}` : `Edit “${existing?.name}”`}
        </h2>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${kind}-name`} className="label">
            Name
          </label>
          <input id={`${kind}-name`} name="name" type="text" required maxLength={40} defaultValue={existing?.name ?? ""} autoComplete="off" className="field" />
        </div>
        {kind === "colors" && (
          <fieldset className="flex flex-col gap-2">
            <legend className="label mb-1.5">Swatch</legend>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-line px-3 has-checked:border-ink">
              <input type="radio" name="swatch-kind" checked={!rainbow} onChange={() => setRainbow(false)} className="h-5 w-5 accent-[var(--color-ink)]" />
              <span className="flex-1 text-[15px] font-semibold">One color</span>
              <input
                type="color"
                aria-label="The swatch's color"
                value={hex}
                onChange={(event) => {
                  setHex(event.target.value.toUpperCase());
                  setRainbow(false);
                }}
                className="h-9 w-12 cursor-pointer rounded-lg border border-field bg-white p-0.5"
              />
            </label>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-line px-3 has-checked:border-ink">
              <input type="radio" name="swatch-kind" checked={rainbow} onChange={() => setRainbow(true)} className="h-5 w-5 accent-[var(--color-ink)]" />
              <span className="flex-1 text-[15px] font-semibold">Several colors</span>
              <Swatch swatch={swatchOf("multicolor")} size={28} />
            </label>
          </fieldset>
        )}
        {existing && (
          <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3">
            <span className="flex flex-col gap-0.5">
              <span className="text-[15px] font-bold">Offer it</span>
              <span className="hint">When adding, fixing tags and filtering. Turn it off to hide it; items that have it keep it.</span>
            </span>
            <input type="checkbox" name="active" defaultChecked={existing.active} className="h-6 w-6 flex-none accent-[var(--color-brand)]" />
          </label>
        )}
        {existing && existing.inUse > 0 && (
          <p className="hint">
            {existing.inUse === 1 ? "1 item" : `${existing.inUse} items`} on the list {existing.inUse === 1 ? "is" : "are"} tagged {words.tagged} “{existing.name}”. Renaming renames{" "}
            {existing.inUse === 1 ? "it" : "them"} too.
          </p>
        )}
        {problem && (
          <p role="alert" className="text-sm font-semibold text-bad">
            {problem}
          </p>
        )}
        <div className="grid grid-cols-2 gap-2">
          <button type="button" aria-disabled={busy} className="btn-secondary aria-disabled:cursor-wait aria-disabled:opacity-50" onClick={() => !busy && onClose()}>
            Cancel
          </button>
          <button type="submit" aria-disabled={busy} className="btn-primary aria-disabled:cursor-wait aria-disabled:opacity-60">
            {busy ? "Saving…" : adding ? "Add" : "Save"}
          </button>
        </div>
      </form>
    </Sheet>
  );
}

function ReorderSheet({ kind, open, entries, onClose, onDone }: { kind: Kind; open: boolean; entries: TagEntry[]; onClose: () => void; onDone: (message: string) => void }) {
  const words = WORDS[kind];
  const [order, setOrder] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const focus = useRef<{ name: string; direction: "up" | "down" } | null>(null);
  const titleId = `${kind}-reorder-title`;

  // The current order each time it opens.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setOrder(entries.map((e) => e.name));
      setProblem(null);
    }
  }

  // The moved one's button keeps keyboard focus, or its other button once it reaches an end.
  useEffect(() => {
    const moved = focus.current;
    if (!moved) return;
    focus.current = null;
    const index = order.indexOf(moved.name);
    const atEnd = moved.direction === "up" ? index === 0 : index === order.length - 1;
    document.getElementById(`${kind}-${atEnd ? (moved.direction === "up" ? "down" : "up") : moved.direction}-${index}`)?.focus();
  }, [order, kind]);

  const move = (index: number, by: -1 | 1) => {
    const next = [...order];
    [next[index], next[index + by]] = [next[index + by], next[index]];
    focus.current = { name: order[index], direction: by === -1 ? "up" : "down" };
    setOrder(next);
  };

  const hidden = new Set(entries.filter((e) => !e.active).map((e) => e.name));
  const button = "flex h-10 w-10 cursor-pointer items-center justify-center rounded-[10px] border border-field bg-white text-ink disabled:cursor-default disabled:opacity-30";

  return (
    <Sheet open={open} onClose={() => !busy && onClose()} busy={busy} labelledBy={titleId}>
      <div className="flex flex-col gap-3 px-4 pt-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
        <div className="flex flex-col gap-1">
          <h2 id={titleId} className="text-xl font-extrabold">
            Reorder {kind}
          </h2>
          <p className="hint">The add screens and the filters show them in this order.</p>
        </div>
        <ol className="flex flex-col divide-y divide-rule rounded-xl border border-line">
          {order.map((name, index) => (
            <li key={name} className="flex items-center gap-2 py-1.5 pr-1.5 pl-3.5">
              <span className="flex-1 text-[15px] font-semibold">
                {name}
                {hidden.has(name) && <span className="ml-1.5 text-xs font-bold text-muted">Hidden</span>}
              </span>
              <button id={`${kind}-up-${index}`} type="button" disabled={index === 0} onClick={() => move(index, -1)} aria-label={`Move ${name} up`} className={button}>
                <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 19V5M6 11l6-6 6 6" />
                </svg>
              </button>
              <button
                id={`${kind}-down-${index}`}
                type="button"
                disabled={index === order.length - 1}
                onClick={() => move(index, 1)}
                aria-label={`Move ${name} down`}
                className={button}
              >
                <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 5v14M6 13l6 6 6-6" />
                </svg>
              </button>
            </li>
          ))}
        </ol>
        {problem && (
          <p role="alert" className="text-sm font-semibold text-bad">
            {problem}
          </p>
        )}
        <div className="grid grid-cols-2 gap-2">
          <button type="button" aria-disabled={busy} className="btn-secondary aria-disabled:cursor-wait aria-disabled:opacity-50" onClick={() => !busy && onClose()}>
            Cancel
          </button>
          <button
            type="button"
            aria-disabled={busy}
            className="btn-primary aria-disabled:cursor-wait aria-disabled:opacity-60"
            onClick={async () => {
              if (busy) return;
              setBusy(true);
              setProblem(null);
              const result = await reorderTagsAction(kind, order).catch(() => OFFLINE);
              setBusy(false);
              if (result.ok) onDone(`New order for the ${words.one} list saved.`);
              else setProblem(result.message);
            }}
          >
            {busy ? "Saving…" : "Save order"}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
