import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import type { NextConfig } from "next";

// Makes the Cloudflare bindings declared in wrangler.jsonc (notably the D1 binding `DB`)
// available to `next dev` and to any server-side code run outside the Worker runtime.
initOpenNextCloudflareForDev();

const nextConfig: NextConfig = {
  // The app is fully dynamic (everything reads the D1 database per request), so there is
  // no static output to cache and no incremental cache override to configure.
  reactStrictMode: true,
};

export default nextConfig;
