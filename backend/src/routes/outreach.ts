import { checkSpam, DEFAULT_SEQUENCE, DEFAULT_SEND_WINDOW, planAllows, TONES } from "shared";
import { and, desc, eq, inArray } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { me } from "../lib/auth";
import { db, schema } from "db";
import { badRequest, forbidden, notFound } from "../lib/errors";
import { approveMessage, campaignTargets, draftEmail, launchCampaign, logEvent, scheduleMessage, setPaused, upsertApplication } from "../services/sequencer";
import { generateCoverLetter, generateEmail, generateLinkedIn, loadEmailContext } from "../services/writer";

export const outreachRouter = Router();

outreachRouter.post("/drafts", async (req, res) => {
  const body = z.object({ contactId: z.string().uuid(), jobId: z.string().uuid().optional(), tone: z.enum(TONES).default("casual") }).parse(req.body);
  const msg = await draftEmail(me(req), { ...body, status: "pending_approval" });
  res.status(201).json({ message: msg, spam: checkSpam(msg.subject, msg.body) });
});

outreachRouter.get("/messages", async (req, res) => {
  const { status, applicationId } = z.object({ status: z.string().optional(), applicationId: z.string().uuid().optional() }).parse(req.query);
  const statuses = status?.split(",").filter(Boolean);
  const rows = await db
    .select({ message: schema.messages, contact: schema.contacts, company: schema.companies })
    .from(schema.messages)
    .leftJoin(schema.contacts, eq(schema.messages.contactId, schema.contacts.id))
    .leftJoin(schema.companies, eq(schema.contacts.companyId, schema.companies.id))
    .where(and(eq(schema.messages.userId, me(req).id), statuses?.length ? inArray(schema.messages.status, statuses as never[]) : undefined, applicationId ? eq(schema.messages.applicationId, applicationId) : undefined))
    .orderBy(desc(schema.messages.createdAt))
    .limit(200);
  res.json({ items: rows.map((r) => ({ ...r.message, contact: r.contact, company: r.company })) });
});

async function ownMessage(userId: string, id: string) {
  const [m] = await db.select().from(schema.messages).where(and(eq(schema.messages.id, id), eq(schema.messages.userId, userId)));
  if (!m) throw notFound("Message not found");
  return m;
}

outreachRouter.patch("/messages/:id", async (req, res) => {
  const body = z.object({ subject: z.string().min(1).optional(), body: z.string().min(1).optional() }).parse(req.body);
  const m = await ownMessage(me(req).id, req.params.id);
  if (!["draft", "pending_approval", "scheduled"].includes(m.status)) throw badRequest("Can't edit a message that was already sent");
  const subject = body.subject ?? m.subject;
  const text = body.body ?? m.body;
  const spam = checkSpam(subject, text);
  const [u] = await db.update(schema.messages).set({ subject, body: text, spamScore: spam.score, spamHits: spam.hits.map((h) => h.phrase) }).where(eq(schema.messages.id, m.id)).returning();
  res.json({ message: u, spam });
});

outreachRouter.post("/messages/:id/approve", async (req, res) => {
  const body = z.object({ subject: z.string().optional(), body: z.string().optional(), sendNow: z.boolean().optional() }).parse(req.body ?? {});
  res.json({ message: await approveMessage(me(req), req.params.id, body) });
});

outreachRouter.post("/messages/approve-all", async (req, res) => {
  const user = me(req);
  const pending = await db.select().from(schema.messages).where(and(eq(schema.messages.userId, user.id), eq(schema.messages.status, "pending_approval")));
  const out = [];
  for (const m of pending) out.push(await approveMessage(user, m.id));
  res.json({ approved: out.length });
});

outreachRouter.post("/messages/:id/cancel", async (req, res) => {
  const m = await ownMessage(me(req).id, req.params.id);
  const [u] = await db.update(schema.messages).set({ status: "cancelled" }).where(eq(schema.messages.id, m.id)).returning();
  res.json({ message: u });
});

outreachRouter.post("/messages/:id/regenerate", async (req, res) => {
  const user = me(req);
  const { tone } = z.object({ tone: z.enum(TONES).optional() }).parse(req.body ?? {});
  const m = await ownMessage(user.id, req.params.id);
  if (!m.contactId) throw badRequest("No contact");
  const [app] = m.applicationId ? await db.select().from(schema.applications).where(eq(schema.applications.id, m.applicationId)) : [];
  const ctx = await loadEmailContext(user.id, m.contactId, { jobId: app?.jobId, tone: tone ?? (m.tone as never), step: m.step });
  const gen = await generateEmail(user, ctx);
  const [u] = await db
    .update(schema.messages)
    .set({ subject: m.step > 0 ? m.subject : gen.subject, body: gen.body, subjectVariants: gen.subjects, tone: tone ?? m.tone, spamScore: gen.spam.score, spamHits: gen.spam.hits.map((h) => h.phrase) })
    .where(eq(schema.messages.id, m.id))
    .returning();
  res.json({ message: u, spam: gen.spam });
});

outreachRouter.post("/spam-check", (req, res) => {
  const { subject, body } = z.object({ subject: z.string(), body: z.string() }).parse(req.body);
  res.json(checkSpam(subject, body));
});

/** LinkedIn connection notes / DMs and cover letters: generated here, copied and sent by the user. */
outreachRouter.post("/generate", async (req, res) => {
  const user = me(req);
  const body = z.object({ kind: z.enum(["linkedin_note", "linkedin_dm", "cover_letter"]), contactId: z.string().uuid(), jobId: z.string().uuid().optional(), tone: z.enum(TONES).default("casual") }).parse(req.body);
  const ctx = await loadEmailContext(user.id, body.contactId, { jobId: body.jobId, tone: body.tone });
  const content = body.kind === "cover_letter" ? await generateCoverLetter(user, ctx) : await generateLinkedIn(user, ctx, body.kind);
  const [contact] = await db.select().from(schema.contacts).where(eq(schema.contacts.id, body.contactId));
  const app = await upsertApplication({ userId: user.id, companyId: contact.companyId, jobId: body.jobId, contactId: contact.id });
  const [draft] = await db.insert(schema.outreachDrafts).values({ userId: user.id, applicationId: app.id, contactId: body.contactId, kind: body.kind, content }).returning();
  await logEvent(app.id, `${body.kind}_generated`, { draftId: draft.id });
  res.status(201).json({ draft });
});

outreachRouter.get("/generated", async (req, res) => {
  const rows = await db.select().from(schema.outreachDrafts).where(eq(schema.outreachDrafts.userId, me(req).id)).orderBy(desc(schema.outreachDrafts.createdAt)).limit(100);
  res.json({ items: rows });
});

/** Subject-line A/B preview for a contact without saving. */
outreachRouter.post("/subjects", async (req, res) => {
  const user = me(req);
  const body = z.object({ contactId: z.string().uuid(), jobId: z.string().uuid().optional(), tone: z.enum(TONES).default("casual") }).parse(req.body);
  const gen = await generateEmail(user, await loadEmailContext(user.id, body.contactId, { jobId: body.jobId, tone: body.tone }));
  res.json({ subjects: gen.subjects });
});

// ------------------------------------------------------------------ campaigns
export const campaignsRouter = Router();

const CampaignBody = z.object({
  name: z.string().min(1),
  mode: z.enum(["approval", "autopilot"]).default("approval"),
  tone: z.enum(TONES).default("casual"),
  filters: z
    .object({
      query: z.string().optional(),
      minScore: z.number().min(0).max(100).optional(),
      roles: z.array(z.string()).optional(),
      companySizes: z.array(z.string()).optional(),
      sources: z.array(z.string()).optional(),
      remoteOnly: z.boolean().optional(),
      jobIds: z.array(z.string().uuid()).optional(),
    })
    .default({}),
  sequence: z.array(z.object({ dayOffset: z.number().int().min(0).max(60), kind: z.enum(["initial", "followup"]) })).min(1).max(6).default(DEFAULT_SEQUENCE),
  sendWindow: z.object({ startHour: z.number().min(0).max(23), endHour: z.number().min(1).max(24), weekdaysOnly: z.boolean(), preferredHour: z.number().min(0).max(23).optional() }).default(DEFAULT_SEND_WINDOW),
  abTest: z.boolean().default(false),
  emailAccountId: z.string().uuid().optional(),
  includeResume: z.boolean().default(true),
});

campaignsRouter.get("/", async (req, res) => {
  const user = me(req);
  const rows = await db.select().from(schema.campaigns).where(eq(schema.campaigns.userId, user.id)).orderBy(desc(schema.campaigns.createdAt));
  const stats = await db.select({ campaignId: schema.messages.campaignId, status: schema.messages.status, repliedAt: schema.messages.repliedAt, openedAt: schema.messages.openedAt }).from(schema.messages).where(eq(schema.messages.userId, user.id));
  res.json({
    items: rows.map((c) => {
      const ms = stats.filter((s) => s.campaignId === c.id);
      return { ...c, stats: { total: ms.length, sent: ms.filter((m) => m.status === "sent").length, pending: ms.filter((m) => m.status === "pending_approval").length, scheduled: ms.filter((m) => m.status === "scheduled").length, replied: ms.filter((m) => m.repliedAt).length, opened: ms.filter((m) => m.openedAt).length } };
    }),
  });
});

campaignsRouter.post("/", async (req, res) => {
  const user = me(req);
  const body = CampaignBody.parse(req.body);
  if (body.mode === "autopilot" && !planAllows(user.plan, "autopilot")) throw forbidden("Autopilot is a Pro feature");
  const [c] = await db.insert(schema.campaigns).values({ ...body, userId: user.id }).returning();
  res.status(201).json({ campaign: c });
});

async function ownCampaign(userId: string, id: string) {
  const [c] = await db.select().from(schema.campaigns).where(and(eq(schema.campaigns.id, id), eq(schema.campaigns.userId, userId)));
  if (!c) throw notFound("Campaign not found");
  return c;
}

campaignsRouter.get("/:id", async (req, res) => {
  const user = me(req);
  const campaign = await ownCampaign(user.id, req.params.id);
  const messages = await db
    .select({ message: schema.messages, contact: schema.contacts, company: schema.companies })
    .from(schema.messages)
    .leftJoin(schema.contacts, eq(schema.messages.contactId, schema.contacts.id))
    .leftJoin(schema.companies, eq(schema.contacts.companyId, schema.companies.id))
    .where(eq(schema.messages.campaignId, campaign.id))
    .orderBy(desc(schema.messages.createdAt));
  res.json({ campaign, messages: messages.map((m) => ({ ...m.message, contact: m.contact, company: m.company })) });
});

campaignsRouter.get("/:id/preview", async (req, res) => {
  const user = me(req);
  const campaign = await ownCampaign(user.id, req.params.id);
  const targets = await campaignTargets(user, campaign);
  res.json({ count: targets.length, companies: [...new Set(targets.map((t) => t.company.name))].slice(0, 50), items: targets.slice(0, 50).map((t) => ({ job: t.job, company: t.company, score: t.match?.score })) });
});

campaignsRouter.patch("/:id", async (req, res) => {
  const user = me(req);
  await ownCampaign(user.id, req.params.id);
  const body = CampaignBody.partial().extend({ status: z.enum(["draft", "active", "paused", "completed"]).optional() }).parse(req.body);
  if (body.mode === "autopilot" && !planAllows(user.plan, "autopilot")) throw forbidden("Autopilot is a Pro feature");
  const [c] = await db.update(schema.campaigns).set(body).where(eq(schema.campaigns.id, req.params.id)).returning();
  // Switching to autopilot schedules anything waiting for approval
  if (body.mode === "autopilot") {
    const pending = await db.select().from(schema.messages).where(and(eq(schema.messages.campaignId, c.id), eq(schema.messages.status, "pending_approval")));
    for (const m of pending) await scheduleMessage(m.id);
  }
  res.json({ campaign: c });
});

campaignsRouter.post("/:id/launch", async (req, res) => {
  const opts = z.object({ maxCompanies: z.number().int().min(1).max(200).optional() }).parse(req.body ?? {});
  res.json(await launchCampaign(me(req), req.params.id, opts));
});

campaignsRouter.delete("/:id", async (req, res) => {
  const user = me(req);
  await ownCampaign(user.id, req.params.id);
  await db.update(schema.messages).set({ status: "cancelled" }).where(and(eq(schema.messages.campaignId, req.params.id), inArray(schema.messages.status, ["draft", "pending_approval", "scheduled"])));
  await db.delete(schema.campaigns).where(eq(schema.campaigns.id, req.params.id));
  res.json({ ok: true });
});

// One-click pause for all sending
export const sendingRouter = Router();
sendingRouter.post("/pause", async (req, res) => {
  await setPaused(me(req).id, true);
  res.json({ paused: true });
});
sendingRouter.post("/resume", async (req, res) => {
  await setPaused(me(req).id, false);
  res.json({ paused: false });
});
