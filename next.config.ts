import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native modules used by the server-side renderer and the site inspector.
  serverExternalPackages: ["@napi-rs/canvas", "playwright-core"],
  experimental: {
    // Asset uploads (screenshots, clips, fonts) pass through proxy.ts for auth.
    proxyClientMaxBodySize: "100mb",
  },
};

export default nextConfig;
