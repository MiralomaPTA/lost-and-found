/**
 * The automatic crop for bulk add (spec: *Cropped to the item,
 * automatically*), on a small copy of the photo. It takes the backdrop's
 * color from the photo's edges, moves each edge inward until it reaches
 * pixels that differ from it, and adds a margin. No model, no cost.
 *
 * Pure, so it can be tested: the browser hands it the pixels.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TrimOptions {
  /** How far (in RGB distance, 0–441) a pixel can be from the backdrop and still count as backdrop. */
  tolerance?: number;
  /** The share of a row or column that can differ (shadow specks, noise) and still count as backdrop. */
  noise?: number;
  /** The share of edge pixels that must look like the backdrop, or the background is too busy to trim. */
  plainEdges?: number;
  /** Margin around the item, as a share of its larger side. */
  margin?: number;
}

const DEFAULTS: Required<TrimOptions> = { tolerance: 48, noise: 0.02, plainEdges: 0.85, margin: 0.08 };

/**
 * The item's box, with a margin, in the same pixels as `data` (RGBA,
 * `width` × `height`). Null when there's no clear edge: a busy background,
 * nothing on the backdrop, or an item filling the frame.
 */
export function findTrim(data: Uint8ClampedArray | Uint8Array, width: number, height: number, options: TrimOptions = {}): Rect | null {
  const { tolerance, noise, plainEdges, margin } = { ...DEFAULTS, ...options };
  if (width < 8 || height < 8 || data.length < width * height * 4) return null;

  // The backdrop: the middle value of each channel around the outer two pixels.
  const edge: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x < 2 || y < 2 || x >= width - 2 || y >= height - 2) edge.push((y * width + x) * 4);
    }
  }
  const median = (channel: number) => {
    const values = edge.map((i) => data[i + channel]).sort((a, b) => a - b);
    return values[values.length >> 1];
  };
  const backdrop = [median(0), median(1), median(2)];
  const limit = tolerance * tolerance;
  const differs = (i: number) => {
    const dr = data[i] - backdrop[0];
    const dg = data[i + 1] - backdrop[1];
    const db = data[i + 2] - backdrop[2];
    return dr * dr + dg * dg + db * db > limit;
  };

  const plain = edge.filter((i) => !differs(i)).length / edge.length;
  if (plain < plainEdges) return null;

  const rowHasItem = (y: number) => {
    let count = 0;
    for (let x = 0; x < width; x++) if (differs((y * width + x) * 4)) count++;
    return count > Math.max(1, noise * width);
  };
  const columnHasItem = (x: number, top: number, bottom: number) => {
    let count = 0;
    for (let y = top; y <= bottom; y++) if (differs((y * width + x) * 4)) count++;
    return count > Math.max(1, noise * (bottom - top + 1));
  };

  let top = 0;
  while (top < height && !rowHasItem(top)) top++;
  if (top === height) return null;
  let bottom = height - 1;
  while (bottom > top && !rowHasItem(bottom)) bottom--;
  let left = 0;
  while (left < width && !columnHasItem(left, top, bottom)) left++;
  let right = width - 1;
  while (right > left && !columnHasItem(right, top, bottom)) right--;
  if (left >= width) return null;

  const w = right - left + 1;
  const h = bottom - top + 1;
  // Too small to be an item (a speck), or nearly the whole frame (nothing to trim).
  if (w < width * 0.04 || h < height * 0.04) return null;
  if (w > width * 0.92 && h > height * 0.92) return null;

  const pad = Math.round(Math.max(w, h) * margin);
  const x0 = Math.max(0, left - pad);
  const y0 = Math.max(0, top - pad);
  const x1 = Math.min(width, right + 1 + pad);
  const y1 = Math.min(height, bottom + 1 + pad);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** A rect found on a scaled copy, back in the original's pixels, kept inside `bounds`. */
export function scaleRect(rect: Rect, factor: number, bounds: Rect): Rect {
  const x = Math.max(bounds.x, Math.floor(bounds.x + rect.x * factor));
  const y = Math.max(bounds.y, Math.floor(bounds.y + rect.y * factor));
  const right = Math.min(bounds.x + bounds.w, Math.ceil(bounds.x + (rect.x + rect.w) * factor));
  const bottom = Math.min(bounds.y + bounds.h, Math.ceil(bounds.y + (rect.y + rect.h) * factor));
  return { x, y, w: right - x, h: bottom - y };
}
