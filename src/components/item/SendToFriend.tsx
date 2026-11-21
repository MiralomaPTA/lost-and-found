"use client";

import { useEffect, useState } from "react";

/**
 * *Send to a friend* on the item page, for someone who recognizes a friend's
 * things. The photo itself goes through the phone's share sheet, with a line
 * saying where it is and a link to the item (which needs the school code to
 * open). Without a share sheet that takes files, the photo is copied to paste
 * instead, and failing that, the line and link are.
 *
 * The photo is fetched when the page opens, from the browser's cache since the
 * page already shows it: Safari opens the share sheet only straight from a
 * tap, with nothing awaited first.
 */
export function SendToFriend({ src, itemId }: { src: string; itemId: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let current = true;
    fetch(src)
      .then((response) => (response.ok ? response.blob() : null))
      .then((blob) => {
        if (!current || !blob) return;
        const extension = blob.type === "image/png" ? "png" : "jpg";
        setFile(new File([blob], `lost-and-found-${itemId}.${extension}`, { type: blob.type }));
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [src, itemId]);

  function send() {
    setMessage("");
    const text = `Is this yours? It's in the Miraloma lost and found: ${window.location.origin}/items/${itemId}`;
    const failed = () => setMessage("Couldn't send it from here. Press and hold the photo to save or share it instead.");

    if (file && navigator.canShare?.({ files: [file] })) {
      navigator.share({ files: [file], text }).catch((error: unknown) => {
        if ((error as Error)?.name !== "AbortError") failed();
      });
      return;
    }
    if (file && navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
      // The promise goes into the ClipboardItem so the copy itself still happens within the tap.
      navigator.clipboard.write([new ClipboardItem({ "image/png": asPng(file) })]).then(
        () => setMessage("Photo copied. Paste it into a message to a friend."),
        () => copyText(text),
      );
      return;
    }
    if (navigator.share) {
      navigator.share({ text }).catch((error: unknown) => {
        if ((error as Error)?.name !== "AbortError") failed();
      });
      return;
    }
    copyText(text);

    function copyText(value: string) {
      if (!navigator.clipboard?.writeText) return failed();
      navigator.clipboard.writeText(value).then(() => setMessage("Link copied. Paste it into a message to a friend."), failed);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <button type="button" onClick={send} className="btn-secondary w-full">
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3v12M7 8l5-5 5 5" />
          <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
        </svg>
        Send to a friend
      </button>
      {/* Always there, so a screen reader hears the message when it appears. */}
      <p role="status" className="text-center text-[13px] text-muted empty:hidden">
        {message}
      </p>
    </div>
  );
}

/** Browsers copy images to the clipboard only as PNG. */
async function asPng(file: File): Promise<Blob> {
  if (file.type === "image/png") return file;
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
  bitmap.close();
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("No PNG"))), "image/png"));
}
