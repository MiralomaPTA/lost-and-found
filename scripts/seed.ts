/**
 * Fills the local bucket with made-up items, so the grid, the item page and
 * claiming can be tried before anything has been photographed.
 *
 *   npm run seed            # 36 items
 *   npm run seed -- 120     # or as many as you like
 *
 * Local storage only (`STORAGE=local`, the default): it refuses to touch R2.
 * It reads no .env file. The photos are drawn shapes in each item's color,
 * saved as PNG. Delete `.data/` to start over.
 */
import { deflateSync, crc32 } from "node:zlib";
import { config } from "@/server/config";
import type { Deps } from "@/server/deps";
import { Docs } from "@/server/docs";
import { addItem, changeItems } from "@/server/items";
import { newPhotoNames, photoKey } from "@/server/photos";
import { loadSettings } from "@/server/settings";
import { getObjectStore } from "@/server/storage";

/** A phone that never visits: the seed's items are "added" by it. */
const SEED_PHONE = "5eed".repeat(8);
const BACKDROP: [number, number, number] = [0xdc, 0xef, 0xa2];

async function main() {
  if (config.storage !== "local") {
    console.error("The seed only writes to local storage. Unset STORAGE (or set STORAGE=local) and try again.");
    process.exit(1);
  }
  const count = Number(process.argv[2] ?? 36);
  if (!Number.isInteger(count) || count < 1 || count > 1000) {
    console.error("Give a number of items from 1 to 1000.");
    process.exit(1);
  }

  const store = await getObjectStore();
  const deps: Deps = { store, docs: new Docs(store, 0), now: () => new Date(), initialAdminCode: config.initialAdminCode };
  const settings = await loadSettings(deps);
  const types = settings.types.filter((t) => t.active).map((t) => t.name);
  const colors = settings.colors.filter((c) => c.active);
  const random = seededRandom(count);

  // Oldest first, so item numbers go up with the date added.
  const now = Date.now();
  const ages = Array.from({ length: count }, () => Math.floor(random() * 35 * 24 * 60 * 60 * 1000)).sort((a, b) => b - a);
  const planned: { type: string; color: string; has_name: boolean; photo: string; thumb: string; addedAt: Date }[] = [];
  for (const age of ages) {
    const type = types[Math.floor(random() * types.length)];
    const color = colors[Math.floor(random() * colors.length)];
    const hasName = random() < 0.3;
    const names = newPhotoNames("png");
    for (const [name, size] of [
      [names.photo, 800],
      [names.thumb, 400],
    ] as const) {
      await store.put(photoKey(name), drawItem(type, color.swatch, hasName, size), { contentType: "image/png" });
    }
    planned.push({ type, color: color.name, has_name: hasName, ...names, addedAt: new Date(now - age) });
  }

  const added = await changeItems(deps, (file) => {
    const items = planned.map((p) =>
      addItem(file, { type: p.type, color: p.color, has_name: p.has_name, photo: p.photo, thumb: p.thumb, phoneId: SEED_PHONE, name: "Seed data" }, p.addedAt),
    );
    return { value: file, result: items };
  });
  console.log(`Added ${added.length} items, ${added[0].id} to ${added[added.length - 1].id}, to ${config.localDataDir}/bucket.`);
}

/** The same "random" items for the same count, so runs are repeatable. */
function seededRandom(seed: number): () => number {
  let state = (seed * 2654435761) >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 2 ** 32;
  };
}

// --- Drawing: a flat shape for each type, on a lime backdrop like the photo spot's. ---

type Shape = (x: number, y: number) => boolean;

const rect = (x0: number, y0: number, x1: number, y1: number): Shape => (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
const circle = (cx: number, cy: number, r: number): Shape => (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
const ellipse = (cx: number, cy: number, rx: number, ry: number): Shape => (x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
const any = (...shapes: Shape[]): Shape => (x, y) => shapes.some((s) => s(x, y));
const minus = (a: Shape, b: Shape): Shape => (x, y) => a(x, y) && !b(x, y);

const TOP: Shape = any(rect(0.3, 0.3, 0.7, 0.86), rect(0.12, 0.3, 0.3, 0.7), rect(0.7, 0.3, 0.88, 0.7));

const SHAPES: Record<string, Shape> = {
  Jacket: minus(TOP, rect(0.495, 0.3, 0.505, 0.86)),
  Shirt: minus(any(rect(0.3, 0.3, 0.7, 0.82), rect(0.16, 0.3, 0.3, 0.48), rect(0.7, 0.3, 0.84, 0.48)), ellipse(0.5, 0.3, 0.08, 0.05)),
  Hoodie: any(TOP, circle(0.5, 0.27, 0.12)),
  Sweatshirt: any(TOP, rect(0.3, 0.8, 0.7, 0.86)),
  "Hat/Gloves": any(minus(circle(0.5, 0.62, 0.3), rect(0, 0.62, 1, 1)), rect(0.17, 0.6, 0.83, 0.7)),
  Shoes: any(ellipse(0.56, 0.6, 0.32, 0.14), rect(0.18, 0.42, 0.42, 0.72), rect(0.16, 0.7, 0.88, 0.76)),
  "Water bottle": any(rect(0.38, 0.28, 0.62, 0.88), ellipse(0.5, 0.28, 0.12, 0.05), rect(0.43, 0.14, 0.57, 0.26)),
  "Lunch box": any(rect(0.2, 0.36, 0.8, 0.8), minus(ellipse(0.5, 0.36, 0.14, 0.12), ellipse(0.5, 0.36, 0.09, 0.07))),
  Backpack: any(rect(0.26, 0.24, 0.74, 0.88), ellipse(0.5, 0.24, 0.24, 0.1), minus(ellipse(0.5, 0.18, 0.08, 0.07), ellipse(0.5, 0.18, 0.05, 0.04))),
  "Toy & sports": circle(0.5, 0.52, 0.32),
};
const OTHER: Shape = (x, y) => Math.abs(x - 0.5) + Math.abs(y - 0.52) <= 0.32;
const LABEL: Shape = rect(0.42, 0.5, 0.58, 0.57);
const RAINBOW: [number, number, number][] = [
  [0xd6, 0x3b, 0x33],
  [0xf2, 0xc2, 0x30],
  [0x3e, 0x9b, 0x5c],
  [0x2f, 0x6f, 0xd6],
  [0x7c, 0x5c, 0xc4],
];

function drawItem(type: string, swatch: string, hasName: boolean, size: number): Uint8Array {
  const shape = SHAPES[type] ?? OTHER;
  const base = swatch === "multicolor" ? null : hexRgb(swatch);
  const rgb = new Uint8Array(size * size * 3);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = px / size;
      const y = py / size;
      let color = BACKDROP;
      if (shape(x, y)) {
        const fill = base ?? RAINBOW[Math.floor(y * 10) % RAINBOW.length];
        // A little light from above, so flat colors look like cloth.
        const light = 1.1 - 0.2 * y;
        color = hasName && LABEL(x, y) ? [250, 250, 250] : (fill.map((c) => Math.min(255, Math.round(c * light))) as [number, number, number]);
      }
      rgb.set(color, (py * size + px) * 3);
    }
  }
  return png(size, size, rgb);
}

function hexRgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

/** A minimal PNG encoder: 8-bit RGB, no filtering, one IDAT chunk. */
function png(width: number, height: number, rgb: Uint8Array): Uint8Array {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) Buffer.from(rgb.subarray(y * width * 3, (y + 1) * width * 3)).copy(raw, y * (width * 3 + 1) + 1);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
