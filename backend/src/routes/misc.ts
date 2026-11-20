import { PLAN_LIMITS, PLANS, rankProjects } from "shared";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { me, requireOrgAdmin } from "../lib/auth";
import { config } from "../config";
import { db, schema } from "db";
import { randomToken } from "../lib/crypto";
import { badRequest, forbidden, notFound } from "../lib/errors";
import { domainFromUrl, stripHtml } from "../lib/http";
import { aiAdvice, analyticsOverview, weeklyReport } from "../services/analytics";
import { findOrCreateCompany } from "../services/companies";
import { ingestJobs, scoreJobsForUser } from "../ingest";
import { detectAts } from "../ingest/sources";
import { addContact, findPeople } from "../services/people";
import { usageSummary } from "../services/usage";
import { generateEmail, loadEmailContext } from "../services/writer";
import { readResume } from "../lib/storage";

// ---------------------------------------------------------------- analytics
export const analyticsRouter = Router();
analyticsRouter.get("/overview", async (req, res) => {
  const { days } = z.object({ days: z.coerce.number().min(1).max(365).default(90) }).parse(req.query);
  res.json(await analyticsOverview(me(req).id, days));
});
analyticsRouter.get("/advice", async (req, res) => {
  res.json({ suggestions: await aiAdvice(me(req).id) });
});
analyticsRouter.post("/weekly-report", async (req, res) => {
  res.json(await weeklyReport(me(req).id));
});

// ---------------------------------------------------------------- notifications
export const notificationsRouter = Router();
notificationsRouter.get("/", async (req, res) => {
  const rows = await db.select().from(schema.notifications).where(eq(schema.notifications.userId, me(req).id)).orderBy(desc(schema.notifications.createdAt)).limit(50);
  res.json({ items: rows, unread: rows.filter((r) => !r.read).length });
});
notificationsRouter.post("/read-all", async (req, res) => {
  await db.update(schema.notifications).set({ read: true }).where(eq(schema.notifications.userId, me(req).id));
  res.json({ ok: true });
});
notificationsRouter.get("/vapid", (_req, res) => res.json({ publicKey: config.VAPID_PUBLIC_KEY ?? null }));
notificationsRouter.post("/push-subscribe", async (req, res) => {
  const user = me(req);
  const sub = z.object({ endpoint: z.string().url(), keys: z.object({ p256dh: z.string(), auth: z.string() }) }).parse(req.body);
  const subs = [...user.pushSubscriptions.filter((s) => (s as { endpoint: string }).endpoint !== sub.endpoint), sub];
  await db.update(schema.users).set({ pushSubscriptions: subs }).where(eq(schema.users.id, user.id));
  res.status(201).json({ ok: true });
});
notificationsRouter.put("/prefs", async (req, res) => {
  const body = z.object({ push: z.boolean(), whatsapp: z.boolean(), email: z.boolean(), phone: z.string().optional() }).parse(req.body);
  const { phone, ...prefs } = body;
  await db.update(schema.users).set({ notificationPrefs: prefs, ...(phone !== undefined ? { phone } : {}) }).where(eq(schema.users.id, me(req).id));
  res.json({ ok: true });
});

// ---------------------------------------------------------------- billing / plans
export const billingRouter = Router();
billingRouter.get("/", async (req, res) => {
  const user = me(req);
  res.json({ plan: user.plan, plans: PLANS.map((p) => ({ id: p, ...PLAN_LIMITS[p] })), usage: await usageSummary(user) });
});
/**
 * Plan switch. In production, wire this to Stripe Checkout + webhooks; here it flips the plan directly
 * outside production so every feature can be tried.
 */
billingRouter.post("/plan", async (req, res) => {
  const user = me(req);
  const { plan } = z.object({ plan: z.enum(["free", "pro"]) }).parse(req.body);
  if (config.NODE_ENV === "production") throw forbidden("Plan changes go through checkout in production");
  if (user.plan === "college") throw badRequest("Your plan is managed by your college");
  await db.update(schema.users).set({ plan }).where(eq(schema.users.id, user.id));
  res.json({ plan });
});

// ---------------------------------------------------------------- college / placement cell
export const orgRouter = Router();
orgRouter.post("/", async (req, res) => {
  const user = me(req);
  if (user.orgId) throw badRequest("You already belong to an organization");
  const body = z.object({ name: z.string().min(2), seats: z.number().int().min(1).max(10000).default(100) }).parse(req.body);
  const [org] = await db.insert(schema.organizations).values({ name: body.name, seats: body.seats, inviteCode: randomToken(6) }).returning();
  await db.update(schema.users).set({ orgId: org.id, orgRole: "admin", plan: "college" }).where(eq(schema.users.id, user.id));
  await db.update(schema.profiles).set({ college: body.name }).where(eq(schema.profiles.userId, user.id));
  res.status(201).json({ org });
});

orgRouter.post("/join", async (req, res) => {
  const user = me(req);
  const { inviteCode } = z.object({ inviteCode: z.string() }).parse(req.body);
  const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.inviteCode, inviteCode));
  if (!org) throw badRequest("Invalid invite code");
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.users).where(eq(schema.users.orgId, org.id));
  if (n >= org.seats) throw badRequest("No free seats");
  await db.update(schema.users).set({ orgId: org.id, orgRole: "member", plan: "college" }).where(eq(schema.users.id, user.id));
  await db.update(schema.profiles).set({ college: org.name }).where(eq(schema.profiles.userId, user.id));
  res.json({ org });
});

/** Placement-cell dashboard: every student's pipeline at a glance. */
orgRouter.get("/students", requireOrgAdmin, async (req, res) => {
  const orgId = me(req).orgId!;
  const since = new Date(Date.now() - 30 * 86400000);
  const students = await db
    .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email, createdAt: schema.users.createdAt, onboardedAt: schema.users.onboardedAt, orgRole: schema.users.orgRole })
    .from(schema.users)
    .where(eq(schema.users.orgId, orgId));
  const out = [];
  for (const s of students) {
    const stages = await db.select({ stage: schema.applications.stage, n: sql<number>`count(*)::int` }).from(schema.applications).where(eq(schema.applications.userId, s.id)).groupBy(schema.applications.stage);
    const [sent] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.messages).where(and(eq(schema.messages.userId, s.id), eq(schema.messages.status, "sent"), gte(schema.messages.sentAt, since)));
    const [replied] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.replies).where(and(eq(schema.replies.userId, s.id), gte(schema.replies.receivedAt, since)));
    out.push({ ...s, pipeline: Object.fromEntries(stages.map((x) => [x.stage, x.n])), sent30d: sent?.n ?? 0, replies30d: replied?.n ?? 0 });
  }
  const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, orgId));
  res.json({ org, students: out, totals: { students: out.length, offers: out.reduce((a, s) => a + (s.pipeline.offer ?? 0), 0), interviews: out.reduce((a, s) => a + (s.pipeline.interview ?? 0), 0) } });
});

orgRouter.post("/students/:id/remove", requireOrgAdmin, async (req, res) => {
  const admin = me(req);
  const [s] = await db.select().from(schema.users).where(and(eq(schema.users.id, String(req.params.id)), eq(schema.users.orgId, admin.orgId!)));
  if (!s) throw notFound("Student not found");
  if (s.id === admin.id) throw badRequest("You can't remove yourself");
  await db.update(schema.users).set({ orgId: null, orgRole: null, plan: "free" }).where(eq(schema.users.id, s.id));
  res.json({ ok: true });
});

orgRouter.post("/rotate-invite", requireOrgAdmin, async (req, res) => {
  const [org] = await db.update(schema.organizations).set({ inviteCode: randomToken(6) }).where(eq(schema.organizations.id, me(req).orgId!)).returning();
  res.json({ org });
});

// ---------------------------------------------------------------- public profile (no auth)
export async function publicProfile(req: Request, res: Response) {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.publicSlug, String(req.params.slug)));
  if (!user) throw notFound("Profile not found");
  const [p] = await db.select().from(schema.profiles).where(eq(schema.profiles.userId, user.id));
  if (!p?.publicVisible) throw notFound("Profile not found");
  // Tailored view: ?for=<jobId> reorders projects by relevance to that job.
  let projects = p.projects;
  let tailoredFor: string | null = null;
  if (typeof req.query.for === "string" && /^[0-9a-f-]{36}$/.test(req.query.for)) {
    const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, req.query.for));
    if (job) {
      projects = rankProjects(p.projects, `${job.title} ${job.description}`).map((r) => r.project);
      tailoredFor = `${job.title} at ${job.companyName}`;
    }
  }
  res.json({
    name: user.name,
    slug: user.publicSlug,
    headline: p.headline,
    summary: p.summary,
    skills: p.skills,
    projects,
    experience: p.experience,
    education: p.education,
    links: p.links,
    experienceLevel: p.experienceLevel,
    targetRoles: p.targetRoles,
    hasResume: Boolean(p.resumeFileName),
    tailoredFor,
  });
}

export async function publicResume(req: Request, res: Response) {
  const slug = String(req.params.slug).replace(/\.pdf$/, "");
  const [user] = await db.select().from(schema.users).where(eq(schema.users.publicSlug, slug));
  const [p] = user ? await db.select().from(schema.profiles).where(eq(schema.profiles.userId, user.id)) : [];
  if (!user || !p?.publicVisible) throw notFound("Not found");
  const buf = await readResume(user.id);
  if (!buf) throw notFound("No resume uploaded");
  res.set({ "content-type": "application/pdf", "content-disposition": `inline; filename="${slug}-resume.pdf"` }).send(buf);
}

// ---------------------------------------------------------------- Chrome extension
export const extensionRouter = Router();
/**
 * One click on any careers page or profile: identify the company, import the job if it's a posting,
 * find people + emails, and draft a message. The extension sends the page text it can already see.
 */
extensionRouter.post("/capture", async (req, res) => {
  const user = me(req);
  const body = z
    .object({
      url: z.string().url(),
      title: z.string().default(""),
      text: z.string().max(200000).default(""),
      kind: z.enum(["auto", "job", "profile", "company"]).default("auto"),
      person: z.object({ name: z.string(), title: z.string().optional(), company: z.string().optional() }).optional(),
      job: z.object({ title: z.string(), company: z.string(), location: z.string().optional(), description: z.string().optional() }).optional(),
      companyWebsite: z.string().optional(),
      draft: z.boolean().default(true),
    })
    .parse(req.body);
  const host = domainFromUrl(body.url) ?? "";
  const isSocial = /linkedin\.com|x\.com|twitter\.com|wellfound\.com|angel\.co|workatastartup\.com/.test(host);
  const ats = detectAts(body.url);
  const companyName = body.job?.company ?? body.person?.company ?? (ats ? ats.token : isSocial ? body.title.split(/[|–-]/).pop()?.trim() : host.split(".")[0]) ?? host;
  const companyDomain = domainFromUrl(body.companyWebsite) ?? (isSocial || ats ? null : host);
  const company = await findOrCreateCompany({ name: companyName, domain: companyDomain, atsType: ats?.type, atsToken: ats?.token });

  let jobId: string | null = null;
  const looksLikeJob = body.kind === "job" || Boolean(body.job) || Boolean(ats) || /\/(jobs?|careers?|positions?)\//i.test(body.url);
  if (looksLikeJob && body.kind !== "profile") {
    const source = /linkedin/.test(host) ? "linkedin" : /wellfound|angel/.test(host) ? "wellfound" : /x\.com|twitter/.test(host) ? "x" : /workatastartup/.test(host) ? "yc" : "extension";
    const r = await ingestJobs([
      {
        source,
        externalId: `${source}:${body.url}`,
        url: body.url,
        title: body.job?.title ?? body.title.split(/[|–-]/)[0].trim() ?? "Role",
        company: company.name,
        companyDomain: company.domain,
        location: body.job?.location,
        description: body.job?.description ?? stripHtml(body.text).slice(0, 20000),
      },
    ]);
    jobId = r.jobIds[0] ?? null;
    if (!jobId) {
      const [existing] = await db.select({ id: schema.jobs.id }).from(schema.jobs).where(sql`${schema.jobs.sources} @> ${JSON.stringify([{ url: body.url }])}::jsonb`);
      jobId = existing?.id ?? null;
    }
    if (jobId) await scoreJobsForUser(user.id, [jobId]);
  }

  let contacts = await db.select().from(schema.contacts).where(eq(schema.contacts.companyId, company.id));
  if (body.person) {
    contacts = [await addContact(company, { name: body.person.name, title: body.person.title, linkedinUrl: /linkedin/.test(host) ? body.url : undefined }, user), ...contacts.filter((c) => c.name !== body.person!.name)];
  } else if (!contacts.length && company.domain && !config.OFFLINE) {
    contacts = (await findPeople(company, user).catch(() => ({ contacts: [] }))).contacts;
  }
  const target = contacts.find((c) => c.email && c.emailStatus !== "invalid");
  let draft: { subject: string; subjects: string[]; body: string } | null = null;
  if (body.draft && target) {
    const gen = await generateEmail(user, await loadEmailContext(user.id, target.id, { jobId, tone: "casual" }));
    draft = { subject: gen.subject, subjects: gen.subjects, body: gen.body };
  }
  res.json({ company, jobId, contacts, target: target ?? null, draft, appUrl: `${config.APP_URL}/companies/${company.id}` });
});
