import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // brain bundles must NEVER stick stale in a browser cache — every load
        // revalidates against the server ETag (304 in ~ms when unchanged), and
        // a rebuilt bundle is picked up on the very next reload
        source: "/data/:path*",
        headers: [{ key: "Cache-Control", value: "no-cache" }],
      },
      {
        // dev chunk URLs are NOT content-hashed — heuristic caching served
        // stale worker/core bundles to the browser repeatedly. no-store for
        // everything in dev; production uses hashed URLs and is unaffected.
        source: "/:path*",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
    ];
  },
};

export default nextConfig;
