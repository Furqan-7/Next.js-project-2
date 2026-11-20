import {
  contactPriority,
  DEFAULT_SEND_WINDOW,
  effectiveDailyLimit,
  guessTimezone,
  nextSendTime,
  PLAN_LIMITS,
  planAllows,
  randomGapSeconds,
  type SendWindow,
  type Tone,
} from "shared";
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import { config } from "../config";
import { db, schema } from "db";
import { randomToken } from "../lib/crypto";
import { readResume } from "../lib/storage";
import { badRequest, forbidden, notFound } from "../lib/errors";
import { logger } from "../lib/logger";
import { ProviderError, sendEmail, type EmailAccount } from "./mail/providers";
import { newMessageId, textToHtml } from "./mail/mime";
import { findPeople } from "./people";
import { incrementUsage } from "./usage";
import { generateEmail, loadEmailContext } from "./writer";

type User = typeof schema.users.$inferSelect;
export type Message = typeof schema.messages.$inferSelect;
type Campaign = typeof schema.campaigns.$inferSelect;

// ------------------------------------------------------------------ applications
export async function upsertApplication(input: {
  userId: string;
  companyId: string;
  jobId?: string | null;
  contactId?: string | null;
  campaignId?: string | null;
  source?: "auto" | "manual";
  roleTitle?: string | null;
  stage?: "found" | "emailed" | "replied" | "interview" | "offer" | "rejected";
  appliedVia?: string | null;
}) {
  const [existing] = await db
    .select()
    .from(schema.applications)
    .where(and(eq(schema.applications.userId, input.userId), eq(schema.applications.companyId, input.companyId), input.jobId ? eq(schema.applications.jobId, input.jobId) : isNull(schema.applications.jobId)));
  if (existing) {
    const patch: Partial<typeof schema.applications.$inferInsert> = {};
    if (input.contactId && !existing.contactId) patch.contactId = input.contactId;
    if (input.campaignId && !existing.campaignId) patch.campaignId = input.campaignId;
    if (Object.keys(patch).length) {
      const [u] = await db.update(schema.applications).set({ ...patch, updatedAt: new Date() }).where(eq(schema.applications.id, existing.id)).returning();
      return u;
    }
    return existing;
  }
  const [row] = await db
    .insert(schema.applications)
    .values({
      userId: input.userId,
      companyId: input.companyId,
      jobId: input.jobId ?? null,
      contactId: input.contactId ?? null,
      campaignId: input.campaignId ?? null,
      source: input.source ?? "auto",
      roleTitle: input.roleTitle ?? null,
      stage: input.stage ?? "found",
      appliedVia: input.appliedVia ?? null,
    })
    .returning();
  await logEvent(row.id, "created", { source: row.source, stage: row.stage });
  return row;
}

export async function logEvent(applicationId: string, type: string, payload: Record<string, unknown> = {}) {
  await db.insert(schema.applicationEvents).values({ applicationId, type, payload });
}

const STAGE_ORDER = ["found", "emailed", "replied", "interview", "offer", "rejected"] as const;
/** Move forward only (a late "sent" event must not drag an interview back to "emailed"). */
export async function advanceStage(applicationId: string, stage: (typeof STAGE_ORDER)[number], reason: string) {
  const [app] = await db.select().from(schema.applications).where(eq(schema.applications.id, applicationId));
  if (!app) return;
  if (app.stage === "rejected" || app.stage === "offer") return;
  if (STAGE_ORDER.indexOf(stage) <= STAGE_ORDER.indexOf(app.stage) && stage !== "rejected") return;
  await db.update(schema.applications).set({ stage, updatedAt: new Date() }).where(eq(schema.applications.id, applicationId));
  await logEvent(applicationId, "stage_changed", { from: app.stage, to: stage, reason });
}

// ------------------------------------------------------------------ drafting
export async function isSuppressed(userId: string, email: string) {
  const rows = await db
    .select({ id: schema.suppressions.id })
    .from(schema.suppressions)
    .where(and(eq(schema.suppressions.email, email.toLowerCase()), or(eq(schema.suppressions.userId, userId), isNull(schema.suppressions.userId))));
  return rows.length > 0;
}

export async function defaultAccount(userId: string): Promise<EmailAccount | null> {
  const [acc] = await db
    .select()
    .from(schema.emailAccounts)
    .where(and(eq(schema.emailAccounts.userId, userId), eq(schema.emailAccounts.status, "active")))
    .orderBy(desc(schema.emailAccounts.healthScore), asc(schema.emailAccounts.createdAt));
  return acc ?? null;
}

/** Create a draft email for a contact (optionally tied to a job/campaign). */
export async function draftEmail(
  user: User,
  input: { contactId: string; jobId?: string | null; tone?: Tone; campaignId?: string | null; step?: number; status?: "draft" | "pending_approval" | "scheduled"; variant?: "A" | "B" | null; emailAccountId?: string | null },
): Promise<Message> {
  const [contact] = await db.select().from(schema.contacts).where(eq(schema.contacts.id, input.contactId));
  if (!contact) throw notFound("Contact not found");
  if (!contact.email) throw badRequest("This contact has no email address yet. Run the email finder first.");
  if (contact.emailStatus === "invalid") throw badRequest("This address failed verification, so it would bounce.");
  if (await isSuppressed(user.id, contact.email)) throw badRequest("This address is on your suppression list (bounced or unsubscribed).");
  const [job] = input.jobId ? await db.select().from(schema.jobs).where(eq(schema.jobs.id, input.jobId)) : [];
  const app = await upsertApplication({ userId: user.id, companyId: contact.companyId, jobId: input.jobId, contactId: contact.id, campaignId: input.campaignId, roleTitle: job?.title });
  const tone = input.tone ?? "casual";
  const [campaign] = input.campaignId ? await db.select({ includeResume: schema.campaigns.includeResume }).from(schema.campaigns).where(eq(schema.campaigns.id, input.campaignId)) : [];
  const ctx = await loadEmailContext(user.id, contact.id, { jobId: input.jobId, tone, step: input.step ?? 0, includeLink: campaign?.includeResume ?? true });
  const gen = await generateEmail(user, ctx);
  const subject = input.variant === "B" && gen.subjects[1] ? gen.subjects[1] : gen.subject;
  const account = input.emailAccountId ? null : await defaultAccount(user.id);
  const [msg] = await db
    .insert(schema.messages)
    .values({
      userId: user.id,
      applicationId: app.id,
      campaignId: input.campaignId ?? null,
      contactId: contact.id,
      emailAccountId: input.emailAccountId ?? account?.id ?? null,
      toEmail: contact.email,
      step: input.step ?? 0,
      subject,
      body: gen.body,
      subjectVariants: gen.subjects,
      variant: input.variant ?? null,
      tone,
      templateKey: `${gen.source}:${tone}:step${input.step ?? 0}`,
      status: input.status ?? "draft",
      trackingId: randomToken(12),
      spamScore: gen.spam.score,
      spamHits: gen.spam.hits.map((h) => h.phrase),
    })
    .returning();
  await logEvent(app.id, "draft_created", { messageId: msg.id, step: msg.step });
  return msg;
}

/** Schedule a message for the next good slot in the recipient's time zone. */
export async function scheduleMessage(messageId: string, opts: { notBefore?: Date; window?: SendWindow; status?: "scheduled" | "pending_approval" } = {}) {
  const [msg] = await db.select().from(schema.messages).where(eq(schema.messages.id, messageId));
  if (!msg) throw notFound("Message not found");
  const [contact] = msg.contactId ? await db.select().from(schema.contacts).where(eq(schema.contacts.id, msg.contactId)) : [];
  const [company] = contact ? await db.select().from(schema.companies).where(eq(schema.companies.id, contact.companyId)) : [];
  const tz = contact?.timezone ?? company?.timezone ?? guessTimezone(company?.location, "UTC");
  const [campaign] = msg.campaignId ? await db.select().from(schema.campaigns).where(eq(schema.campaigns.id, msg.campaignId)) : [];
  const window = opts.window ?? campaign?.sendWindow ?? DEFAULT_SEND_WINDOW;
  const when = nextSendTime(tz, opts.notBefore ?? new Date(), window, 25);
  const [updated] = await db.update(schema.messages).set({ status: opts.status ?? "scheduled", scheduledAt: when }).where(eq(schema.messages.id, messageId)).returning();
  return updated;
}

export async function approveMessage(user: User, messageId: string, edits: { subject?: string; body?: string; sendNow?: boolean } = {}) {
  const [msg] = await db.select().from(schema.messages).where(and(eq(schema.messages.id, messageId), eq(schema.messages.userId, user.id)));
  if (!msg) throw notFound("Message not found");
  if (!["draft", "pending_approval"].includes(msg.status)) throw badRequest(`Message is already ${msg.status}`);
  if (edits.subject || edits.body) await db.update(schema.messages).set({ subject: edits.subject ?? msg.subject, body: edits.body ?? msg.body }).where(eq(schema.messages.id, msg.id));
  if (!msg.emailAccountId) {
    const acc = await defaultAccount(user.id);
    if (!acc) throw badRequest("Connect a Gmail or Outlook account before sending.");
    await db.update(schema.messages).set({ emailAccountId: acc.id }).where(eq(schema.messages.id, msg.id));
  }
  if (edits.sendNow) {
    const [u] = await db.update(schema.messages).set({ status: "scheduled", scheduledAt: new Date() }).where(eq(schema.messages.id, msg.id)).returning();
    return u;
  }
  // Follow-ups keep their day-3/7/14 slot; approving early must not send them early.
  const notBefore = msg.scheduledAt && msg.scheduledAt > new Date() ? msg.scheduledAt : new Date();
  return scheduleMessage(msg.id, { notBefore });
}

/** Cancel queued follow-ups for an application (used when they reply). */
export async function stopSequence(applicationId: string, reason: string) {
  const cancelled = await db
    .update(schema.messages)
    .set({ status: "cancelled", error: reason })
    .where(and(eq(schema.messages.applicationId, applicationId), inArray(schema.messages.status, ["scheduled", "pending_approval", "draft"])))
    .returning({ id: schema.messages.id });
  if (cancelled.length) await logEvent(applicationId, "sequence_stopped", { reason, cancelled: cancelled.length });
  return cancelled.length;
}

// ------------------------------------------------------------------ campaigns
export async function campaignTargets(user: User, campaign: Campaign) {
  const f = campaign.filters;
  if (f.jobIds?.length) {
    return db
      .select({ job: schema.jobs, match: schema.jobMatches, company: schema.companies })
      .from(schema.jobs)
      .leftJoin(schema.jobMatches, and(eq(schema.jobMatches.jobId, schema.jobs.id), eq(schema.jobMatches.userId, user.id)))
      .innerJoin(schema.companies, eq(schema.jobs.companyId, schema.companies.id))
      .where(inArray(schema.jobs.id, f.jobIds));
  }
  const conds = [eq(schema.jobMatches.userId, user.id), gte(schema.jobMatches.score, f.minScore ?? 60), sql`${schema.jobs.scamScore} < 50`, ne(schema.jobMatches.status, "dismissed")];
  if (f.query) conds.push(or(ilike(schema.jobs.title, `%${f.query}%`), ilike(schema.jobs.description, `%${f.query}%`))!);
  if (f.remoteOnly) conds.push(eq(schema.jobs.remote, true));
  if (f.sources?.length) conds.push(inArray(schema.jobs.source, f.sources));
  if (f.companySizes?.length) conds.push(inArray(schema.companies.size, f.companySizes as ("startup" | "scaleup" | "mnc")[]));
  return db
    .select({ job: schema.jobs, match: schema.jobMatches, company: schema.companies })
    .from(schema.jobMatches)
    .innerJoin(schema.jobs, eq(schema.jobMatches.jobId, schema.jobs.id))
    .innerJoin(schema.companies, eq(schema.jobs.companyId, schema.companies.id))
    .where(and(...conds))
    .orderBy(desc(schema.jobMatches.score))
    .limit(200);
}

/**
 * Turn a campaign ("all YC startups hiring frontend interns") into drafted emails: one per company,
 * to the best contact we can verify. Autopilot schedules them; approval mode queues them for review.
 */
export async function launchCampaign(user: User, campaignId: string, opts: { maxCompanies?: number; findMissingContacts?: boolean } = {}) {
  const [campaign] = await db.select().from(schema.campaigns).where(and(eq(schema.campaigns.id, campaignId), eq(schema.campaigns.userId, user.id)));
  if (!campaign) throw notFound("Campaign not found");
  if (campaign.mode === "autopilot" && !planAllows(user.plan, "autopilot")) throw forbidden("Autopilot is a Pro feature. Switch the campaign to approval mode or upgrade.");
  const targets = await campaignTargets(user, campaign);
  const isBulk = targets.length > 10 || !campaign.filters.jobIds?.length;
  if (isBulk && !planAllows(user.plan, "bulkCampaigns")) throw forbidden("Bulk campaigns are a Pro feature. Pick specific jobs or upgrade.");
  const max = opts.maxCompanies ?? (user.plan === "free" ? 10 : 50);
  const seenCompanies = new Set<string>();
  const created: Message[] = [];
  const skipped: { company: string; reason: string }[] = [];
  let variantToggle = 0;
  for (const { job, company } of targets) {
    if (created.length >= max) break;
    if (seenCompanies.has(company.id)) continue;
    seenCompanies.add(company.id);
    // already contacted this company? don't double-email
    const prior = await db
      .select({ id: schema.messages.id })
      .from(schema.messages)
      .innerJoin(schema.applications, eq(schema.messages.applicationId, schema.applications.id))
      .where(and(eq(schema.applications.userId, user.id), eq(schema.applications.companyId, company.id), inArray(schema.messages.status, ["sent", "scheduled", "pending_approval"])));
    if (prior.length) {
      skipped.push({ company: company.name, reason: "already contacted" });
      continue;
    }
    let people = await db.select().from(schema.contacts).where(eq(schema.contacts.companyId, company.id));
    if (!people.some((p) => p.email) && opts.findMissingContacts !== false && company.domain && !config.OFFLINE) {
      try {
        people = (await findPeople(company, user)).contacts;
      } catch (e) {
        logger.warn("people finder failed during campaign", { company: company.name, error: String(e) });
      }
    }
    const usable = people
      .filter((p) => p.email && p.emailStatus !== "invalid")
      .sort((a, b) => contactPriority(a.role, company.size) - contactPriority(b.role, company.size) || b.emailConfidence - a.emailConfidence);
    const contact = usable[0];
    if (!contact) {
      skipped.push({ company: company.name, reason: "no verified contact" });
      continue;
    }
    if (await isSuppressed(user.id, contact.email!)) {
      skipped.push({ company: company.name, reason: "suppressed" });
      continue;
    }
    const variant = campaign.abTest && planAllows(user.plan, "abTesting") ? (variantToggle++ % 2 === 0 ? "A" : "B") : null;
    try {
      const msg = await draftEmail(user, {
        contactId: contact.id,
        jobId: job.isHiringPost ? null : job.id,
        tone: campaign.tone as Tone,
        campaignId: campaign.id,
        step: 0,
        status: "pending_approval",
        variant,
        emailAccountId: campaign.emailAccountId,
      });
      created.push(campaign.mode === "autopilot" ? await scheduleMessage(msg.id) : msg);
    } catch (e) {
      skipped.push({ company: company.name, reason: e instanceof Error ? e.message : String(e) });
      if (e instanceof Error && /plan allows/.test(e.message)) break; // quota exhausted
    }
  }
  await db.update(schema.campaigns).set({ status: "active" }).where(eq(schema.campaigns.id, campaign.id));
  return { created: created.length, messages: created, skipped };
}

// ------------------------------------------------------------------ follow-ups
async function queueNextFollowup(sent: Message) {
  if (!sent.campaignId || !sent.applicationId || !sent.contactId) return null;
  const [campaign] = await db.select().from(schema.campaigns).where(eq(schema.campaigns.id, sent.campaignId));
  if (!campaign) return null;
  const nextStep = campaign.sequence[sent.step + 1];
  if (!nextStep) return null;
  const replied = await db
    .select({ id: schema.replies.id })
    .from(schema.replies)
    .where(and(eq(schema.replies.applicationId, sent.applicationId), ne(schema.replies.category, "out_of_office")));
  if (replied.length) return null;
  const [initial] = await db.select().from(schema.messages).where(and(eq(schema.messages.applicationId, sent.applicationId), eq(schema.messages.step, 0), eq(schema.messages.status, "sent")));
  const base = initial?.sentAt ?? sent.sentAt ?? new Date();
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, sent.userId));
  const [app] = await db.select().from(schema.applications).where(eq(schema.applications.id, sent.applicationId));
  const followup = await draftEmail(user, {
    contactId: sent.contactId,
    jobId: app?.jobId,
    tone: campaign.tone as Tone,
    campaignId: campaign.id,
    step: sent.step + 1,
    status: "pending_approval",
    emailAccountId: sent.emailAccountId,
  });
  // Thread it: same subject ("Re: …"), same provider thread.
  await db
    .update(schema.messages)
    .set({ subject: `Re: ${(initial?.subject ?? sent.subject).replace(/^re:\s*/i, "")}`, providerThreadId: sent.providerThreadId })
    .where(eq(schema.messages.id, followup.id));
  return scheduleMessage(followup.id, { notBefore: new Date(base.getTime() + nextStep.dayOffset * 86400000), status: campaign.mode === "autopilot" ? "scheduled" : "pending_approval" });
}

// ------------------------------------------------------------------ dispatch
export async function sentTodayCount(accountId: string, now = new Date()) {
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  const [r] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(schema.messages)
    .where(and(eq(schema.messages.emailAccountId, accountId), gte(schema.messages.sentAt, start)));
  return r?.c ?? 0;
}

/** Resume PDF, only on messages flagged for it (e.g. answering "can you send your resume?"). */
async function attachmentsFor(msg: Message, userName: string) {
  if (!msg.attachResume) return undefined;
  const pdf = await readResume(msg.userId);
  return pdf ? [{ filename: `${userName.replace(/[^\w ]+/g, "").trim().replace(/\s+/g, "_") || "resume"}_Resume.pdf`, contentType: "application/pdf", content: pdf }] : undefined;
}

async function lastSentAt(accountId: string): Promise<number | undefined> {
  const [r] = await db
    .select({ t: sql<Date | null>`max(${schema.messages.sentAt})` })
    .from(schema.messages)
    .where(eq(schema.messages.emailAccountId, accountId));
  return r?.t ? new Date(r.t).getTime() : undefined;
}

export interface DispatchReport {
  sent: number;
  deferred: number;
  failed: number;
  cancelled: number;
}

/**
 * Send everything that's due, respecting: one-click pause, campaign pause, per-account daily limits
 * (plan × mailbox × warm-up × health), random gaps between sends, suppression list, and replies.
 */
export async function dispatchDue(now = new Date(), opts: { minGapSeconds?: number; maxGapSeconds?: number } = {}): Promise<DispatchReport> {
  const report: DispatchReport = { sent: 0, deferred: 0, failed: 0, cancelled: 0 };
  const due = await db
    .select({ msg: schema.messages, user: schema.users, account: schema.emailAccounts, campaign: schema.campaigns })
    .from(schema.messages)
    .innerJoin(schema.users, eq(schema.messages.userId, schema.users.id))
    .leftJoin(schema.emailAccounts, eq(schema.messages.emailAccountId, schema.emailAccounts.id))
    .leftJoin(schema.campaigns, eq(schema.messages.campaignId, schema.campaigns.id))
    .where(and(eq(schema.messages.status, "scheduled"), lte(schema.messages.scheduledAt, now)))
    .orderBy(asc(schema.messages.scheduledAt))
    .limit(200);

  const lastSendAt = new Map<string, number>();
  const sentCount = new Map<string, number>();
  for (const { msg, user, account, campaign } of due) {
    if (user.sendingPaused || campaign?.status === "paused") {
      report.deferred++;
      continue;
    }
    if (!account || account.status !== "active") {
      await db.update(schema.messages).set({ status: "failed", error: "No active mailbox connected" }).where(eq(schema.messages.id, msg.id));
      report.failed++;
      continue;
    }
    // A reply arrived after this message was queued → stop the sequence. (Messages written after the
    // reply, such as your own response from the inbox, are not affected.)
    if (msg.applicationId) {
      const [r] = await db
        .select({ id: schema.replies.id })
        .from(schema.replies)
        .where(and(eq(schema.replies.applicationId, msg.applicationId), ne(schema.replies.category, "out_of_office"), gte(schema.replies.receivedAt, msg.createdAt)));
      if (r) {
        report.cancelled += await stopSequence(msg.applicationId, "reply received");
        continue;
      }
    }
    if (await isSuppressed(user.id, msg.toEmail)) {
      await db.update(schema.messages).set({ status: "cancelled", error: "Recipient suppressed" }).where(eq(schema.messages.id, msg.id));
      report.cancelled++;
      continue;
    }
    // Daily limit
    const limit = effectiveDailyLimit({
      planLimit: PLAN_LIMITS[user.plan].dailySends,
      accountLimit: account.dailyLimit,
      warmupEnabled: account.warmupEnabled,
      warmupStartedAt: account.warmupStartedAt,
      healthScore: account.healthScore,
      now,
    });
    const already = sentCount.get(account.id) ?? (await sentTodayCount(account.id, now));
    if (already >= limit) {
      const tomorrow = new Date(now.getTime() + 86400000);
      await scheduleMessage(msg.id, { notBefore: tomorrow, window: campaign?.sendWindow });
      report.deferred++;
      continue;
    }
    // Random gap between sends from the same mailbox
    const minGap = opts.minGapSeconds ?? 90;
    const maxGap = opts.maxGapSeconds ?? 420;
    const last = lastSendAt.get(account.id) ?? (await lastSentAt(account.id));
    if (last !== undefined && now.getTime() - last < minGap * 1000) {
      const next = new Date(last + randomGapSeconds(minGap, maxGap) * 1000);
      await db.update(schema.messages).set({ scheduledAt: next }).where(eq(schema.messages.id, msg.id));
      report.deferred++;
      continue;
    }

    const [contact] = msg.contactId ? await db.select().from(schema.contacts).where(eq(schema.contacts.id, msg.contactId)) : [];
    const previous = msg.step > 0 && msg.applicationId
      ? await db.select().from(schema.messages).where(and(eq(schema.messages.applicationId, msg.applicationId), eq(schema.messages.status, "sent"))).orderBy(asc(schema.messages.step))
      : [];
    const domain = account.email.split("@")[1] ?? "jobpilot.local";
    const rfcId = newMessageId(domain);
    const pixel = `${config.API_URL}/api/t/o/${msg.trackingId}.gif`;
    try {
      const result = await sendEmail(
        account,
        {
          from: account.email,
          fromName: user.name,
          to: contact?.name ? `${contact.name.replace(/"/g, "")} <${msg.toEmail}>` : msg.toEmail,
          subject: msg.subject,
          text: msg.body,
          html: textToHtml(msg.body, pixel),
          messageId: rfcId,
          inReplyTo: previous.at(-1)?.rfcMessageId ?? null,
          references: previous.map((p) => p.rfcMessageId).filter(Boolean) as string[],
          headers: { "List-Unsubscribe": `<${config.API_URL}/api/t/u/${msg.trackingId}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click", "X-JobPilot-Id": msg.trackingId },
          attachments: await attachmentsFor(msg, user.name),
        },
        msg.providerThreadId ?? previous.at(-1)?.providerThreadId,
        previous.at(-1)?.providerMessageId,
      );
      const sentAt = new Date();
      const [sent] = await db
        .update(schema.messages)
        .set({ status: "sent", sentAt, providerMessageId: result.providerMessageId, providerThreadId: result.threadId ?? null, rfcMessageId: rfcId, error: null })
        .where(eq(schema.messages.id, msg.id))
        .returning();
      await incrementUsage(user.id, "sends");
      lastSendAt.set(account.id, now.getTime());
      sentCount.set(account.id, already + 1);
      if (msg.applicationId) {
        await advanceStage(msg.applicationId, "emailed", msg.step === 0 ? "initial email sent" : `follow-up ${msg.step} sent`);
        await logEvent(msg.applicationId, "email_sent", { messageId: msg.id, step: msg.step, subject: msg.subject, to: msg.toEmail });
      }
      report.sent++;
      try {
        await queueNextFollowup(sent);
      } catch (e) {
        logger.warn("could not queue follow-up", { error: String(e) });
      }
    } catch (e) {
      const permanent = e instanceof ProviderError && e.permanent;
      await db.update(schema.messages).set({ status: permanent ? "failed" : "scheduled", error: String(e instanceof Error ? e.message : e), scheduledAt: new Date(now.getTime() + 15 * 60000) }).where(eq(schema.messages.id, msg.id));
      if (permanent) await db.update(schema.emailAccounts).set({ status: "error", lastError: String(e) }).where(eq(schema.emailAccounts.id, account.id));
      report.failed++;
    }
  }
  return report;
}

export async function setPaused(userId: string, paused: boolean) {
  await db.update(schema.users).set({ sendingPaused: paused }).where(eq(schema.users.id, userId));
}
