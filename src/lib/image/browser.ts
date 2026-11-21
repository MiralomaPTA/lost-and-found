import { findTrim, scaleRect, type Rect } from "@/lib/image/trim";

/*
 * Photo work in the browser (spec: *Photos*): reading a photo, trimming the
 * backdrop, and making the upload's JPEGs, the photo at most 1600 px and the
 * thumbnail 400 px. Drawing on a canvas also leaves out the camera's
 * metadata, GPS position included, and bakes in the photo's rotation.
 *
 * HEIC from an iPhone's camera roll: Safari reads it natively, and iOS hands
 * a file picker a JPEG copy anyway. A browser that can't read a format says
 * so (decodeImage throws) and the page asks for another photo.
 */

export type Source = HTMLCanvasElement | ImageBitmap;

export const PHOTO_SIDE = 1600;
export const THUMB_SIDE = 400;
/** The size of the copy the trim looks at: plenty to find an edge, and fast. */
const TRIM_SAMPLE = 160;

export class UnreadablePhotoError extends Error {}

/** Reads a chosen or captured photo, upright. */
export async function decodeImage(file: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    // Older Safari: go through an <img>, which also applies the rotation.
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return await createImageBitmap(img);
    } catch {
      throw new UnreadablePhotoError("This photo couldn't be read here.");
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

export function sizeOf(source: Source): { width: number; height: number } {
  return { width: source.width, height: source.height };
}

/**
 * A canvas holding `region` of `source` (the frozen frame in bulk add), at
 * most `maxSide` across: more than the 1600 px photo needs, and small
 * enough that iOS's limit on canvas memory isn't reached over a long run.
 */
export function copyRegion(source: CanvasImageSource, region: Rect, maxSide = 2048): HTMLCanvasElement {
  const scale = Math.min(1, maxSide / Math.max(region.w, region.h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(region.w * scale);
  canvas.height = Math.round(region.h * scale);
  const context = canvas.getContext("2d")!;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, region.x, region.y, region.w, region.h, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Frees a canvas's memory now rather than whenever it's collected (iOS counts it until then). */
export function releaseCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}

/** Where the backdrop trim would crop `region` of `source`, in `source`'s pixels, or null. */
export function trimRegion(source: Source, region: Rect): Rect | null {
  const factor = Math.max(region.w, region.h) / TRIM_SAMPLE;
  const w = Math.max(8, Math.round(region.w / factor));
  const h = Math.max(8, Math.round(region.h / factor));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.drawImage(source, region.x, region.y, region.w, region.h, 0, 0, w, h);
  const found = findTrim(context.getImageData(0, 0, w, h).data, w, h);
  return found ? scaleRect(found, region.w / w, region) : null;
}

/** `crop` of `source` as a JPEG no larger than `maxSide`, on white (for photos with see-through parts). */
export function encodeJpeg(source: Source, crop: Rect, maxSide: number, quality: number): Promise<Blob> {
  const scale = Math.min(1, maxSide / Math.max(crop.w, crop.h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(crop.w * scale));
  canvas.height = Math.max(1, Math.round(crop.h * scale));
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingQuality = "high";
  context.drawImage(source, crop.x, crop.y, crop.w, crop.h, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Couldn't make the JPEG"))), "image/jpeg", quality));
}

/** The two JPEGs an add uploads. */
export async function uploadImages(source: Source, crop: Rect): Promise<{ photo: Blob; thumb: Blob }> {
  const [photo, thumb] = await Promise.all([encodeJpeg(source, crop, PHOTO_SIDE, 0.85), encodeJpeg(source, crop, THUMB_SIDE, 0.8)]);
  return { photo, thumb };
}

/** Draws `crop` of `source` into `canvas`, fitted and centered, at the screen's pixel density. */
export function drawPreview(canvas: HTMLCanvasElement, source: Source, crop: Rect): void {
  const ratio = window.devicePixelRatio || 1;
  const box = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(box.width * ratio));
  canvas.height = Math.max(1, Math.round(box.height * ratio));
  const scale = Math.min(canvas.width / crop.w, canvas.height / crop.h);
  const w = crop.w * scale;
  const h = crop.h * scale;
  const context = canvas.getContext("2d")!;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingQuality = "high";
  context.drawImage(source, crop.x, crop.y, crop.w, crop.h, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
}

/** A new random upload reference (32 hex characters), so a retry can't add the item twice. */
export function newClientRef(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
