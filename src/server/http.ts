import type { NextRequest } from "next/server";

/** Helpers for the routes that take uploads. */

export function answer(status: number, body: Record<string, unknown>) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * Only this site's own pages may post uploads. The cookies are SameSite=Lax,
 * which already keeps them off other sites' posts; this is a second check.
 */
export function fromThisSite(request: NextRequest): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") return false;
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * The request body, or null once it passes `limit`. Counted as it arrives,
 * so a body sent without a Content-Length (chunked) is capped too.
 */
export async function readBody(request: NextRequest, limit: number): Promise<Uint8Array<ArrayBuffer> | null> {
  if (Number(request.headers.get("content-length") ?? 0) > limit) return null;
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }
  return body;
}

/** The multipart form in `body`, or null if it doesn't parse. */
export async function formOf(request: NextRequest, body: Uint8Array<ArrayBuffer>): Promise<FormData | null> {
  try {
    return await new Response(body, { headers: { "content-type": request.headers.get("content-type") ?? "" } }).formData();
  } catch {
    return null;
  }
}

export async function bytesOf(value: FormDataEntryValue | null): Promise<Uint8Array | null> {
  return value instanceof Blob ? new Uint8Array(await value.arrayBuffer()) : null;
}
