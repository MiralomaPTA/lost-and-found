/**
 * The grid's sort and filters, kept in the address so the item page can step
 * through the same list and the back link returns to it (spec section 1).
 * Safe to use in the browser.
 */
export interface GridQuery {
  sort: "newest" | "oldest";
  type: string | null;
  color: string | null;
  /** Only items with a name written on them. */
  named: boolean;
  /** Only items added in the last 7 days. */
  recent: boolean;
}

export const NO_FILTERS: GridQuery = { sort: "newest", type: null, color: null, named: false, recent: false };

type Params = Record<string, string | string[] | undefined> | URLSearchParams;

function one(params: Params, key: string): string | null {
  const value = params instanceof URLSearchParams ? params.get(key) : params[key];
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" && first.length > 0 && first.length <= 40 ? first : null;
}

export function parseGridQuery(params: Params): GridQuery {
  return {
    sort: one(params, "sort") === "oldest" ? "oldest" : "newest",
    type: one(params, "type"),
    color: one(params, "color"),
    named: one(params, "named") === "1",
    recent: one(params, "new") === "1",
  };
}

/** "?type=Jacket&sort=oldest", or "" with no filters. Defaults are left out. */
export function gridSearch(query: GridQuery): string {
  const params = new URLSearchParams();
  if (query.type) params.set("type", query.type);
  if (query.color) params.set("color", query.color);
  if (query.named) params.set("named", "1");
  if (query.recent) params.set("new", "1");
  if (query.sort === "oldest") params.set("sort", "oldest");
  const search = params.toString();
  return search ? `?${search}` : "";
}

export function hasFilters(query: GridQuery): boolean {
  return Boolean(query.type || query.color || query.named || query.recent);
}
