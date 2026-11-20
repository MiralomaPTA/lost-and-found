import { describe, expect, it } from "vitest";
import { clampBox, initialBox, minBoxSize, moveBox, resizeFromCorner, scaleBox } from "@/lib/image/crop-box";
import { findTrim, scaleRect } from "@/lib/image/trim";
import { cleanJpeg } from "@/server/jpeg";
import { fakeJpeg } from "./helpers";

const text = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes);

describe("cleaning a JPEG", () => {
  it("reads the size and drops EXIF and comments, keeping the picture", () => {
    const input = fakeJpeg(1600, 1200, { exif: true });
    const clean = cleanJpeg(input)!;
    expect(clean).toMatchObject({ width: 1600, height: 1200 });
    expect(text(input)).toMatch(/GPS/);
    expect(text(clean.bytes)).not.toMatch(/GPS|Exif|comment/);
    expect(text(clean.bytes)).toMatch(/JFIF/);
    // Everything from the scan on is untouched, end marker included.
    expect([...clean.bytes.slice(-7)]).toEqual([0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd9]);
    expect(clean.bytes.length).toBeLessThan(input.length);
  });

  it("reads progressive JPEGs too", () => {
    expect(cleanJpeg(fakeJpeg(400, 300, { progressive: true }))).toMatchObject({ width: 400, height: 300 });
  });

  it("refuses what isn't a whole JPEG", () => {
    const good = fakeJpeg(100, 100);
    expect(cleanJpeg(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
    expect(cleanJpeg(good.slice(0, 40))).toBeNull();
    expect(cleanJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toBeNull();
    const noSize = Uint8Array.from(good);
    noSize.set([0, 0, 0, 0], good.indexOf(0xc0) + 4);
    expect(cleanJpeg(noSize)).toBeNull();
  });
});

/** A width × height RGBA image of `background`, with `item` drawn in `color`. */
function picture(width: number, height: number, background: number[], item?: { x: number; y: number; w: number; h: number; color: number[] }) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const inside = item && x >= item.x && x < item.x + item.w && y >= item.y && y < item.y + item.h;
      data.set([...(inside ? item.color : background), 255], (y * width + x) * 4);
    }
  }
  return data;
}

const LIME = [168, 216, 78];
const RED = [214, 59, 51];

describe("the backdrop trim", () => {
  it("finds an item on a plain backdrop, with a margin", () => {
    const data = picture(160, 160, LIME, { x: 50, y: 40, w: 40, h: 60, color: RED });
    // The margin is 8% of the larger side (60): 5 px.
    expect(findTrim(data, 160, 160)).toEqual({ x: 45, y: 35, w: 50, h: 70 });
  });

  it("ignores a little noise and a gently uneven backdrop", () => {
    const data = picture(160, 160, LIME, { x: 60, y: 60, w: 30, h: 30, color: RED });
    for (let y = 0; y < 160; y++) {
      for (let x = 0; x < 160; x++) {
        const i = (y * 160 + x) * 4;
        // Darker toward the bottom, as poster board under a lamp.
        if (!(x >= 60 && x < 90 && y >= 60 && y < 90)) data[i + 1] = LIME[1] - Math.round(y / 8);
      }
    }
    data.set([0, 0, 0, 255], (10 * 160 + 10) * 4); // one dark speck
    expect(findTrim(data, 160, 160)).toEqual({ x: 58, y: 58, w: 34, h: 34 });
  });

  it("gives up on a busy background, an empty backdrop or an item filling the frame", () => {
    const busy = picture(100, 100, LIME);
    for (let i = 0; i < busy.length; i += 4) if ((i / 4) % 3 === 0) busy.set([20, 20, 200], i);
    expect(findTrim(busy, 100, 100)).toBeNull();
    expect(findTrim(picture(100, 100, LIME), 100, 100)).toBeNull();
    expect(findTrim(picture(100, 100, LIME, { x: 3, y: 3, w: 94, h: 94, color: RED }), 100, 100)).toBeNull();
  });

  it("maps a box from the small copy back to the photo", () => {
    expect(scaleRect({ x: 45, y: 35, w: 50, h: 70 }, 10, { x: 100, y: 0, w: 1600, h: 1600 })).toEqual({ x: 550, y: 350, w: 500, h: 700 });
  });
});

describe("the crop box", () => {
  const W = 4000;
  const H = 3000;

  it("starts as the largest square in the middle, or around what the trim found", () => {
    expect(initialBox(W, H, null)).toEqual({ x: 500, y: 0, size: 3000 });
    expect(initialBox(W, H, { x: 1000, y: 1000, w: 600, h: 400 })).toEqual({ x: 1000, y: 900, size: 600 });
    // Near an edge, it's pushed back inside the photo.
    expect(initialBox(W, H, { x: 3700, y: 2800, w: 300, h: 200 })).toEqual({ x: 3400, y: 2400, size: minBoxSize(W, H) });
  });

  it("moves, but never off the photo", () => {
    const box = { x: 1000, y: 1000, size: 1000 };
    expect(moveBox(box, 200, -300, W, H)).toEqual({ x: 1200, y: 700, size: 1000 });
    expect(moveBox(box, 9000, 9000, W, H)).toEqual({ x: 3000, y: 2000, size: 1000 });
  });

  it("resizes from its corner, within the photo and no smaller than the minimum", () => {
    const box = { x: 1000, y: 1000, size: 1000 };
    expect(resizeFromCorner(box, 300, 100, W, H)).toEqual({ x: 1000, y: 1000, size: 1300 });
    expect(resizeFromCorner(box, 9000, 0, W, H)).toEqual({ x: 1000, y: 1000, size: 2000 });
    expect(resizeFromCorner(box, -9000, 0, W, H).size).toBe(minBoxSize(W, H));
  });

  it("pinches around its middle", () => {
    expect(scaleBox({ x: 1000, y: 1000, size: 1000 }, 0.8, W, H)).toEqual({ x: 1100, y: 1100, size: 800 });
    expect(clampBox({ x: -50, y: 2900, size: 5000 }, W, H)).toEqual({ x: 0, y: 0, size: 3000 });
  });
});
