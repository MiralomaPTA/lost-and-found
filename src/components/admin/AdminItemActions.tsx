"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { keepNewPhotoAction, removeItemAction, undoPhotoReplaceAction, undoRemovalAction } from "@/app/actions/admin";
import { CropArea } from "@/components/add/CropArea";
import { RestoreButton } from "@/components/admin/RestoreButton";
import { SHEET, useModal } from "@/components/admin/Sheet";
import { useUndo } from "@/components/admin/UndoProvider";
import { boxRect, initialBox, type Box } from "@/lib/image/crop-box";
import { decodeImage, trimRegion, UnreadablePhotoError, uploadImages } from "@/lib/image/browser";
import { uploadReplacementPhoto } from "@/lib/upload";

/** The reasons an admin can give, as the spec words them. */
const REASONS = [
  ["returned in person", "Returned in person"],
  ["gone from the bin", "Gone from the bin"],
  ["duplicate or mistake", "Duplicate or mistake"],
  ["thrown away", "Thrown away"],
  ["other", "Other"],
] as const;

const OFFLINE = "Couldn't reach the lost and found. Try again.";

/** *Replace photo*, *Remove* (with a reason) and *Restore* on the admin item page (spec section 6). */
export function AdminItemActions({ itemId, label, status }: { itemId: string; label: string; status: "available" | "claimed" | "removed" | "donated" }) {
  const router = useRouter();
  const { offer } = useUndo();
  const [, startRefresh] = useTransition();
  const refresh = () => startRefresh(() => router.refresh());
  const [removing, setRemoving] = useState(false);
  const [picked, setPicked] = useState<{ image: ImageBitmap; start: Box } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function choose(file: File | undefined) {
    if (!file) return;
    setProblem(null);
    try {
      const image = await decodeImage(file);
      setPicked({ image, start: initialBox(image.width, image.height, trimRegion(image, { x: 0, y: 0, w: image.width, h: image.height })) });
    } catch (error) {
      setProblem(error instanceof UnreadablePhotoError ? "That photo's format can't be read in this browser. Try another." : "Something went wrong reading that photo.");
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {status !== "donated" && (
          <button type="button" onClick={() => input.current?.click()} className="btn-secondary btn-small">
            Replace photo
          </button>
        )}
        {(status === "available" || status === "claimed") && (
          <button type="button" onClick={() => setRemoving(true)} className="btn-secondary btn-small text-bad hover:text-bad">
            Remove
          </button>
        )}
        {status === "removed" && <RestoreButton itemId={itemId} label={label} className="h-11" />}
      </div>
      {problem && (
        <p role="alert" className="text-sm font-semibold text-bad">
          {problem}
        </p>
      )}
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
      <RemoveSheet
        open={removing}
        itemId={itemId}
        onClose={() => setRemoving(false)}
        onRemoved={(reason, closedClaimName) => {
          setRemoving(false);
          offer(`${itemId} removed: ${reason}${closedClaimName ? `. ${closedClaimName}'s claim on it is closed` : ""}.`, async () => {
            const back = await undoRemovalAction(itemId);
            refresh();
            return back.ok ? null : back.message;
          });
          refresh();
        }}
      />
      <PhotoSheet
        picked={picked}
        itemId={itemId}
        onClose={() => {
          picked?.image.close();
          setPicked(null);
        }}
        onReplaced={(photo) => {
          picked?.image.close();
          setPicked(null);
          offer(
            `${itemId}: photo replaced.`,
            async () => {
              const back = await undoPhotoReplaceAction(itemId, photo);
              refresh();
              return back.ok ? null : back.message;
            },
            // Once Undo is no longer offered, the old photo is deleted (the server also does it after ten minutes).
            { onExpire: () => void keepNewPhotoAction(itemId, photo).catch(() => undefined) },
          );
          refresh();
        }}
      />
    </div>
  );
}

/** *Remove* asks for a reason (spec section 6). */
function RemoveSheet({
  open,
  itemId,
  onClose,
  onRemoved,
}: {
  open: boolean;
  itemId: string;
  onClose: () => void;
  onRemoved: (reason: string, closedClaimName: string | undefined) => void;
}) {
  const dialog = useModal(open);
  const [reason, setReason] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // Nothing picked each time it opens.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setReason(null);
      setProblem(null);
    }
  }
  return (
    <dialog ref={dialog} onClose={onClose} aria-labelledby="remove-title" className={SHEET}>
      {open && (
        <form
          className="flex flex-col gap-3.5 px-4 pt-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))]"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!reason || busy) return;
            setBusy(true);
            setProblem(null);
            const result = await removeItemAction(itemId, reason).catch(() => ({ ok: false as const, message: OFFLINE }));
            setBusy(false);
            if (result.ok) onRemoved(reason, result.closedClaimName);
            else setProblem(result.message);
          }}
        >
          <div className="flex flex-col gap-1">
            <h2 id="remove-title" className="text-xl font-extrabold">
              Remove {itemId}
            </h2>
            <p className="text-[13px] leading-snug text-muted">It leaves the grid. You can restore it until the next clear-out. If someone has it claimed, their claim closes.</p>
          </div>
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-[13px] font-extrabold tracking-[0.05em] uppercase">Why</legend>
            {REASONS.map(([value, text]) => (
              <label key={value} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-line px-3 has-checked:border-ink">
                <input type="radio" name="reason" value={value} checked={reason === value} onChange={() => setReason(value)} className="h-5 w-5 accent-[var(--color-ink)]" />
                <span className="text-[15px] font-semibold">{text}</span>
              </label>
            ))}
          </fieldset>
          {problem && (
            <p role="alert" className="text-sm font-semibold text-bad">
              {problem}
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" aria-disabled={!reason || busy} className="btn bg-bad text-white hover:bg-bad hover:text-white aria-disabled:cursor-not-allowed aria-disabled:opacity-50">
              {busy ? "Removing…" : "Remove"}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}

/** *Replace photo*: crop the new photo as on *Add one from a photo*, then upload it. */
function PhotoSheet({
  picked,
  itemId,
  onClose,
  onReplaced,
}: {
  picked: { image: ImageBitmap; start: Box } | null;
  itemId: string;
  onClose: () => void;
  onReplaced: (photo: string) => void;
}) {
  const dialog = useModal(Boolean(picked));
  const [box, setBox] = useState<Box | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  // Start from the trim's box each time a photo is picked.
  const [shown, setShown] = useState(picked);
  if (picked !== shown) {
    setShown(picked);
    setBox(picked?.start ?? null);
    setProblem(null);
    setProgress(null);
  }

  const uploading = progress !== null;
  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      // Mid-upload the photo may already be on its way in: the sheet stays until the answer comes.
      onCancel={(event) => {
        if (uploading) event.preventDefault();
      }}
      aria-labelledby="photo-title"
      className={SHEET}
    >
      {picked && box && (
        <div className="flex flex-col gap-3 pt-3 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
          <h2 id="photo-title" className="px-4 text-xl font-extrabold">
            New photo for {itemId}
          </h2>
          <div className="h-[min(62dvh,440px)] bg-[#2A2E35]">
            <CropArea image={picked.image} box={box} onChange={(next) => progress === null && setBox(next)} label="The new photo" />
          </div>
          <div className="flex items-center justify-between gap-2 px-4">
            <span className="text-xs leading-snug text-muted">Drag the square to move it. Pinch, or drag its corner, to resize. Crop out any written name.</span>
            <button type="button" onClick={() => setBox(picked.start)} className="h-10 flex-none cursor-pointer px-2 text-sm font-bold text-brand">
              Reset
            </button>
          </div>
          {problem && (
            <p role="alert" className="px-4 text-sm font-semibold text-bad">
              {problem}
            </p>
          )}
          <div className="grid grid-cols-2 gap-2 px-4">
            <button
              type="button"
              className="btn-secondary aria-disabled:cursor-wait aria-disabled:opacity-50"
              aria-disabled={uploading}
              onClick={() => {
                if (!uploading) onClose();
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              aria-disabled={progress !== null}
              className="btn-primary aria-disabled:cursor-wait aria-disabled:opacity-60"
              onClick={async () => {
                if (progress !== null) return;
                setProgress(0);
                setProblem(null);
                try {
                  const images = await uploadImages(picked.image, boxRect(box));
                  const result = await uploadReplacementPhoto(itemId, images, setProgress);
                  if (result.ok) onReplaced(result.photo);
                  else setProblem(result.message);
                } catch {
                  setProblem("That photo couldn't be saved. Try again.");
                } finally {
                  setProgress(null);
                }
              }}
            >
              {progress === null ? "Use this photo" : `Saving… ${Math.round(progress * 100)}%`}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
