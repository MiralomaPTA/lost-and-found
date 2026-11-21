import type { NextRequest } from "next/server";
import { addUploadedItem, PHOTO_MAX_BYTES, THUMB_MAX_BYTES } from "@/server/adding";
import { getDeps } from "@/server/deps";
import { getVisitor, readYourWrites } from "@/server/session";

/**
 * POST /api/items: one item from the add screens, as multipart form data
 * (`photo`, `thumb`, `type`, `color`, `has_name`, `client_ref`).
 *
 * A route rather than a server action so the page can show upload progress.
 * It answers JSON: `{ ok: true, id }` or `{ ok: false, reason, message }`.
 */

/** The two photos plus the form fields, with room to spare. Vercel refuses bodies over 4.5 MB before they get here. */
const MAX_BODY = PHOTO_MAX_BYTES + THUMB_MAX_BYTES + 100_000;

function answer(status: number, body: Record<string, unknown>) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * Only this site's own pages may post here. The cookies are SameSite=Lax,
 * which already keeps them off other sites' posts; this is a second check.
 */
function fromThisSite(request: NextRequest): boolean {
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
async function readBody(request: NextRequest, limit: number): Promise<Uint8Array<ArrayBuffer> | null> {
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

async function bytesOf(value: FormDataEntryValue | null): Promise<Uint8Array | null> {
  return value instanceof Blob ? new Uint8Array(await value.arrayBuffer()) : null;
}

export async function POST(request: NextRequest) {
  if (!fromThisSite(request)) return answer(403, { ok: false, reason: "forbidden", message: "This can only be sent from the lost-and-found site." });
  const tooBig = () => answer(413, { ok: false, reason: "too-big", message: "That photo is too big to upload. Take it again." });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) return tooBig();

  const visitor = await getVisitor();
  if (!visitor.canBrowse || !visitor.phoneId) return answer(401, { ok: false, reason: "no-code", message: "Enter the school code first." });
  const name = visitor.device?.name;
  if (!name) return answer(409, { ok: false, reason: "need-name", message: "Give this phone a name first, on the Add page." });

  const body = await readBody(request, MAX_BODY);
  if (!body) return tooBig();
  let form: FormData;
  try {
    form = await new Response(body, { headers: { "content-type": request.headers.get("content-type") ?? "" } }).formData();
  } catch {
    return answer(400, { ok: false, reason: "bad-request", message: "That upload didn't come through. Try again." });
  }
  const photo = await bytesOf(form.get("photo"));
  const thumb = await bytesOf(form.get("thumb"));
  if (!photo || !thumb) return answer(400, { ok: false, reason: "bad-request", message: "That upload didn't come through. Try again." });

  const deps = await getDeps();
  const result = await addUploadedItem(
    deps,
    visitor.settings,
    { phoneId: visitor.phoneId, name, isAdmin: visitor.isAdmin },
    {
      photo,
      thumb,
      type: String(form.get("type") ?? ""),
      color: String(form.get("color") ?? ""),
      hasName: form.get("has_name") === "1",
      clientRef: String(form.get("client_ref") ?? ""),
    },
  );
  if (!result.ok) return answer(result.reason === "busy" ? 503 : 400, result);
  await readYourWrites();
  return answer(result.existing ? 200 : 201, { ok: true, id: result.item.id });
}
