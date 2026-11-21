import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every page reads the current item list, so the classic dynamic rendering
  // model is simpler than Cache Components here.
  cacheComponents: false,
  experimental: {
    serverActions: {
      // Photos are sent with their forms. The browser shrinks them to 1600 px
      // and makes the thumbnail first (a few hundred KB together); this stays
      // under Vercel's 4.5 MB request limit.
      bodySizeLimit: "4mb",
    },
  },
  headers: async () => [
    {
      source: "/:path*",
      headers: [
        // No other site may show these pages in a frame, so nobody can trick
        // a tap on This is mine or Clear out through an invisible one.
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        // Bulk add uses the camera on this site's own pages, and nothing else.
        { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
        // Out of search results: pages, photos and CSVs alike. robots.txt lets
        // crawlers in so they can see this.
        { key: "X-Robots-Tag", value: "noindex, nofollow" },
      ],
    },
    {
      // Not photos: their route sends a stricter policy of its own, which
      // a header from here would replace.
      source: "/:path((?!photos/).*)",
      headers: [{ key: "Content-Security-Policy", value: "frame-ancestors 'none'" }],
    },
  ],
  turbopack: {
    // Pin the root: a stray package-lock.json higher up would otherwise be taken for it.
    root: process.cwd(),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
