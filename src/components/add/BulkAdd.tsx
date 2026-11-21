"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditSheet } from "@/components/add/EditSheet";
import { TagPicker, type ColorChoice } from "@/components/add/TagPicker";
import { uploadQueue, useUploads } from "@/components/add/upload-store";
import { copyRegion, decodeImage, drawPreview, newClientRef, releaseCanvas, trimRegion, UnreadablePhotoError, uploadImages } from "@/lib/image/browser";
import type { Rect } from "@/lib/image/trim";
import type { QueueEntry } from "@/lib/upload-queue";

/**
 * Bulk add (spec section 4): the live camera on top, the tags underneath,
 * two taps per item. The shutter freezes the photo, already trimmed to the
 * item; tapping a color saves it and brings the camera back. The type stays
 * for the next item; *Has a name* resets. Without a live camera (permission
 * refused, an older browser) it falls back to the phone's camera app.
 *
 * Uploads run in the visit-wide queue (upload-store), so leaving this screen
 * any way at all doesn't drop photos still on their way.
 */

interface Frozen {
  /** The square frame at full resolution. */
  frame: HTMLCanvasElement;
  trim: Rect | null;
  full: boolean;
}

type Camera = "starting" | "live" | "fallback";

export function BulkAdd({ types, colors, contactEmail }: { types: string[]; colors: ColorChoice[]; contactEmail: string }) {
  const entries = useUploads();
  const [type, setType] = useState<string | null>(null);
  const [hasName, setHasName] = useState(false);
  const [camera, setCamera] = useState<Camera>("starting");
  const [frozen, setFrozen] = useState<Frozen | null>(null);
  const [nudge, setNudge] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const preview = useRef<HTMLCanvasElement>(null);
  /** Bumped whenever the screen starts or stops, so a camera that answers late is turned straight off. */
  const generation = useRef(0);
  const frozenRef = useRef<Frozen | null>(null);
  useEffect(() => {
    frozenRef.current = frozen;
  }, [frozen]);

  const announce = (text: string) => setAnnouncement((previous) => (previous === text ? `${text} ` : text));

  const stopCamera = useCallback(() => {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
  }, []);

  const startCamera = useCallback(() => {
    const asking = generation.current;
    // Needs HTTPS (or localhost) and permission; anything else falls back to the camera app.
    const asked = navigator.mediaDevices?.getUserMedia
      ? navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1440 } },
          audio: false,
        })
      : Promise.reject(new Error("No live camera in this browser"));
    return asked.then(
      async (media) => {
        // The screen was left (or the camera restarted) while the phone was asking: don't leave this one running.
        if (asking !== generation.current) {
          media.getTracks().forEach((track) => track.stop());
          return;
        }
        stopCamera();
        stream.current = media;
        if (video.current) {
          video.current.srcObject = media;
          await video.current.play().catch(() => undefined);
        }
        setCamera("live");
      },
      () => {
        if (asking === generation.current) setCamera("fallback");
      },
    );
  }, [stopCamera]);

  useEffect(() => {
    generation.current += 1;
    uploadQueue().startSession();
    void startCamera();
    // Phones stop the camera when the page is hidden; start it again on the way back.
    const onVisible = () => {
      if (document.visibilityState === "visible" && stream.current?.getVideoTracks().some((track) => track.readyState === "ended")) void startCamera();
    };
    document.addEventListener("visibilitychange", onVisible);
    // The screen is the whole page: no scrolling, tabbing or reading the site's header and footer underneath.
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const behind = Array.from(document.querySelectorAll<HTMLElement>("body > header, body > footer"));
    behind.forEach((element) => (element.inert = true));
    return () => {
      generation.current += 1;
      document.removeEventListener("visibilitychange", onVisible);
      document.body.style.overflow = overflow;
      behind.forEach((element) => (element.inert = false));
      stopCamera();
      if (frozenRef.current) releaseCanvas(frozenRef.current.frame);
    };
  }, [startCamera, stopCamera]);

  const crop = useMemo(
    () => (frozen ? (frozen.full || !frozen.trim ? { x: 0, y: 0, w: frozen.frame.width, h: frozen.frame.height } : frozen.trim) : null),
    [frozen],
  );

  useEffect(() => {
    if (frozen && crop && preview.current) drawPreview(preview.current, frozen.frame, crop);
  }, [frozen, crop]);

  /** Lets go of the frozen photo, and its memory. */
  function unfreeze() {
    if (frozen) releaseCanvas(frozen.frame);
    setFrozen(null);
  }

  function freeze(frame: HTMLCanvasElement) {
    const trim = trimRegion(frame, { x: 0, y: 0, w: frame.width, h: frame.height });
    if (frozen) releaseCanvas(frozen.frame);
    setFrozen({ frame, trim, full: false });
    setNudge(null);
    announce(trim ? "Photo taken, cropped to the item. Now tap its color." : "Photo taken. Now tap its color.");
  }

  function shutter() {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    // The middle square, which is what the square frame shows.
    const side = Math.min(v.videoWidth, v.videoHeight);
    freeze(copyRegion(v, { x: Math.floor((v.videoWidth - side) / 2), y: Math.floor((v.videoHeight - side) / 2), w: side, h: side }));
  }

  async function fromCameraApp(file: File | undefined) {
    if (!file) return;
    try {
      const bitmap = await decodeImage(file);
      const side = Math.min(bitmap.width, bitmap.height);
      const frame = copyRegion(bitmap, { x: Math.floor((bitmap.width - side) / 2), y: Math.floor((bitmap.height - side) / 2), w: side, h: side });
      bitmap.close();
      freeze(frame);
    } catch (error) {
      setNudge(error instanceof UnreadablePhotoError ? "That photo couldn't be read. Take it again." : "Something went wrong. Take the photo again.");
    }
  }

  function retake() {
    unfreeze();
    setNudge(null);
    if (camera === "fallback") fileInput.current?.click();
  }

  async function save(color: string) {
    if (!frozen || !crop) {
      setNudge("Take the photo first");
      return;
    }
    if (!type) {
      setNudge("Pick a type first");
      return;
    }
    if (saving) return;
    setSaving(true);
    try {
      const images = await uploadImages(frozen.frame, crop);
      uploadQueue().add(images, { type, color, hasName }, newClientRef());
      unfreeze();
      setHasName(false);
      setNudge(null);
      announce(`Saved: ${type.toLowerCase()}, ${color.toLowerCase()}. Uploading.`);
    } catch {
      setNudge("That photo couldn't be saved. Take it again.");
    } finally {
      setSaving(false);
    }
  }

  const strip = entries.filter((entry) => entry.state !== "undone");
  const editingEntry = entries.find((entry) => entry.key === editing && entry.state !== "undone") ?? null;
  // Spoken when it changes, like the other announcements: a red tile alone says nothing to a screen reader.
  const failed = entries.filter((entry) => entry.state === "failed").length;
  const failedNote = failed ? `${failed === 1 ? "A photo didn't" : `${failed} photos didn't`} upload. Tap it in the strip to retry or undo.` : "";
  const colorNote = nudge ? (
    <span className="text-xs font-bold text-bad">{nudge}</span>
  ) : frozen ? (
    <span className="text-xs font-bold text-brand-dark">{saving ? "Saving…" : type ? "Tap a color to save" : "Pick a type, then a color"}</span>
  ) : (
    <span className="text-xs text-muted">Take the photo first</span>
  );

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[#0F1114]">
      <div className="mx-auto flex min-h-full max-w-md flex-col">
        <header className="flex h-[52px] flex-none items-center justify-between px-1 text-white">
          {/* Uploads still on their way carry on after leaving; the bottom bar shows them. */}
          <Link href="/" className="flex h-11 items-center px-3 text-base font-bold text-white no-underline hover:text-[#D5DBFF]">
            Done
          </Link>
          <h1 className="text-base font-extrabold">Bulk add</h1>
          <span className="w-[68px]" />
        </header>

        <div role="list" aria-label="Saved since you opened bulk add" className="flex h-[72px] flex-none gap-2.5 overflow-x-auto px-3 pt-0.5 [scrollbar-width:none]">
          {strip.length === 0 && (
            <p className="self-center text-[13px] leading-snug text-[#A9AFBA]">
              Only add things that are in the lost-and-found bin. What you save shows up here; tap one to fix it or undo it.
            </p>
          )}
          {strip.map((entry) => (
            <StripItem key={entry.key} entry={entry} onTap={() => setEditing(entry.key)} />
          ))}
        </div>

        {/* Sized by what's left over after the tags, through a size container: the square takes the largest side that fits. */}
        <div className="relative flex min-h-[220px] [container-type:size] flex-1 basis-0 items-center justify-center">
          <div className="relative aspect-square w-[min(calc(100cqw_-_32px),calc(100cqh_-_16px),448px)] overflow-hidden rounded-md bg-[#2A2E35]">
            {/* Always there, so the stream has somewhere to go; shown only while live. */}
            <video ref={video} muted playsInline autoPlay aria-hidden="true" className={`absolute inset-0 h-full w-full object-cover ${camera === "live" && !frozen ? "" : "invisible"}`} />
            {camera === "live" && !frozen && <Frame />}
            {frozen && (
              <button type="button" onClick={retake} aria-label="Retake photo" className="absolute inset-0 cursor-pointer bg-[#0F1114] p-0">
                <canvas ref={preview} className="h-full w-full" />
                <span className="absolute top-3 left-3 rounded-full bg-white/15 px-2.5 py-1 text-xs font-bold text-white">
                  {frozen.trim && !frozen.full ? "Cropped to the item" : "Full square photo"}
                </span>
              </button>
            )}
            {camera === "starting" && !frozen && <p className="absolute inset-0 flex items-center justify-center text-sm text-[#A9AFBA]">Starting the camera…</p>}
            {camera === "fallback" && !frozen && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center">
                <p className="text-sm text-[#D5D8DE]">{entries.length ? "Ready for the next one." : "The live camera isn't available, so this uses the phone's camera app."}</p>
                <button type="button" onClick={() => fileInput.current?.click()} className="btn-primary">
                  {entries.length ? "Take the next photo" : "Take a photo"}
                </button>
              </div>
            )}
          </div>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(event) => {
              void fromCameraApp(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        </div>

        <div className="flex h-[76px] flex-none items-center justify-center px-4">
          {frozen ? (
            <div className="flex w-full items-center justify-between gap-2.5">
              <button type="button" onClick={retake} className="h-11 cursor-pointer rounded-[10px] border border-white/40 px-4 text-[15px] font-bold text-white">
                Retake
              </button>
              {frozen.trim && (
                <button
                  type="button"
                  onClick={() => setFrozen({ ...frozen, full: !frozen.full })}
                  className="h-11 cursor-pointer rounded-[10px] border border-white/40 px-4 text-[15px] font-bold text-white"
                >
                  {frozen.full ? "Crop to the item" : "Full photo"}
                </button>
              )}
            </div>
          ) : camera === "live" ? (
            <div className="flex w-full items-center justify-between">
              <span className="w-[92px] text-xs leading-snug text-[#A9AFBA]">Turn name labels away from the camera</span>
              <button type="button" onClick={shutter} aria-label="Take photo" className="flex h-[66px] w-[66px] cursor-pointer items-center justify-center rounded-full border-4 border-white">
                <span className="block h-[50px] w-[50px] rounded-full bg-white" />
              </button>
              <span className="w-[92px] text-right text-xs leading-snug text-[#A9AFBA]">Tap a saved item above to fix or undo it</span>
            </div>
          ) : (
            <span className="text-center text-xs text-[#A9AFBA]">Turn name labels away from the camera</span>
          )}
        </div>

        <section aria-label="Tags" className="flex-none rounded-t-[18px] bg-white px-4 pt-3.5 pb-[calc(0.875rem+env(safe-area-inset-bottom))] text-ink">
          <TagPicker
            types={types}
            colors={colors}
            type={type}
            color={null}
            hasName={hasName}
            onType={(name) => {
              setType(name);
              if (nudge === "Pick a type first") setNudge(null);
            }}
            onColor={(color) => void save(color)}
            onHasName={setHasName}
            colorSaves
            colorWaitsFor={!frozen ? "take the photo first" : !type ? "pick a type first" : null}
            typeNote="Stays selected for the next item"
            colorNote={colorNote}
            typesInOneRow
          />
          <p className="mt-2.5 text-center text-xs leading-snug text-muted">
            After you leave bulk add, email <a href={`mailto:${contactEmail}`}>{contactEmail}</a> to have an item removed.
          </p>
        </section>
      </div>

      <p role="status" className="sr-only">
        {announcement}
      </p>
      <p role="status" className="sr-only">
        {failedNote}
      </p>
      <EditSheet
        entry={editingEntry}
        types={types}
        colors={colors}
        onClose={() => setEditing(null)}
        onSave={(tags) => editingEntry && void uploadQueue().setTags(editingEntry.key, tags)}
        onRetry={() => {
          if (editingEntry) uploadQueue().retry(editingEntry.key);
          setEditing(null);
        }}
        onUndo={() => {
          if (editingEntry) void uploadQueue().undo(editingEntry.key);
          setEditing(null);
        }}
      />
    </div>
  );
}

/** Corner marks over the live camera, and a LIVE tag. */
function Frame() {
  const corner = "pointer-events-none absolute h-[26px] w-[26px] border-white";
  return (
    <>
      <span className={`${corner} top-3 left-3 border-t-[3px] border-l-[3px]`} />
      <span className={`${corner} top-3 right-3 border-t-[3px] border-r-[3px]`} />
      <span className={`${corner} bottom-3 left-3 border-b-[3px] border-l-[3px]`} />
      <span className={`${corner} right-3 bottom-3 border-r-[3px] border-b-[3px]`} />
      <span className="pointer-events-none absolute top-4 left-1/2 -translate-x-1/2 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-extrabold tracking-[0.04em] text-white">
        LIVE
      </span>
    </>
  );
}

function StripItem({ entry, onTap }: { entry: QueueEntry; onTap: () => void }) {
  const status =
    entry.state === "saved"
      ? "saved"
      : entry.state === "failed"
        ? entry.retryable
          ? "didn't upload"
          : "not saved"
        : `uploading, ${Math.round(entry.progress * 100)} percent`;
  const ring = entry.state === "failed" ? "border-bad" : entry.message ? "border-[#F2C230]" : "border-transparent";
  return (
    <div role="listitem" className="flex flex-none flex-col items-center gap-[3px]">
      <button
        type="button"
        onClick={onTap}
        aria-label={`${entry.tags.type}, ${entry.tags.color.toLowerCase()}: ${status}${entry.message ? `. ${entry.message}` : ""}`}
        className={`relative h-[52px] w-[52px] cursor-pointer overflow-hidden rounded-[10px] border-2 bg-[#2A2E35] p-0 ${ring}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- a local preview of the thumbnail */}
        <img src={entry.preview} alt="" className="h-full w-full object-contain" />
        {(entry.state === "waiting" || entry.state === "uploading") && (
          <span className="absolute right-1 bottom-1 left-1 h-1 overflow-hidden rounded-sm bg-white/30">
            <span className="block h-1 bg-[#7D9BFF] transition-[width]" style={{ width: `${Math.round(entry.progress * 100)}%` }} />
          </span>
        )}
        {entry.state === "saved" && (
          <span className="absolute right-0.5 bottom-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-[#2F9E5B] text-white">
            <svg aria-hidden="true" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12l5 5 9-10" />
            </svg>
          </span>
        )}
        {entry.state === "failed" && (
          <span className="absolute inset-0 flex flex-col items-center justify-center bg-[rgba(180,35,24,0.82)] text-[10px] font-extrabold text-white">
            {entry.retryable ? "Retry" : "Not saved"}
          </span>
        )}
      </button>
      <span className="max-w-[60px] truncate text-[10px] font-semibold text-[#A9AFBA]">{entry.tags.type}</span>
    </div>
  );
}
