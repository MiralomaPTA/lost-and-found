"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { undoAddAction } from "@/app/actions/items";
import { CropArea } from "@/components/add/CropArea";
import { TagPicker, type ColorChoice } from "@/components/add/TagPicker";
import { boxRect, initialBox, type Box } from "@/lib/image/crop-box";
import { decodeImage, newClientRef, trimRegion, UnreadablePhotoError, uploadImages } from "@/lib/image/browser";
import { uploadItem } from "@/lib/upload";

/**
 * *Add one from a photo* (spec section 4): pick a photo already on the phone,
 * crop it by hand, tag it, add it. Nothing is pre-selected. After adding, a
 * bar offers *Undo* (until the screen is left) and *Add another*.
 */

type Status =
  | { kind: "empty" }
  | { kind: "reading" }
  | { kind: "ready" }
  | { kind: "saving"; progress: number }
  | { kind: "added"; itemId: string }
  | { kind: "undone" };

interface Picked {
  image: ImageBitmap;
  start: Box;
}

export function PhotoAdd({ types, colors, contactEmail }: { types: string[]; colors: ColorChoice[]; contactEmail: string }) {
  const [picked, setPicked] = useState<Picked | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [type, setType] = useState<string | null>(null);
  const [color, setColor] = useState<string | null>(null);
  const [hasName, setHasName] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "empty" });
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const clientRef = useRef<string | null>(null);
  const bar = useRef<HTMLDivElement>(null);

  const saving = status.kind === "saving";
  const added = status.kind === "added";
  const ready = Boolean(picked && box && type && color) && !saving && !added;

  // Leaving mid-upload would lose the item.
  useEffect(() => {
    if (!saving) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saving]);

  useEffect(() => () => picked?.image.close(), [picked]);

  useEffect(() => {
    if (added) bar.current?.querySelector("button")?.focus();
  }, [added]);

  async function choose(file: File | undefined) {
    if (!file) return;
    setError(null);
    setStatus({ kind: "reading" });
    try {
      const image = await decodeImage(file);
      const trim = trimRegion(image, { x: 0, y: 0, w: image.width, h: image.height });
      const start = initialBox(image.width, image.height, trim);
      setPicked({ image, start });
      setBox(start);
      setType(null);
      setColor(null);
      setHasName(false);
      clientRef.current = newClientRef();
      setStatus({ kind: "ready" });
      setAnnouncement("Photo ready. Move the square over the item, then pick its type and color.");
    } catch (problem) {
      setStatus(picked ? { kind: "ready" } : { kind: "empty" });
      setError(
        problem instanceof UnreadablePhotoError
          ? "This photo's format can't be read in this browser. Try another photo, or a screenshot of it."
          : "Something went wrong reading that photo. Try again.",
      );
    }
  }

  async function save() {
    if (!picked || !box || !type || !color || !ready) return;
    setError(null);
    setStatus({ kind: "saving", progress: 0 });
    try {
      const images = await uploadImages(picked.image, boxRect(box));
      clientRef.current ??= newClientRef();
      const result = await uploadItem({ ...images, type, color, hasName, clientRef: clientRef.current }, (progress) => setStatus({ kind: "saving", progress }));
      if (!result.ok) {
        setError(result.message);
        setStatus({ kind: "ready" });
        return;
      }
      setStatus({ kind: "added", itemId: result.id });
      setAnnouncement("Added to the grid.");
    } catch {
      setError("That photo couldn't be saved. Try again.");
      setStatus({ kind: "ready" });
    }
  }

  async function undo() {
    if (status.kind !== "added") return;
    const result = await undoAddAction(status.itemId).catch(() => ({ ok: false as const, message: "Couldn't reach the lost and found. Try again." }));
    if (!result.ok) {
      setError(result.message);
      return;
    }
    // A fresh reference, so adding it again (after a fix) makes a new item.
    clientRef.current = newClientRef();
    setStatus({ kind: "undone" });
    setAnnouncement("Taken back off the list. Fix it and add it again, or pick another photo.");
  }

  const help = "Drag the square to move it. Pinch, or drag its corner, to resize. Crop out any written name.";

  return (
    <div className="flex flex-col">
      <div className="-mx-4 -mt-6 flex h-[52px] items-center justify-between gap-2 border-b border-line bg-white px-1 sm:mx-0 sm:mt-0 sm:rounded-2xl sm:border">
        <Link href="/add" className="inline-flex h-11 items-center gap-0.5 pr-2 pl-1 text-[15px] font-bold text-ink no-underline hover:text-ink">
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 5l-7 7 7 7" />
          </svg>
          Add
        </Link>
        <h1 className="text-base font-extrabold">Add one from a photo</h1>
        <button
          type="button"
          onClick={() => input.current?.click()}
          className={`h-11 cursor-pointer px-2.5 text-sm font-bold text-brand ${picked ? "" : "invisible"}`}
          disabled={saving}
        >
          Other photo
        </button>
      </div>

      <input
        ref={input}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          void choose(event.target.files?.[0]);
          event.target.value = "";
        }}
      />

      {picked && box ? (
        <>
          <div className="-mx-4 h-[clamp(240px,62vw,440px)] bg-[#2A2E35] sm:mx-0 sm:mt-3 sm:rounded-2xl">
            <CropArea image={picked.image} box={box} onChange={(next) => !saving && !added && setBox(next)} label="The chosen photo" />
          </div>
          <div className="-mx-4 flex min-h-11 items-center justify-between gap-2 border-b border-line bg-white py-1 pr-1.5 pl-4 sm:mx-0">
            <span className="text-xs leading-snug text-muted">{help}</span>
            <button
              type="button"
              onClick={() => setBox(picked.start)}
              disabled={saving || added}
              className="h-10 flex-none cursor-pointer px-2.5 text-sm font-bold text-brand disabled:opacity-50"
            >
              Reset
            </button>
          </div>
        </>
      ) : (
        <div className="mx-auto mt-6 flex w-full max-w-md flex-col items-center gap-4 rounded-2xl border border-line bg-white px-5 py-8 text-center">
          <p className="text-base font-bold">Pick the photo you took of the item</p>
          <p className="text-sm text-muted">You&apos;ll crop it to a square and tag it. Crop out any written name.</p>
          <button type="button" onClick={() => input.current?.click()} className="btn-primary" aria-disabled={status.kind === "reading"}>
            {status.kind === "reading" ? "Reading the photo…" : "Choose a photo"}
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className="notice mx-auto mt-3 w-full max-w-md bg-bad-soft text-bad">
          {error}
        </p>
      )}

      <section aria-label="Tags" className={`mx-auto mt-3 flex w-full max-w-md flex-col gap-3 ${picked ? "" : "hidden"}`}>
        <fieldset disabled={saving || added} className="contents">
          <TagPicker types={types} colors={colors} type={type} color={color} hasName={hasName} onType={setType} onColor={setColor} onHasName={setHasName} />
        </fieldset>
        <button type="button" onClick={() => void save()} aria-disabled={!ready} className="btn-primary aria-disabled:cursor-not-allowed aria-disabled:opacity-50">
          {saving ? `Adding… ${Math.round(status.progress * 100)}%` : added ? "Added" : "Add to the grid"}
        </button>
        {!ready && !saving && !added && picked && <p className="text-center text-xs text-muted">Pick a type and a color first.</p>}
        <p className="text-center text-xs text-muted">Only add things that are in the lost-and-found bin.</p>
        <p className="text-center text-xs text-muted">
          After you leave this screen, email <a href={`mailto:${contactEmail}`}>{contactEmail}</a> to have an item removed.
        </p>
      </section>

      {(added || status.kind === "undone") && (
        <div
          ref={bar}
          className="fixed inset-x-3 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-30 mx-auto flex max-w-md items-center gap-1.5 rounded-[14px] bg-ink py-1.5 pr-1.5 pl-3.5 text-white shadow-[0_8px_24px_rgba(0,0,0,0.25)]"
        >
          <span className="flex-1 text-sm font-semibold">{added ? "Added to the grid" : "Taken back off the list"}</span>
          {added && (
            <button type="button" onClick={() => void undo()} className="h-11 cursor-pointer rounded-[10px] px-3 text-[15px] font-bold text-[#9DB4FF]">
              Undo
            </button>
          )}
          <button type="button" onClick={() => input.current?.click()} className="h-11 cursor-pointer rounded-[10px] bg-white px-3 text-[15px] font-bold text-ink">
            Add another
          </button>
        </div>
      )}
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
