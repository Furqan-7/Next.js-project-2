import { PLAN_LIMITS, type Plan } from "shared";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "db";
import { paymentRequired } from "../lib/errors";

export type Metric = "sends" | "ai_drafts" | "verifications";

export const dayKey = (d = new Date()) => d.toISOString().slice(0, 10);
export const monthKey = (d = new Date()) => d.toISOString().slice(0, 7);

function periodFor(metric: Metric, d = new Date()) {
  return metric === "sends" ? dayKey(d) : monthKey(d);
}

export function limitFor(plan: Plan, metric: Metric): number {
  const l = PLAN_LIMITS[plan];
  return metric === "sends" ? l.dailySends : metric === "ai_drafts" ? l.monthlyAiDrafts : l.emailVerificationsPerMonth;
}

export async function getUsage(userId: string, metric: Metric, d = new Date()): Promise<number> {
  const [row] = await db
    .select({ count: schema.usageCounters.count })
    .from(schema.usageCounters)
    .where(and(eq(schema.usageCounters.userId, userId), eq(schema.usageCounters.period, periodFor(metric, d)), eq(schema.usageCounters.metric, metric)));
  return row?.count ?? 0;
}

export async function incrementUsage(userId: string, metric: Metric, by = 1, d = new Date()) {
  await db
    .insert(schema.usageCounters)
    .values({ userId, period: periodFor(metric, d), metric, count: by })
    .onConflictDoUpdate({
      target: [schema.usageCounters.userId, schema.usageCounters.period, schema.usageCounters.metric],
      set: { count: sql`${schema.usageCounters.count} + ${by}` },
    });
}

/** Throws 402 when the plan's quota for this metric is used up. */
export async function assertQuota(user: { id: string; plan: Plan }, metric: Metric, needed = 1) {
  const used = await getUsage(user.id, metric);
  const limit = limitFor(user.plan, metric);
  if (used + needed > limit) {
    throw paymentRequired(`Your ${PLAN_LIMITS[user.plan].label} plan allows ${limit} ${metric.replace("_", " ")} per ${metric === "sends" ? "day" : "month"}. Upgrade to Pro for more.`);
  }
}

export async function usageSummary(user: { id: string; plan: Plan }) {
  const metrics: Metric[] = ["sends", "ai_drafts", "verifications"];
  const out: Record<string, { used: number; limit: number; period: string }> = {};
  for (const m of metrics) out[m] = { used: await getUsage(user.id, m), limit: limitFor(user.plan, m), period: m === "sends" ? "day" : "month" };
  return out;
}
