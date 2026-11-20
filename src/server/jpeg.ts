/**
 * A light check of an uploaded JPEG, without an image library (the server
 * uses none; spec: *Photos*). It walks the file's segments to read the
 * picture's size and drops the metadata ones: EXIF (which can hold GPS
 * position and the phone's model), XMP, comments and the like.
 *
 * Phones re-encode photos on a canvas before upload, which already leaves
 * the metadata out; this makes sure of it whatever sends the file.
 */

export interface CleanJpeg {
  width: number;
  height: number;
  bytes: Uint8Array;
}

/** APP1–APP13 and APP15 (EXIF, XMP, ICC lives in APP2 but canvases don't write it), and comments. APP0 (JFIF) and APP14 (Adobe color) stay. */
function isMetadata(marker: number): boolean {
  return (marker >= 0xe1 && marker <= 0xed) || marker === 0xef || marker === 0xfe;
}

/** Start-of-frame markers, which hold the picture's size. Not DHT (C4), JPG (C8) or DAC (CC). */
function isFrameHeader(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

/** The JPEG without its metadata, and its size; null if it isn't a well-formed JPEG. */
export function cleanJpeg(input: Uint8Array): CleanJpeg | null {
  if (input.length < 4 || input[0] !== 0xff || input[1] !== 0xd8) return null;
  const parts: Uint8Array[] = [input.subarray(0, 2)];
  let width = 0;
  let height = 0;
  let i = 2;
  let reachedScan = false;
  while (i + 1 < input.length) {
    if (input[i] !== 0xff) return null;
    // Any number of 0xFF fill bytes may come before a marker.
    let at = i + 1;
    while (at < input.length && input[at] === 0xff) at++;
    if (at >= input.length) return null;
    const marker = input[at];
    const start = at - 1;
    if (marker === 0xd9) break;
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      parts.push(input.subarray(start, at + 1));
      i = at + 1;
      continue;
    }
    if (at + 2 >= input.length) return null;
    const length = (input[at + 1] << 8) | input[at + 2];
    const end = at + 1 + length;
    if (length < 2 || end > input.length) return null;
    if (isFrameHeader(marker)) {
      if (length < 7) return null;
      height = (input[at + 4] << 8) | input[at + 5];
      width = (input[at + 6] << 8) | input[at + 7];
    }
    if (!isMetadata(marker)) parts.push(input.subarray(start, end));
    i = end;
    if (marker === 0xda) {
      // The compressed picture runs from here to the end of the file, end marker included.
      parts.push(input.subarray(i));
      reachedScan = true;
      break;
    }
  }
  if (!reachedScan || !width || !height) return null;
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return { width, height, bytes };
}
