import { and, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import { db, schema } from "db";
import { logger } from "./lib/logger";
import { weeklyReport } from "./services/analytics";
import { runDiscovery } from "./ingest";
import { gmailWatch, outlookSubscribe } from "./services/mail/providers";
import { notify } from "./services/notify";
import { recomputeHealth } from "./services/replies";
import { dispatchDue } from "./services/sequencer";

/** Every recurring task the worker runs. Each is safe to call repeatedly (idempotent). */
export const tasks = {
  async dispatch() {
    const r = await dispatchDue();
    if (r.sent || r.failed) logger.info("dispatch", { ...r });
    return r;
  },
  async discovery() {
    const r = await runDiscovery();
    logger.info("discovery", { inserted: r.ingest.inserted, merged: r.ingest.merged, funding: r.funding });
    return r.ingest;
  },
  async reminders() {
    const due = await db
      .select()
      .from(schema.reminders)
      .where(and(eq(schema.reminders.done, false), lte(schema.reminders.dueAt, new Date()), isNull(schema.reminders.notifiedAt)));
    for (const r of due) {
      await notify(r.userId, { type: "reminder", title: `Reminder: ${r.text}`, link: r.applicationId ? `/tracker/${r.applicationId}` : "/tracker" });
      await db.update(schema.reminders).set({ notifiedAt: new Date() }).where(eq(schema.reminders.id, r.id));
    }
    return { notified: due.length };
  },
  async renewSubscriptions() {
    const soon = new Date(Date.now() + 24 * 3600000);
    const accounts = await db
      .select()
      .from(schema.emailAccounts)
      .where(and(eq(schema.emailAccounts.status, "active"), or(isNull(schema.emailAccounts.subscriptionExpiresAt), lte(schema.emailAccounts.subscriptionExpiresAt, soon))));
    let renewed = 0;
    for (const a of accounts) {
      if (a.provider === "dev") continue;
      try {
        if (a.provider === "gmail") await gmailWatch(a);
        else await outlookSubscribe(a);
        renewed++;
      } catch (e) {
        logger.warn("subscription renew failed", { account: a.email, error: String(e) });
      }
    }
    return { renewed };
  },
  async health() {
    const accounts = await db.select({ id: schema.emailAccounts.id }).from(schema.emailAccounts);
    for (const a of accounts) await recomputeHealth(a.id);
    return { accounts: accounts.length };
  },
  /** Morning digest: "N new matches for you today". */
  async dailyDigest() {
    const since = new Date(Date.now() - 24 * 3600000);
    const rows = await db
      .select({ userId: schema.jobMatches.userId, n: sql<number>`count(*)::int`, best: sql<number>`max(${schema.jobMatches.score})::int` })
      .from(schema.jobMatches)
      .where(and(gte(schema.jobMatches.createdAt, since), gte(schema.jobMatches.score, 60), eq(schema.jobMatches.status, "new")))
      .groupBy(schema.jobMatches.userId);
    for (const r of rows) {
      await notify(r.userId, { type: "daily_digest", title: `${r.n} new job match${r.n > 1 ? "es" : ""} today`, body: `Best match scores ${r.best}/100. Open your feed to review and reach out.`, link: "/dashboard" });
    }
    return { users: rows.length };
  },
  async weeklyReports() {
    const users = await db.select({ id: schema.users.id }).from(schema.users);
    for (const u of users) await weeklyReport(u.id).catch(() => undefined);
    return { users: users.length };
  },
};

export type TaskName = keyof typeof tasks;

/** name → repeat schedule (cron, UTC) */
export const SCHEDULE: Record<TaskName, string> = {
  dispatch: "* * * * *",
  reminders: "*/15 * * * *",
  discovery: "17 */6 * * *",
  renewSubscriptions: "43 */12 * * *",
  health: "11 3 * * *",
  dailyDigest: "43 3 * * *",
  weeklyReports: "7 9 * * 1",
};
