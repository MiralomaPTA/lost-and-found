import type { NextRequest } from "next/server";
import { addUploadedItem, PHOTO_MAX_BYTES, THUMB_MAX_BYTES } from "@/server/adding";
import { getDeps } from "@/server/deps";
import { answer, bytesOf, formOf, fromThisSite, readBody } from "@/server/http";
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

const NOT_THROUGH = "That upload didn't come through. Try again.";

export async function POST(request: NextRequest) {
  if (!fromThisSite(request)) return answer(403, { ok: false, reason: "forbidden", message: "This can only be sent from the lost-and-found site." });

  const visitor = await getVisitor();
  if (!visitor.canBrowse || !visitor.phoneId) return answer(401, { ok: false, reason: "no-code", message: "Enter the school code first." });
  const name = visitor.device?.name;
  if (!name) return answer(409, { ok: false, reason: "need-name", message: "Give this phone a name first, on the Add page." });

  const body = await readBody(request, MAX_BODY);
  if (!body) return answer(413, { ok: false, reason: "too-big", message: "That photo is too big to upload. Take it again." });
  const form = await formOf(request, body);
  if (!form) return answer(400, { ok: false, reason: "bad-request", message: NOT_THROUGH });
  const photo = await bytesOf(form.get("photo"));
  const thumb = await bytesOf(form.get("thumb"));
  if (!photo || !thumb) return answer(400, { ok: false, reason: "bad-request", message: NOT_THROUGH });

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
