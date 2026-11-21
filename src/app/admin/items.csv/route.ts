import { NextResponse, type NextRequest } from "next/server";
import { pacificDate } from "@/lib/dates";
import { csvResponse, itemsCsv } from "@/server/csv";
import { getDeps } from "@/server/deps";
import { loadItems } from "@/server/items";
import { currentAdmin } from "@/server/session";

/** GET /admin/items.csv: every item on the list now, for Settings' *Download* (admins only). */
export async function GET(request: NextRequest) {
  if (!(await currentAdmin())) return NextResponse.redirect(new URL("/admin-code", request.url), 303);
  const deps = await getDeps();
  const file = await loadItems(deps, { fresh: true });
  return csvResponse(itemsCsv(file.items), `lost-and-found-${pacificDate(deps.now())}.csv`);
}
