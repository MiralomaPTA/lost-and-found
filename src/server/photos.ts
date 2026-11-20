import { randomBytes } from "node:crypto";

/**
 * Photos live in the bucket under random names, `photos/<32 hex>.jpg` and
 * `photos/<32 hex>-thumb.jpg`, and are served at `/photos/<name>`. The names
 * can't be guessed; a replaced photo gets a new name, so a cached copy is
 * never served for the wrong item. PNG is accepted too (the dev seed makes
 * PNGs, since the server has no JPEG encoder).
 */
export const PHOTO_NAME = /^[0-9a-f]{32}(-thumb)?\.(jpg|png)$/;

/** Each photo is kept by the CDN for good: its name never points at anything else. */
export const PHOTO_CACHE_CONTROL = "public, max-age=31536000, immutable";

export function isPhotoName(name: unknown): name is string {
  return typeof name === "string" && PHOTO_NAME.test(name);
}

export function photoKey(name: string): string {
  if (!isPhotoName(name)) throw new Error("Not a photo name");
  return `photos/${name}`;
}

export function photoUrl(name: string): string {
  return `/photos/${name}`;
}

export function photoContentType(name: string): string {
  return name.endsWith(".png") ? "image/png" : "image/jpeg";
}

export function newPhotoNames(extension: "jpg" | "png" = "jpg"): { photo: string; thumb: string } {
  const id = randomBytes(16).toString("hex");
  return { photo: `${id}.${extension}`, thumb: `${id}-thumb.${extension}` };
}
