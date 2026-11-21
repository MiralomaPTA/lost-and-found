/**
 * Sends one item to POST /api/items. XMLHttpRequest rather than fetch, for
 * its upload progress, which the add screens show (spec: *Saving doesn't wait*).
 */

export interface ItemUpload {
  photo: Blob;
  thumb: Blob;
  type: string;
  color: string;
  hasName: boolean;
  clientRef: string;
}

export type UploadResult = { ok: true; id: string } | { ok: false; message: string; retry: boolean };

const OFFLINE = "Couldn't reach the lost and found. Check the connection and retry.";

export function uploadItem(upload: ItemUpload, onProgress: (fraction: number) => void): Promise<UploadResult> {
  const form = new FormData();
  form.set("photo", upload.photo, "photo.jpg");
  form.set("thumb", upload.thumb, "thumb.jpg");
  form.set("type", upload.type);
  form.set("color", upload.color);
  form.set("has_name", upload.hasName ? "1" : "0");
  form.set("client_ref", upload.clientRef);
  return post("/api/items", form, onProgress).then((answer): UploadResult => {
    if (!answer.ok) return { ok: false, message: answer.message, retry: answer.retry };
    return typeof answer.body.id === "string" ? { ok: true, id: answer.body.id } : { ok: false, message: "That didn't save. Retry.", retry: true };
  });
}

/** An admin's *Replace photo*: answers the new photo's name. */
export function uploadReplacementPhoto(itemId: string, images: { photo: Blob; thumb: Blob }, onProgress: (fraction: number) => void): Promise<{ ok: true; photo: string } | { ok: false; message: string }> {
  const form = new FormData();
  form.set("photo", images.photo, "photo.jpg");
  form.set("thumb", images.thumb, "thumb.jpg");
  return post(`/api/items/${encodeURIComponent(itemId)}/photo`, form, onProgress).then((answer) => {
    if (!answer.ok) return { ok: false as const, message: answer.message };
    return typeof answer.body.photo === "string" ? { ok: true as const, photo: answer.body.photo } : { ok: false as const, message: "That didn't save. Try again." };
  });
}

type Posted = { ok: true; body: Record<string, unknown> } | { ok: false; message: string; retry: boolean };

function post(url: string, form: FormData, onProgress: (fraction: number) => void): Promise<Posted> {
  return new Promise((resolve) => {
    const request = new XMLHttpRequest();
    request.open("POST", url);
    request.timeout = 90_000;
    request.responseType = "json";
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    request.onload = () => {
      const body = (request.response ?? {}) as Record<string, unknown>;
      if (body.ok === true) resolve({ ok: true, body });
      // Busy, or a server hiccup: worth retrying. A refused upload isn't, as is.
      else resolve({ ok: false, message: typeof body.message === "string" ? body.message : "That didn't save. Retry.", retry: request.status >= 500 || request.status === 0 });
    };
    request.onerror = () => resolve({ ok: false, message: OFFLINE, retry: true });
    request.ontimeout = () => resolve({ ok: false, message: OFFLINE, retry: true });
    request.send(form);
  });
}
