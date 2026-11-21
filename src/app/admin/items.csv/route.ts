import { pacificDate } from "@/lib/dates";
import { csvResponse, itemsCsv } from "@/server/csv";
import { getDeps } from "@/server/deps";
import { loadItems } from "@/server/items";
import { currentAdmin } from "@/server/session";

/** GET /admin/items.csv: every item on the list now, for Settings' *Download* (admins only). */
export async function GET() {
  // A plain refusal rather than a redirect: the link downloads, so a redirect would save the code screen as the file.
  if (!(await currentAdmin())) return new Response("This phone can't open this. Tap Enter a new code at the bottom of any page.", { status: 403, headers: { "Cache-Control": "no-store" } });
  const deps = await getDeps();
  const file = await loadItems(deps, { fresh: true });
  return csvResponse(itemsCsv(file.items), `lost-and-found-${pacificDate(deps.now())}.csv`);
}
