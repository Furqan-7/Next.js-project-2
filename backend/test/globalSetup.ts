import { execSync } from "node:child_process";
import pg from "pg";

/** Fresh schema for every test run, then apply the real migrations. */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/jobpilot_test";
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
  await client.end();
  execSync("npx tsx src/migrate.ts", { env: { ...process.env, DATABASE_URL: url }, stdio: "inherit", cwd: new URL("../../db", import.meta.url).pathname });
}
