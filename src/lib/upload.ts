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
  return new Promise((resolve) => {
    const request = new XMLHttpRequest();
    request.open("POST", "/api/items");
    request.timeout = 90_000;
    request.responseType = "json";
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    request.onload = () => {
      const body = request.response as { ok?: boolean; id?: string; message?: string } | null;
      if (body?.ok && body.id) resolve({ ok: true, id: body.id });
      // Busy, or a server hiccup: worth retrying. A refused upload isn't, as is.
      else resolve({ ok: false, message: body?.message ?? "That didn't save. Retry.", retry: request.status >= 500 || request.status === 0 });
    };
    request.onerror = () => resolve({ ok: false, message: OFFLINE, retry: true });
    request.ontimeout = () => resolve({ ok: false, message: OFFLINE, retry: true });
    request.send(form);
  });
}
