import type { Rect } from "@/lib/image/trim";

/**
 * The square crop box on *Add one from a photo* (spec: *Crop by hand*), in
 * the photo's own pixels. Pure, so the geometry can be tested; the page turns
 * drags and pinches into these calls.
 */
export interface Box {
  x: number;
  y: number;
  size: number;
}

/** The smallest box: a fifth of the photo's short side, so it stays easy to grab. */
export function minBoxSize(width: number, height: number): number {
  return Math.max(16, Math.round(Math.min(width, height) / 5));
}

/** Keeps the box square, inside the photo and no smaller than the minimum. */
export function clampBox(box: Box, width: number, height: number): Box {
  const size = Math.min(Math.max(box.size, minBoxSize(width, height)), Math.min(width, height));
  return {
    size,
    x: Math.min(Math.max(box.x, 0), width - size),
    y: Math.min(Math.max(box.y, 0), height - size),
  };
}

/**
 * Where the box starts: around what the backdrop trim found, if anything, or
 * else the largest square in the middle of the photo.
 */
export function initialBox(width: number, height: number, trim: Rect | null): Box {
  if (!trim) {
    const size = Math.min(width, height);
    return { x: Math.round((width - size) / 2), y: Math.round((height - size) / 2), size };
  }
  const size = Math.max(trim.w, trim.h);
  return clampBox({ x: Math.round(trim.x + trim.w / 2 - size / 2), y: Math.round(trim.y + trim.h / 2 - size / 2), size }, width, height);
}

export function moveBox(box: Box, dx: number, dy: number, width: number, height: number): Box {
  return clampBox({ ...box, x: box.x + dx, y: box.y + dy }, width, height);
}

/** Dragging the corner handle (bottom right): the top-left corner stays put. */
export function resizeFromCorner(box: Box, dx: number, dy: number, width: number, height: number): Box {
  const grow = Math.abs(dx) > Math.abs(dy) ? dx : dy;
  const room = Math.min(width - box.x, height - box.y);
  const size = Math.min(Math.max(box.size + grow, minBoxSize(width, height)), room);
  return { ...box, size };
}

/** Pinching: the box grows or shrinks around its middle. */
export function scaleBox(box: Box, factor: number, width: number, height: number): Box {
  const size = box.size * factor;
  const cx = box.x + box.size / 2;
  const cy = box.y + box.size / 2;
  return clampBox({ x: cx - size / 2, y: cy - size / 2, size }, width, height);
}

export function boxRect(box: Box): Rect {
  return { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.size), h: Math.round(box.size) };
}
