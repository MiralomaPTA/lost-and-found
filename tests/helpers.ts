import type { Deps } from "@/server/deps";
import { Docs } from "@/server/docs";
import { memoryObjectStore } from "@/server/storage/memory";
import type { ObjectStore } from "@/server/storage/types";

/** An in-memory bucket and a clock the test can move. */
export function testDeps({ initialAdminCode = "maple otter river", start = "2026-12-07T16:00:00Z", store = memoryObjectStore() }: { initialAdminCode?: string | null; start?: string; store?: ObjectStore } = {}) {
  let now = new Date(start);
  const deps: Deps = { store, docs: new Docs(store, 0), now: () => now, initialAdminCode };
  return {
    deps,
    store,
    advance(ms: number) {
      now = new Date(now.getTime() + ms);
    },
  };
}

/**
 * A bucket where someone else writes `key` just before each of our next
 * `times` writes to it, so our conditional write loses the race.
 */
export function racingStore(
  inner: ObjectStore,
  key: string,
  times: number,
  rivalBody?: string,
): ObjectStore & { puts: () => number; saved: () => number; arm: (times: number) => void } {
  let left = times;
  let puts = 0;
  let saved = 0;
  return {
    ...inner,
    async put(k, body, options) {
      if (k === key) {
        puts++;
        if (left > 0) {
          left--;
          // By default the rival writes back what's there, which still changes the ETag.
          const rival = rivalBody !== undefined ? new TextEncoder().encode(rivalBody) : ((await inner.get(k))?.body ?? new TextEncoder().encode("{}"));
          await inner.put(k, rival);
        }
      }
      const result = await inner.put(k, body, options);
      if (k === key && result.ok) saved++;
      return result;
    },
    /** Our writes to the key, including ones that lost. */
    puts: () => puts,
    /** Our writes to the key that succeeded. */
    saved: () => saved,
    /** Make the rival win our next `times` writes. */
    arm(times: number) {
      left = times;
    },
  };
}

/** Phone IDs for tests: 32 hex characters, like the real ones. */
export const PHONE_A = "a".repeat(32);
export const PHONE_B = "b".repeat(32);
export const PHONE_C = "c".repeat(32);

let photoCounter = 0;

/** A photo name pair like the app's. */
export function photoNames(): { photo: string; thumb: string } {
  const id = (++photoCounter).toString(16).padStart(32, "0");
  return { photo: `${id}.jpg`, thumb: `${id}-thumb.jpg` };
}

export interface FakeJpegOptions {
  /** An EXIF block (with "GPS" in it) and a comment before the frame, which the server must drop. */
  exif?: boolean;
  progressive?: boolean;
  /** Another frame-header marker instead of C0/C2, e.g. 0xc9 (arithmetic). */
  frameMarker?: number;
  /** Segments between a first and second scan (a progressive JPEG has several). */
  betweenScans?: number[][];
  /** Bytes after the end marker. */
  trailing?: number[];
  /** Leave off the end marker. */
  noEnd?: boolean;
  /** A second frame header. */
  twoFrames?: boolean;
}

/** A JPEG segment: marker, length, body. */
export function jpegSegment(marker: number, body: number[]): number[] {
  return [0xff, marker, ((body.length + 2) >> 8) & 0xff, (body.length + 2) & 0xff, ...body];
}

export const ascii = (text: string) => Array.from(text, (c) => c.charCodeAt(0));

/** A JPEG's structure without real picture data: enough for the server's segment walk. */
export function fakeJpeg(width: number, height: number, options: FakeJpegOptions = {}): Uint8Array {
  const { exif = false, progressive = false, frameMarker, betweenScans, trailing = [], noEnd = false, twoFrames = false } = options;
  const frame = jpegSegment(frameMarker ?? (progressive ? 0xc2 : 0xc0), [8, height >> 8, height & 0xff, width >> 8, width & 0xff, 1, 1, 0x11, 0]);
  const scan = [...jpegSegment(0xda, [1, 1, 0, 0, 63, 0]), 0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd0, 0x78];
  const bytes = [
    0xff, 0xd8,
    ...jpegSegment(0xe0, [...ascii("JFIF"), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    ...(exif ? jpegSegment(0xe1, [...ascii("Exif"), 0, 0, ...ascii("GPS 37.73N 122.44W iPhone")]) : []),
    ...(exif ? jpegSegment(0xfe, ascii("a comment")) : []),
    ...jpegSegment(0xdb, [0, ...new Array(64).fill(1)]),
    ...frame,
    ...(twoFrames ? frame : []),
    ...jpegSegment(0xc4, [0, ...new Array(16).fill(0), 0]),
    ...scan,
    ...(betweenScans ? [...betweenScans.flat(), ...scan] : []),
    ...(noEnd ? [] : [0xff, 0xd9]),
    ...trailing,
  ];
  return new Uint8Array(bytes);
}
