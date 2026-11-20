import type { NextConfig } from "next";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));

// Where the Express API runs. The browser never calls it directly: every request goes to
// /backend/* on this site and is proxied there, so the session cookie is first-party.
const BACKEND_URL = (process.env.BACKEND_URL ?? "http://localhost:3001").replace(/\/+$/, "");

const nextConfig: NextConfig = {
  turbopack: {
    root: resolve(__dir, ".."),
  },
  transpilePackages: ["shared"],
  async rewrites() {
    return [{ source: "/backend/:path*", destination: `${BACKEND_URL}/api/:path*` }];
  },
};

export default nextConfig;
