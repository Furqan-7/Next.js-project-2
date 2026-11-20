import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./index";

const here = path.dirname(fileURLToPath(import.meta.url));

export async function runMigrations() {
  // db/src (tsx), backend/dist (bundled; migrations/ is copied next to the bundle), or the repo root layout.
  const candidates = [path.resolve(here, "../migrations"), path.resolve(here, "migrations"), path.resolve(here, "../../db/migrations")];
  const fs = await import("node:fs");
  const folder = candidates.find((c) => fs.existsSync(path.join(c, "meta")));
  if (!folder) throw new Error(`migrations folder not found (looked in ${candidates.join(", ")})`);
  await migrate(db, { migrationsFolder: folder });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runMigrations()
    .then(() => {
      console.log("migrations applied");
      return pool.end();
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
