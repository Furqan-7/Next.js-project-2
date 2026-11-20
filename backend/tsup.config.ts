import { cpSync } from "node:fs";
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/worker.ts", "src/seed.ts"],
  format: ["esm"],
  platform: "node",
  target: "node20",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  // workspace packages are TypeScript source; bundle them into the API build
  noExternal: ["shared", "db"],
  onSuccess: async () => {
    cpSync("../db/migrations", "dist/migrations", { recursive: true });
  },
});
