import type { MetadataRoute } from "next";

/**
 * Crawlers may fetch pages, so they can see that none of them is to be
 * indexed: every response says `X-Robots-Tag: noindex` (next.config.ts). A
 * `Disallow` here would stop them seeing it, and a page linked from
 * somewhere public could still be listed by its address alone.
 */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", allow: "/" } };
}
