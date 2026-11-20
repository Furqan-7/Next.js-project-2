import { abWinner, computeInsights, groupRates, type OutreachRecord } from "shared";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { aiStructured } from "../lib/llm";
import { db, schema } from "db";
import { notify } from "./notify";

const POSITIVE = ["interested", "asked_for_resume", "referral"];

const ROLE_OF_TITLE: [RegExp, string][] = [
  [/front/i, "frontend"],
  [/back/i, "backend"],
  [/full/i, "fullstack"],
  [/\b(ai|llm|ml|machine)\b/i, "ai/ml"],
  [/data/i, "data"],
  [/mobile|ios|android/i, "mobile"],
  [/devops|sre|infra/i, "devops"],
  [/intern/i, "intern"],
];
const roleOf = (t?: string | null) => ROLE_OF_TITLE.find(([re]) => re.test(t ?? ""))?.[1] ?? "general";

export async function outreachRecords(userId: string, sinceDays = 90): Promise<OutreachRecord[]> {
  const since = new Date(Date.now() - sinceDays * 86400000);
  const rows = await db
    .select({ msg: schema.messages, contact: schema.contacts, company: schema.companies, job: schema.jobs })
    .from(schema.messages)
    .leftJoin(schema.contacts, eq(schema.messages.contactId, schema.contacts.id))
    .leftJoin(schema.companies, eq(schema.contacts.companyId, schema.companies.id))
    .leftJoin(schema.applications, eq(schema.messages.applicationId, schema.applications.id))
    .leftJoin(schema.jobs, eq(schema.applications.jobId, schema.jobs.id))
    .where(and(eq(schema.messages.userId, userId), inArray(schema.messages.status, ["sent", "bounced"]), gte(schema.messages.sentAt, since)));
  const msgIds = rows.map((r) => r.msg.id);
  const reps = msgIds.length ? await db.select({ messageId: schema.replies.messageId, category: schema.replies.category }).from(schema.replies).where(inArray(schema.replies.messageId, msgIds)) : [];
  const replyBy = new Map(reps.map((r) => [r.messageId, r.category]));
  return rows.map(({ msg, contact, company, job }) => {
    const cat = replyBy.get(msg.id);
    return {
      sentAt: msg.sentAt ?? msg.createdAt,
      opened: Boolean(msg.openedAt),
      replied: Boolean(msg.repliedAt) || (cat !== undefined && cat !== "out_of_office"),
      positive: cat !== undefined && POSITIVE.includes(cat),
      bounced: msg.status === "bounced",
      templateKey: msg.templateKey,
      subject: msg.subject,
      tone: msg.tone,
      role: roleOf(job?.title),
      companySize: company?.size ?? "unknown",
      contactRole: contact?.role ?? "other",
      step: msg.step,
    };
  });
}

/** Continuous day-by-day series (zero days included) from the first send to today. */
export function fillDays(m: Map<string, { date: string; sent: number; replies: number }>) {
  const dates = [...m.keys()].sort();
  if (!dates.length) return [];
  const out: { date: string; sent: number; replies: number }[] = [];
  const end = new Date().toISOString().slice(0, 10);
  for (let d = new Date(`${dates[0]}T00:00:00Z`); ; d = new Date(d.getTime() + 86400000)) {
    const key = d.toISOString().slice(0, 10);
    out.push(m.get(key) ?? { date: key, sent: 0, replies: 0 });
    if (key >= end || out.length > 400) break;
  }
  return out;
}

export async function analyticsOverview(userId: string, sinceDays = 90) {
  const recs = await outreachRecords(userId, sinceDays);
  const delivered = recs.filter((r) => !r.bounced);
  const sent = recs.length;
  const pct = (n: number, d: number) => (d ? n / d : 0);
  // A/B per campaign
  const ab = await db
    .select({
      campaignId: schema.messages.campaignId,
      variant: schema.messages.variant,
      sent: sql<number>`count(*)::int`,
      replies: sql<number>`count(${schema.messages.repliedAt})::int`,
    })
    .from(schema.messages)
    .where(and(eq(schema.messages.userId, userId), eq(schema.messages.status, "sent"), sql`${schema.messages.variant} is not null`))
    .groupBy(schema.messages.campaignId, schema.messages.variant);
  const byCampaign = new Map<string, { A?: { sent: number; replies: number }; B?: { sent: number; replies: number } }>();
  for (const r of ab) {
    const k = r.campaignId ?? "none";
    const e = byCampaign.get(k) ?? {};
    e[r.variant as "A" | "B"] = { sent: r.sent, replies: r.replies };
    byCampaign.set(k, e);
  }
  const abTests = [...byCampaign.entries()].map(([campaignId, v]) => ({ campaignId, ...v, winner: v.A && v.B ? abWinner(v.A, v.B) : null }));

  // Daily timeline
  const timeline = new Map<string, { date: string; sent: number; replies: number }>();
  for (const r of recs) {
    const d = r.sentAt.toISOString().slice(0, 10);
    const e = timeline.get(d) ?? { date: d, sent: 0, replies: 0 };
    e.sent++;
    if (r.replied) e.replies++;
    timeline.set(d, e);
  }
  return {
    totals: {
      sent,
      delivered: delivered.length,
      bounced: sent - delivered.length,
      opened: delivered.filter((r) => r.opened).length,
      replied: delivered.filter((r) => r.replied).length,
      positive: delivered.filter((r) => r.positive).length,
      openRate: pct(delivered.filter((r) => r.opened).length, delivered.length),
      replyRate: pct(delivered.filter((r) => r.replied).length, delivered.length),
      positiveRate: pct(delivered.filter((r) => r.positive).length, delivered.length),
      bounceRate: pct(sent - delivered.length, sent),
    },
    byTemplate: groupRates(recs, (r) => r.templateKey),
    bySubject: groupRates(recs.filter((r) => r.step === 0), (r) => r.subject).slice(0, 15),
    byRole: groupRates(recs, (r) => r.role),
    byCompanySize: groupRates(recs, (r) => r.companySize),
    byContactRole: groupRates(recs, (r) => r.contactRole),
    byTone: groupRates(recs, (r) => r.tone),
    byStep: groupRates(recs, (r) => (r.step === 0 ? "initial" : `follow-up ${r.step}`)),
    abTests,
    timeline: fillDays(timeline),
    insights: computeInsights(recs),
  };
}

const AdviceSchema = z.object({ suggestions: z.array(z.object({ title: z.string(), detail: z.string() })) });

/** AI suggestions on what to change, grounded in the user's own numbers. */
export async function aiAdvice(userId: string) {
  const o = await analyticsOverview(userId);
  const { data } = await aiStructured({
    task: "advice",
    schema: AdviceSchema,
    system: "You coach a job seeker on their cold-email outreach. Give 3-5 specific, data-backed changes. Cite the numbers. If sample sizes are small (<10), say so and suggest what to test.",
    prompt: JSON.stringify({ totals: o.totals, byTemplate: o.byTemplate.slice(0, 8), bySubject: o.bySubject.slice(0, 8), byCompanySize: o.byCompanySize, byContactRole: o.byContactRole, byTone: o.byTone, byStep: o.byStep, insights: o.insights }),
    fallback: () => ({
      suggestions: [
        ...o.insights.map((i) => ({ title: i.kind === "warning" ? "Fix this first" : "Lean into what works", detail: i.text })),
        ...(o.totals.sent < 20 ? [{ title: "Send more to learn", detail: `You've sent ${o.totals.sent} emails. After ~30 sends, patterns become reliable.` }] : []),
        ...(o.totals.sent >= 20 && o.totals.replyRate < 0.05 ? [{ title: "Personalise the first line", detail: "Reply rate is under 5%. Reference a recent post or product detail in the first sentence, and keep emails under 120 words." }] : []),
      ].slice(0, 5),
    }),
  });
  return data.suggestions;
}

export async function weeklyReport(userId: string) {
  const o = await analyticsOverview(userId, 7);
  const lines = [
    `${o.totals.sent} emails sent, ${Math.round(o.totals.replyRate * 100)}% reply rate, ${o.totals.positive} positive replies.`,
    ...o.insights.slice(0, 3).map((i) => i.text),
  ];
  await notify(userId, { type: "weekly_report", title: "Your weekly outreach report", body: lines.join(" "), link: "/analytics" });
  return { ...o, summary: lines };
}
