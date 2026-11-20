import { and, desc, eq, gte, ilike, or, sql } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { me } from "../lib/auth";
import { db, schema } from "db";
import { notFound } from "../lib/errors";
import { domainFromUrl } from "../lib/http";
import { findOrCreateCompany } from "../services/companies";
import { aiMatch, ALL_SOURCES, dailyFeed, ingestJobs, runDiscovery, scoreJobsForUser, type SourceName } from "../ingest";
import { detectAts, fetchAts } from "../ingest/sources";
import { upsertApplication } from "../services/sequencer";

export const jobsRouter = Router();

jobsRouter.get("/feed", async (req, res) => {
  const q = z
    .object({ minScore: z.coerce.number().default(0), sinceHours: z.coerce.number().default(24 * 14), limit: z.coerce.number().max(200).default(50), includeScams: z.coerce.boolean().default(false) })
    .parse(req.query);
  const rows = await dailyFeed(me(req).id, q);
  res.json({ items: rows.map(({ match, job, company }) => ({ ...job, match, company })) });
});

jobsRouter.get("/", async (req, res) => {
  const q = z.object({ q: z.string().optional(), source: z.string().optional(), remote: z.coerce.boolean().optional(), minScore: z.coerce.number().optional(), page: z.coerce.number().default(1) }).parse(req.query);
  const userId = me(req).id;
  const conds = [eq(schema.jobMatches.userId, userId)];
  if (q.q) conds.push(or(ilike(schema.jobs.title, `%${q.q}%`), ilike(schema.jobs.companyName, `%${q.q}%`), ilike(schema.jobs.description, `%${q.q}%`))!);
  if (q.source) conds.push(eq(schema.jobs.source, q.source));
  if (q.remote) conds.push(eq(schema.jobs.remote, true));
  if (q.minScore) conds.push(gte(schema.jobMatches.score, q.minScore));
  const rows = await db
    .select({ job: schema.jobs, match: schema.jobMatches, company: schema.companies })
    .from(schema.jobMatches)
    .innerJoin(schema.jobs, eq(schema.jobMatches.jobId, schema.jobs.id))
    .leftJoin(schema.companies, eq(schema.jobs.companyId, schema.companies.id))
    .where(and(...conds))
    .orderBy(desc(schema.jobMatches.score), desc(schema.jobs.createdAt))
    .limit(50)
    .offset((q.page - 1) * 50);
  res.json({ items: rows.map(({ job, match, company }) => ({ ...job, match, company })) });
});

jobsRouter.get("/funding", async (_req, res) => {
  const rows = await db.select().from(schema.fundingEvents).orderBy(desc(schema.fundingEvents.announcedAt)).limit(50);
  res.json({ items: rows });
});

jobsRouter.get("/:id", async (req, res) => {
  const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, req.params.id));
  if (!job) throw notFound("Job not found");
  const [match] = await db.select().from(schema.jobMatches).where(and(eq(schema.jobMatches.jobId, job.id), eq(schema.jobMatches.userId, me(req).id)));
  const [company] = job.companyId ? await db.select().from(schema.companies).where(eq(schema.companies.id, job.companyId)) : [];
  const contacts = company ? await db.select().from(schema.contacts).where(eq(schema.contacts.companyId, company.id)) : [];
  res.json({ job, match: match ?? null, company: company ?? null, contacts });
});

jobsRouter.post("/:id/status", async (req, res) => {
  const { status } = z.object({ status: z.enum(["new", "saved", "dismissed", "applied"]) }).parse(req.body);
  const user = me(req);
  const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, req.params.id));
  if (!job) throw notFound("Job not found");
  await db.update(schema.jobMatches).set({ status }).where(and(eq(schema.jobMatches.jobId, job.id), eq(schema.jobMatches.userId, user.id)));
  let application = null;
  if ((status === "saved" || status === "applied") && job.companyId) {
    application = await upsertApplication({ userId: user.id, companyId: job.companyId, jobId: job.id, roleTitle: job.title, source: status === "applied" ? "manual" : "auto", appliedVia: status === "applied" ? job.url : null });
  }
  res.json({ ok: true, application });
});

jobsRouter.post("/:id/ai-match", async (req, res) => {
  const r = await aiMatch(me(req).id, req.params.id);
  if (!r) throw notFound("Job not found");
  res.json(r);
});

const ImportJob = z.object({
  title: z.string().min(1),
  company: z.string().min(1),
  url: z.string().url(),
  description: z.string().default(""),
  location: z.string().optional(),
  remote: z.boolean().optional(),
  source: z.enum(["manual", "extension", "wellfound", "linkedin", "x", "yc"]).default("manual"),
  companyWebsite: z.string().optional(),
  isHiringPost: z.boolean().optional(),
});

/** Add jobs by hand or from the Chrome extension (LinkedIn, Wellfound and X pages can't be fetched server-side). */
jobsRouter.post("/import", async (req, res) => {
  const items = z.array(ImportJob).or(ImportJob.transform((j) => [j])).parse(req.body);
  const user = me(req);
  const r = await ingestJobs(
    items.map((i) => ({
      source: i.source,
      externalId: `${i.source}:${i.url}`,
      url: i.url,
      title: i.title,
      company: i.company,
      companyDomain: domainFromUrl(i.companyWebsite),
      location: i.location,
      remote: i.remote,
      description: i.description,
      isHiringPost: i.isHiringPost,
    })),
  );
  await scoreJobsForUser(user.id, r.jobIds);
  // Return the matching job ids even when they were merged into existing ones
  const keys = await db.select({ id: schema.jobs.id, title: schema.jobs.title }).from(schema.jobs).where(or(...items.map((i) => sql`${schema.jobs.sources} @> ${JSON.stringify([{ url: i.url }])}::jsonb`)));
  if (keys.length) await scoreJobsForUser(user.id, keys.map((k) => k.id));
  res.status(201).json({ ...r, jobs: keys });
});

/** Run discovery now (normally the worker does this on a schedule). */
jobsRouter.post("/discover", async (req, res) => {
  const { sources } = z.object({ sources: z.array(z.enum(ALL_SOURCES as [SourceName, ...SourceName[]])).optional() }).parse(req.body ?? {});
  const result = await runDiscovery(sources);
  await scoreJobsForUser(me(req).id);
  res.json(result);
});

/** Track a company's careers page: detects Greenhouse/Lever/Ashby/Workable and pulls its jobs. */
jobsRouter.post("/track-careers-page", async (req, res) => {
  const { url, companyName } = z.object({ url: z.string().url(), companyName: z.string().optional() }).parse(req.body);
  const ats = detectAts(url);
  const company = await findOrCreateCompany({ name: companyName ?? ats?.token ?? domainFromUrl(url) ?? url, domain: ats ? null : domainFromUrl(url), atsType: ats?.type, atsToken: ats?.token });
  if (ats) await db.update(schema.companies).set({ atsType: ats.type, atsToken: ats.token }).where(eq(schema.companies.id, company.id));
  let imported = 0;
  let error: string | undefined;
  if (ats) {
    try {
      const raw = await fetchAts(ats.type, ats.token);
      const r = await ingestJobs(raw);
      imported = r.inserted;
      await scoreJobsForUser(me(req).id, r.jobIds);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
  res.json({ company, ats, imported, error });
});
