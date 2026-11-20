import type { NextRequest } from "next/server";
import { getDeps } from "@/server/deps";
import { isPhotoName, PHOTO_CACHE_CONTROL, photoContentType, photoKey } from "@/server/photos";

/**
 * A photo or thumbnail from the bucket. The names are random, so there's no
 * code check here, and the CDN can keep each one for a day: the bucket is
 * read about once a day per photo (spec: *Photos*).
 */
export async function GET(_request: NextRequest, context: RouteContext<"/photos/[name]">) {
  const { name } = await context.params;
  if (!isPhotoName(name)) return notFound();
  const deps = await getDeps();
  const object = await deps.store.get(photoKey(name));
  if (!object) return notFound();
  return new Response(Buffer.from(object.body), {
    headers: {
      // From the name, never from what was stored: only images are served here.
      "Content-Type": photoContentType(name),
      "Cache-Control": PHOTO_CACHE_CONTROL,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}

function notFound() {
  // Not cached: a photo that's still uploading may be there in a moment.
  return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
}
