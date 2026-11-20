import { classifyReplyHeuristic, inboxHealthScore, REPLY_CATEGORIES, stripQuoted, type ReplyCategory } from "shared";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { aiStructured } from "../lib/llm";
import { config } from "../config";
import { db, schema } from "db";
import { logger } from "../lib/logger";
import type { EmailAccount, InboundMessage } from "./mail/providers";
import { notify } from "./notify";
import { advanceStage, logEvent, stopSequence } from "./sequencer";
import { resumeLink, suggestReply } from "./writer";

const ClassifySchema = z.object({
  category: z.enum(REPLY_CATEGORIES),
  confidence: z.number().min(0).max(1),
  asksForAvailability: z.boolean(),
  referral: z.object({ name: z.string().optional(), email: z.string().optional() }).optional(),
  summary: z.string(),
});

export async function classifyReply(subject: string, body: string) {
  const h = classifyReplyHeuristic(subject, body);
  const { data, source } = await aiStructured({
    task: "classify_reply",
    schema: ClassifySchema,
    system: `Classify a reply to a job seeker's cold email.
Categories: interested (wants to talk / next steps / interview), rejected (no role / not a fit), referral (points to another person), out_of_office (auto-reply), asked_for_resume (asks for CV/portfolio/more info), other.
If they ask for a resume AND to talk, choose asked_for_resume. Ignore quoted earlier messages.`,
    prompt: `Subject: ${subject}\n\n${stripQuoted(body).slice(0, 5000)}`,
    effort: "low",
    maxTokens: 2000,
    fallback: () => {
      const email = stripQuoted(body).match(/[\w.+-]+@[\w-]+\.[\w.]+/)?.[0];
      return { category: h.category, confidence: h.confidence, asksForAvailability: h.asksForAvailability, referral: h.category === "referral" && email ? { email } : undefined, summary: stripQuoted(body).slice(0, 160) };
    },
  });
  return { ...data, source };
}

/** Extract the failed recipient from a bounce (DSN) message. */
export function bouncedRecipient(body: string): string | null {
  return (
    body.match(/Final-Recipient:\s*rfc822;\s*([^\s]+)/i)?.[1] ??
    body.match(/(?:could not be delivered to|wasn't delivered to|delivery to the following recipient[s]? failed[^:]*:)\s*<?([\w.+-]+@[\w.-]+)>?/i)?.[1] ??
    body.match(/<([\w.+-]+@[\w.-]+)>[^\n]*(?:does not exist|user unknown|no such user|address rejected)/i)?.[1] ??
    null
  )?.toLowerCase() ?? null;
}

async function handleBounce(account: EmailAccount, msg: InboundMessage) {
  const rcpt = bouncedRecipient(msg.body);
  const [original] = rcpt
    ? await db.select().from(schema.messages).where(and(eq(schema.messages.userId, account.userId), eq(schema.messages.toEmail, rcpt), eq(schema.messages.status, "sent"))).orderBy(desc(schema.messages.sentAt))
    : msg.threadId
      ? await db.select().from(schema.messages).where(eq(schema.messages.providerThreadId, msg.threadId))
      : [];
  if (!original) return { bounced: false };
  await db.update(schema.messages).set({ status: "bounced", error: "Hard bounce" }).where(eq(schema.messages.id, original.id));
  await db.insert(schema.suppressions).values({ userId: account.userId, email: original.toEmail.toLowerCase(), reason: "bounce" }).onConflictDoNothing();
  if (original.contactId) await db.update(schema.contacts).set({ emailStatus: "invalid", emailConfidence: 0 }).where(eq(schema.contacts.id, original.contactId));
  if (original.applicationId) {
    await stopSequence(original.applicationId, "bounced");
    await logEvent(original.applicationId, "bounced", { to: original.toEmail });
  }
  await recomputeHealth(account.id);
  return { bounced: true, messageId: original.id };
}

async function findOriginal(account: EmailAccount, msg: InboundMessage) {
  if (msg.threadId) {
    const [m] = await db.select().from(schema.messages).where(and(eq(schema.messages.emailAccountId, account.id), eq(schema.messages.providerThreadId, msg.threadId), eq(schema.messages.status, "sent"))).orderBy(desc(schema.messages.step));
    if (m) return m;
  }
  if (msg.inReplyTo) {
    const [m] = await db.select().from(schema.messages).where(eq(schema.messages.rfcMessageId, msg.inReplyTo.trim()));
    if (m) return m;
  }
  const from = msg.from.toLowerCase();
  const [m] = await db
    .select()
    .from(schema.messages)
    .where(and(eq(schema.messages.userId, account.userId), sql`lower(${schema.messages.toEmail}) = ${from}`, inArray(schema.messages.status, ["sent", "bounced"])))
    .orderBy(desc(schema.messages.sentAt));
  return m ?? null;
}

/** Core reply pipeline, shared by Gmail Pub/Sub, Outlook webhooks and the dev simulator. */
export async function ingestInbound(account: EmailAccount, msg: InboundMessage) {
  if (msg.from.toLowerCase() === account.email.toLowerCase()) return { ignored: "own message" };
  if (msg.isBounce) return handleBounce(account, msg);
  const original = await findOriginal(account, msg);
  if (!original) return { ignored: "not a reply to outreach" };
  const exists = await db.select({ id: schema.replies.id }).from(schema.replies).where(eq(schema.replies.providerMessageId, msg.providerMessageId));
  if (exists.length) return { ignored: "duplicate" };

  const c = await classifyReply(msg.subject, msg.body);
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, account.userId));
  const [contact] = original.contactId ? await db.select().from(schema.contacts).where(eq(schema.contacts.id, original.contactId)) : [];
  const [profile] = await db.select().from(schema.profiles).where(eq(schema.profiles.userId, account.userId));
  const suggestion = await suggestReply({
    category: c.category,
    asksForAvailability: c.asksForAvailability,
    replyBody: msg.body,
    senderName: user.name,
    recipientFirstName: contact?.name.split(" ")[0] ?? "",
    bookingLink: config.CAL_COM_LINK,
    resumeUrl: profile ? resumeLink(user, profile) : undefined,
  });
  const [reply] = await db
    .insert(schema.replies)
    .values({
      userId: account.userId,
      messageId: original.id,
      applicationId: original.applicationId,
      fromEmail: msg.from,
      subject: msg.subject,
      body: msg.body,
      receivedAt: msg.receivedAt,
      category: c.category,
      confidence: c.confidence,
      suggestedReply: suggestion || null,
      providerMessageId: msg.providerMessageId,
    })
    .onConflictDoNothing()
    .returning();
  if (!reply) return { ignored: "duplicate" };

  if (c.category === "out_of_office") {
    // Don't count as a reply: push pending follow-ups back a few days instead.
    if (original.applicationId) {
      await db
        .update(schema.messages)
        .set({ scheduledAt: sql`${schema.messages.scheduledAt} + interval '5 days'` })
        .where(and(eq(schema.messages.applicationId, original.applicationId), inArray(schema.messages.status, ["scheduled", "pending_approval"])));
      await logEvent(original.applicationId, "out_of_office", { replyId: reply.id });
    }
    return { reply, category: c.category };
  }

  await db.update(schema.messages).set({ repliedAt: msg.receivedAt }).where(eq(schema.messages.id, original.id));
  if (original.applicationId) {
    await stopSequence(original.applicationId, `reply: ${c.category}`);
    await logEvent(original.applicationId, "reply", { replyId: reply.id, category: c.category, summary: c.summary });
    await advanceStage(original.applicationId, c.category === "rejected" ? "rejected" : "replied", `reply classified as ${c.category}`);
  }
  if (c.category === "referral" && c.referral?.email && contact) {
    const name = c.referral.name ?? c.referral.email.split("@")[0].replace(/[._]/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
    await db
      .insert(schema.contacts)
      .values({ companyId: contact.companyId, name, email: c.referral.email.toLowerCase(), emailStatus: "valid", emailConfidence: 95, role: "other", source: "referral", createdByUserId: account.userId, timezone: contact.timezone })
      .onConflictDoNothing();
  }
  const label: Record<ReplyCategory, string> = {
    interested: "is interested",
    rejected: "replied (not hiring right now)",
    referral: "referred you to someone",
    out_of_office: "is out of office",
    asked_for_resume: "asked for your resume",
    other: "replied",
  };
  await notify(account.userId, { type: "reply", title: `${contact?.name ?? msg.from} ${label[c.category]}`, body: c.summary, link: `/inbox?reply=${reply.id}` });
  return { reply, category: c.category };
}

// ------------------------------------------------------------------ health
export async function recomputeHealth(accountId: string) {
  const since = new Date(Date.now() - 30 * 86400000);
  const [stats] = await db
    .select({
      sent: sql<number>`count(*) filter (where ${schema.messages.status} in ('sent','bounced'))::int`,
      bounced: sql<number>`count(*) filter (where ${schema.messages.status} = 'bounced')::int`,
      replies: sql<number>`count(*) filter (where ${schema.messages.repliedAt} is not null)::int`,
    })
    .from(schema.messages)
    .where(and(eq(schema.messages.emailAccountId, accountId), gte(schema.messages.createdAt, since)));
  const [check] = await db.select().from(schema.deliverabilityChecks).where(eq(schema.deliverabilityChecks.emailAccountId, accountId)).orderBy(desc(schema.deliverabilityChecks.createdAt)).limit(1);
  const tests = await db.select().from(schema.placementTests).where(and(eq(schema.placementTests.emailAccountId, accountId), gte(schema.placementTests.createdAt, since)));
  const decided = tests.filter((t) => t.result === "inbox" || t.result === "spam");
  const r = check?.result as { spf?: { ok: boolean }; dkim?: { ok: boolean }; dmarc?: { ok: boolean } } | undefined;
  const health = inboxHealthScore({
    sent: stats?.sent ?? 0,
    bounced: stats?.bounced ?? 0,
    replies: stats?.replies ?? 0,
    spfOk: r?.spf?.ok,
    dkimOk: r?.dkim?.ok,
    dmarcOk: r?.dmarc?.ok,
    spamPlacementRate: decided.length ? decided.filter((t) => t.result === "spam").length / decided.length : undefined,
  });
  await db.update(schema.emailAccounts).set({ healthScore: health.score }).where(eq(schema.emailAccounts.id, accountId));
  logger.debug("health recomputed", { accountId, score: health.score });
  return { ...health, stats };
}
