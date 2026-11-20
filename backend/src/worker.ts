import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { config } from "./config";
import { runMigrations } from "db/migrate";
import { logger } from "./lib/logger";
import { SCHEDULE, tasks, type TaskName } from "./tasks";

/**
 * Background worker: BullMQ (Redis) runs each task on its schedule, with retries, and guarantees a
 * task only runs on one worker at a time even if you scale workers horizontally.
 */
async function main() {
  await runMigrations();
  const connection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
  const queue = new Queue("jobpilot", { connection });
  for (const [name, pattern] of Object.entries(SCHEDULE)) {
    await queue.upsertJobScheduler(name, { pattern }, { name, opts: { removeOnComplete: 100, removeOnFail: 200, attempts: 2, backoff: { type: "exponential", delay: 30_000 } } });
  }
  const worker = new Worker(
    "jobpilot",
    async (job) => {
      const fn = tasks[job.name as TaskName];
      if (!fn) throw new Error(`unknown task ${job.name}`);
      return fn();
    },
    { connection, concurrency: 2 },
  );
  worker.on("failed", (job, err) => logger.error("task failed", { task: job?.name, error: err.message }));
  logger.info("worker started", { tasks: Object.keys(SCHEDULE) });
  const shutdown = async () => {
    await worker.close();
    await queue.close();
    connection.disconnect();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => {
  logger.error("worker crashed", { error: String(e) });
  process.exit(1);
});
