import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

export const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/jobpilot";

export const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 10 });
export const db = drizzle(pool, { schema });
export type DB = typeof db;
export { schema };
export type { PrepPackContent } from "./schema";
