import { createApp } from "./app";
import { config } from "./config";
import { runMigrations } from "db/migrate";
import { logger } from "./lib/logger";
import { SCHEDULE, tasks, type TaskName } from "./tasks";

async function main() {
  await runMigrations();
  const app = createApp();
  app.listen(config.PORT, () => logger.info(`API listening on :${config.PORT}`, { ai: Boolean(config.ANTHROPIC_API_KEY) }));

  // Without a separate worker/Redis (e.g. quick local runs), run the light tasks in-process.
  if (config.RUN_SCHEDULER_INLINE) {
    const every: Partial<Record<TaskName, number>> = { dispatch: 60_000, reminders: 15 * 60_000 };
    for (const [name, ms] of Object.entries(every) as [TaskName, number][]) {
      setInterval(() => tasks[name]().catch((e) => logger.warn(`inline ${name} failed`, { error: String(e) })), ms);
    }
    logger.info("inline scheduler on", { tasks: Object.keys(every), all: Object.keys(SCHEDULE) });
  }
}

main().catch((e) => {
  logger.error("server failed to start", { error: e instanceof Error ? e.stack : String(e) });
  process.exit(1);
});
