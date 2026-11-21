import type { NextRequest } from "next/server";
import { lastArchive, readArchive } from "@/server/archives";
import { archiveCsv, csvResponse } from "@/server/csv";
import { getDeps } from "@/server/deps";
import { loadItems } from "@/server/items";
import { currentAdmin } from "@/server/session";

/** GET /admin/clear-out/<date>.csv: every item that clear-out closed, for the *Clear out* tab (admins only). */
export async function GET(_request: NextRequest, context: RouteContext<"/admin/clear-out/[file]">) {
  // A plain refusal rather than a redirect: the link downloads, so a redirect would save the admin code page as the file.
  if (!(await currentAdmin())) return new Response("This phone isn't an admin any more. Enter the admin code again.", { status: 403, headers: { "Cache-Control": "no-store" } });
  const date = /^(\d{4}-\d{2}-\d{2})\.csv$/.exec((await context.params).file)?.[1];
  if (!date) return notFound();
  const deps = await getDeps();
  const list = await loadItems(deps);
  // The last one may still be pending, if its run stopped before naming it.
  const archive = list.last_clear_out?.date === date ? await lastArchive(deps, list) : await readArchive(deps, date);
  if (!archive) return notFound();
  return csvResponse(archiveCsv(archive), `lost-and-found-clear-out-${date}.csv`);
}

function notFound() {
  return new Response("There's no clear-out for that date.", { status: 404, headers: { "Cache-Control": "no-store" } });
}
