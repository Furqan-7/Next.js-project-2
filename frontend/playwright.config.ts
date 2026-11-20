import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";

const localChromium = "/opt/pw-browsers/chromium";

/**
 * End-to-end tests against a running stack:
 *   backend on :3001 (seeded with `pnpm db:seed`) and frontend on :3000.
 */
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  workers: 1,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    launchOptions: existsSync(localChromium) ? { executablePath: localChromium } : {},
  },
});
