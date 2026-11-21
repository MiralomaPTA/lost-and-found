/**
 * A light check of an uploaded JPEG, without an image library (the server
 * uses none; spec: *Photos*). It walks every segment of the file, scans
 * included, keeping only what a browser needs to show the picture: the
 * tables, the frame header, the scans and the end marker. Metadata (EXIF,
 * which can hold GPS position and the phone's model; XMP; comments; the JFIF
 * header and any thumbnail it carries) is dropped wherever it sits, and so is
 * anything after the end of the picture (iPhones append extra images there).
 *
 * Phones re-encode photos on a canvas before upload, which already leaves
 * the metadata out; this makes sure of it whatever sends the file.
 */

export interface CleanJpeg {
  width: number;
  height: number;
  bytes: Uint8Array;
}

const SOI = 0xd8;
const EOI = 0xd9;
const SOS = 0xda;
const APP14 = 0xee;

/** Start-of-frame markers. Only baseline, extended and progressive Huffman (C0–C2) are accepted: what browsers decode. */
function isFrameHeader(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

/**
 * Whether a segment stays. All APPn segments and comments go, except a
 * standard Adobe APP14 (12 bytes of color-transform flags, no room for anything else).
 */
function keepSegment(marker: number, length: number): boolean {
  if (marker === APP14) return length === 14;
  if (marker >= 0xe0 && marker <= 0xef) return false;
  return marker !== 0xfe;
}

/** The JPEG without its metadata, and its size; null if it isn't a well-formed JPEG a browser will show. */
export function cleanJpeg(input: Uint8Array): CleanJpeg | null {
  if (input.length < 4 || input[0] !== 0xff || input[1] !== SOI) return null;
  const parts: Uint8Array[] = [input.subarray(0, 2)];
  let width = 0;
  let height = 0;
  let frames = 0;
  let scans = 0;
  let i = 2;
  for (;;) {
    if (i >= input.length || input[i] !== 0xff) return null;
    // Any number of 0xFF fill bytes may come before a marker.
    let at = i + 1;
    while (at < input.length && input[at] === 0xff) at++;
    if (at >= input.length) return null;
    const marker = input[at];
    const start = at - 1;

    if (marker === EOI) {
      if (!frames || !scans) return null;
      parts.push(input.subarray(start, at + 1));
      break; // Anything after the end of the picture is dropped.
    }
    // Markers without a length don't belong between segments.
    if (marker === SOI || marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) return null;

    if (at + 2 >= input.length) return null;
    const length = (input[at + 1] << 8) | input[at + 2];
    const end = at + 1 + length;
    if (length < 2 || end > input.length) return null;
    if (isFrameHeader(marker)) {
      if (marker > 0xc2 || frames > 0 || length < 8) return null;
      height = (input[at + 4] << 8) | input[at + 5];
      width = (input[at + 6] << 8) | input[at + 7];
      frames++;
    }
    if (keepSegment(marker, length)) parts.push(input.subarray(start, end));
    i = end;

    if (marker === SOS) {
      if (!frames) return null;
      scans++;
      // The compressed data runs to the next marker. In it, 0xFF is followed
      // by 0x00 (an escaped byte) or a restart marker; anything else ends it.
      let j = i;
      for (;;) {
        if (j + 1 >= input.length) return null; // no end marker
        if (input[j] === 0xff) {
          const next = input[j + 1];
          if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      parts.push(input.subarray(i, j));
      i = j;
    }
  }
  if (!width || !height) return null;
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return { width, height, bytes };
}
