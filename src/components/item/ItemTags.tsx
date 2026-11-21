"use client";

import { useEffect, useRef, useState, type FocusEvent } from "react";
import { changeTagsAction } from "@/app/actions/items";
import { TagPicker, type ColorChoice } from "@/components/add/TagPicker";
import { TagIcon } from "@/components/grid/ItemCard";
import { Swatch } from "@/components/Swatch";
import type { Swatch as SwatchValue } from "@/server/views";

/**
 * The item page's tags, with *Fix tags* (spec section 5). Anyone can change
 * the type, color and *Has a name*; the change shows here at once, and to
 * everyone else on their next look, with an *Undo* bar for a few seconds.
 * The photo can't be changed here (only an admin can replace it).
 */

export interface TagValues {
  type: string;
  color: string;
  hasName: boolean;
}

const OFFLINE = "Couldn't reach the lost and found. Check the connection and try again.";
const BAR_MS = 8_000;
const UNKNOWN: SwatchValue = { background: "#C9CED8", light: false };

const describe = (tags: TagValues) => `${tags.type}, ${tags.color.toLowerCase()}${tags.hasName ? ", has a name" : ""}`;
const same = (a: TagValues, b: TagValues) => a.type === b.type && a.color === b.color && a.hasName === b.hasName;

export function ItemTags({
  itemId,
  initial,
  types,
  colors,
  palette,
  heading: Heading = "h1",
  offerUndo,
}: {
  /** Null for an item that's no longer on the list: its tags can't change. */
  itemId: string | null;
  initial: TagValues;
  types: string[];
  colors: ColorChoice[];
  /** Every color's swatch by name, including ones admins have since turned off. */
  palette: Record<string, SwatchValue>;
  /** The admin item page has its own h1 (the item's number). */
  heading?: "h1" | "h2";
  /** In the admin section, *Undo* goes through its shared bar instead of one of its own. */
  offerUndo?: (text: string, undo: () => Promise<string | null>) => void;
}) {
  const [tags, setTags] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [previous, setPrevious] = useState<TagValues | null>(null);
  const [paused, setPaused] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const fixButton = useRef<HTMLButtonElement>(null);
  const undoButton = useRef<HTMLButtonElement>(null);
  const bar = useRef<HTMLDivElement>(null);

  const announce = (text: string) => setAnnouncement((last) => (last === text ? `${text} ` : text));

  // The Undo bar goes after a few seconds, but not while it's pointed at or keyboard-focused.
  useEffect(() => {
    if (!previous || paused) return;
    const timer = setTimeout(() => {
      if (bar.current?.contains(document.activeElement)) fixButton.current?.focus();
      setPrevious(null);
    }, BAR_MS);
    return () => clearTimeout(timer);
  }, [previous, paused]);

  useEffect(() => {
    if (previous) undoButton.current?.focus();
  }, [previous]);

  async function send(next: TagValues): Promise<string | null> {
    if (!itemId) return "This item isn't on the list any more.";
    const result = await changeTagsAction(itemId, { type: next.type, color: next.color, has_name: next.hasName }).catch(() => ({ ok: false as const, message: OFFLINE }));
    return result.ok ? null : result.message;
  }

  async function save(next: TagValues): Promise<string | null> {
    const failure = await send(next);
    if (failure) return failure;
    setProblem(null);
    const before = tags;
    setTags(next);
    announce(`Tags saved: ${describe(next)}.`);
    if (offerUndo) {
      offerUndo(`Tags saved: ${describe(next)}.`, async () => {
        const failure = await send(before);
        if (!failure) setTags(before);
        return failure;
      });
    } else {
      setPaused(false);
      setPrevious(before);
    }
    return null;
  }

  async function undo() {
    if (!previous || undoing) return;
    setUndoing(true);
    const failure = await send(previous);
    setUndoing(false);
    if (failure) {
      setProblem(failure);
      return;
    }
    setTags(previous);
    setPrevious(null);
    announce(`Tags put back: ${describe(previous)}.`);
    fixButton.current?.focus();
  }

  const pauseOnKeyboardFocus = (event: FocusEvent<HTMLElement>) => setPaused(event.target.matches(":focus-visible"));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-3">
        <Heading className="text-[28px] leading-[1.1] font-extrabold">{tags.type}</Heading>
        {itemId && (
          <button
            ref={fixButton}
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex h-11 flex-none cursor-pointer items-center gap-1.5 rounded-[10px] border border-field bg-white px-3 text-sm font-bold text-ink hover:bg-page"
          >
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 20h4L19 9l-4-4L4 16v4z" />
              <path d="M13.5 6.5l4 4" />
            </svg>
            Fix tags
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex h-[30px] items-center gap-1.5 rounded-full bg-white pr-3 pl-2 text-sm font-semibold">
          <Swatch swatch={palette[tags.color] ?? UNKNOWN} size={16} />
          {tags.color}
        </span>
        {tags.hasName && (
          <span className="inline-flex h-[30px] items-center gap-1.5 rounded-full bg-white pr-3 pl-2.5 text-sm font-semibold">
            <TagIcon size={14} />
            Has a name
          </span>
        )}
      </div>
      {problem && (
        <p role="alert" className="text-sm font-semibold text-bad">
          {problem}
        </p>
      )}
      <p role="status" className="sr-only">
        {announcement}
      </p>

      {itemId && <FixTagsSheet open={editing} current={tags} types={types} colors={colors} onClose={() => setEditing(false)} onSave={save} />}

      {previous && (
        <div
          ref={bar}
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          onFocus={pauseOnKeyboardFocus}
          onBlur={() => setPaused(false)}
          className="fixed inset-x-3 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-30 mx-auto flex max-w-md items-center gap-2.5 rounded-[14px] bg-ink py-1.5 pr-1.5 pl-3.5 text-white shadow-[0_8px_24px_rgba(0,0,0,0.25)]"
        >
          <span className="flex-1 text-sm leading-snug">Tags saved.</span>
          <button
            ref={undoButton}
            type="button"
            onClick={() => void undo()}
            aria-disabled={undoing}
            className="h-11 flex-none cursor-pointer rounded-[10px] px-3.5 text-[15px] font-bold text-[#9DB4FF] aria-disabled:cursor-wait aria-disabled:opacity-60"
          >
            {undoing ? "Undoing…" : "Undo"}
          </button>
        </div>
      )}
    </div>
  );
}

/** The sheet from the mockups: the add screens' tag controls, with *Cancel* and *Save*. */
function FixTagsSheet({
  open,
  current,
  types,
  colors,
  onClose,
  onSave,
}: {
  open: boolean;
  current: TagValues;
  types: string[];
  colors: ColorChoice[];
  onClose: () => void;
  onSave: (tags: TagValues) => Promise<string | null>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(current);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Start from the item's tags each time the sheet opens.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setDraft(current);
      setError(null);
    }
  }

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    else if (!open && element.open) element.close();
  }, [open]);

  const changed = !same(draft, current);

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      aria-labelledby="fix-tags-title"
      className="m-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-y-auto rounded-t-[22px] bg-white p-0 text-ink backdrop:bg-ink/55 sm:m-auto sm:max-w-md sm:rounded-[22px]"
    >
      {open && (
        <form
          className="flex flex-col gap-3.5 px-4 pt-2.5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!changed || saving) return;
            setSaving(true);
            const failure = await onSave(draft);
            setSaving(false);
            if (failure) setError(failure);
            else onClose();
          }}
        >
          <span aria-hidden="true" className="mx-auto h-[5px] w-10 rounded-full bg-[#D5D8DE] sm:hidden" />
          <div className="flex flex-col gap-1">
            <h2 id="fix-tags-title" className="text-xl font-extrabold">
              Fix tags
            </h2>
            <p className="text-[13px] leading-snug text-muted">Anyone can fix tags, and everyone sees the change right away. Only the PTA can change the photo.</p>
          </div>
          <TagPicker
            types={types}
            colors={colors}
            type={draft.type}
            color={draft.color}
            hasName={draft.hasName}
            onType={(type) => setDraft({ ...draft, type })}
            onColor={(color) => setDraft({ ...draft, color })}
            onHasName={(hasName) => setDraft({ ...draft, hasName })}
          />
          {error && (
            <p role="alert" className="text-sm font-semibold text-bad">
              {error}
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" aria-disabled={!changed || saving} className="btn-primary aria-disabled:cursor-not-allowed aria-disabled:opacity-50">
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
