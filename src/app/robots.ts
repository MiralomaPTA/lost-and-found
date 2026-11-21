import type { MetadataRoute } from "next";

/** Nothing here is for search engines: the grid is behind the school code, and the rest only makes sense with it. */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
