import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    env: {
      NODE_ENV: "test",
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/jobpilot_test",
      OFFLINE: "true",
      AI_DISABLED: "true",
      JWT_SECRET: "test-secret-test-secret-test-secret",
    },
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
    globalSetup: ["./test/globalSetup.ts"],
  },
});
