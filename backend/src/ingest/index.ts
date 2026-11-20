import { dedupeKey, detectScam, detectWorkMode, scoreJob, type ProfileForMatching, type TargetRole } from "shared";
import { and, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { aiStructured } from "../lib/llm";
import { db, schema } from "db";
import { logger } from "../lib/logger";
import { findOrCreateCompany } from "../services/companies";
import { notify } from "../services/notify";
import {
  configuredBoards,
  fetchAts,
  fetchFundingNews,
  fetchHnWhosHiring,
  fetchRemoteOk,
  fetchRemotive,
  fetchXHiringPosts,
  fetchYc,
  type FundingItem,
  type RawJob,
} from "./sources";

export type Job = typeof schema.jobs.$inferSelect;

export interface IngestResult {
  received: number;
  inserted: number;
  merged: number;
  jobIds: string[];
}

/** Upsert raw jobs: dedupe across platforms, attach companies, compute scam signals. */
export async function ingestJobs(raw: RawJob[]): Promise<IngestResult> {
  const result: IngestResult = { received: raw.length, inserted: 0, merged: 0, jobIds: [] };
  for (const r of raw) {
    if (!r.title || !r.company || !r.url) continue;
    const key = r.isHiringPost ? `post|${r.externalId}` : dedupeKey({ company: r.company, title: r.title, location: r.remote ? "remote" : r.location });
    const [existing] = await db.select().from(schema.jobs).where(eq(schema.jobs.dedupeKey, key));
    if (existing) {
      if (!existing.sources.some((s) => s.url === r.url)) {
        await db
          .update(schema.jobs)
          .set({
            sources: [...existing.sources, { source: r.source, url: r.url }],
            // keep the richest description
            description: r.description.length > existing.description.length ? r.description : existing.description,
          })
          .where(eq(schema.jobs.id, existing.id));
        result.merged++;
      }
      continue;
    }
    const company = await findOrCreateCompany({ name: r.company, domain: r.companyDomain, location: r.location });
    const scam = detectScam({ title: r.title, company: r.company, description: r.description, url: r.url, salaryMin: r.salaryMin, salaryMax: r.salaryMax, currency: r.currency });
    const [row] = await db
      .insert(schema.jobs)
      .values({
        source: r.source,
        externalId: r.externalId,
        url: r.url,
        title: r.title,
        companyName: r.company,
        companyId: company.id,
        location: r.location ?? null,
        remote: Boolean(r.remote),
        workMode: r.remote ? "remote" : detectWorkMode(`${r.location ?? ""} ${r.description.slice(0, 600)}`),
        employmentType: r.employmentType ?? null,
        description: r.description.slice(0, 30000),
        salaryMin: r.salaryMin ?? null,
        salaryMax: r.salaryMax ?? null,
        currency: r.currency ?? null,
        tags: (r.tags ?? []).slice(0, 20),
        postedAt: r.postedAt && !Number.isNaN(r.postedAt.getTime()) ? r.postedAt : null,
        dedupeKey: key,
        sources: [{ source: r.source, url: r.url }],
        scamScore: scam.score,
        scamReasons: scam.reasons,
        isHiringPost: Boolean(r.isHiringPost),
      })
      .onConflictDoNothing()
      .returning({ id: schema.jobs.id });
    if (row) {
      result.inserted++;
      result.jobIds.push(row.id);
    }
  }
  return result;
}

export type ProfileRow = typeof schema.profiles.$inferSelect;

export function toMatchingProfile(p: ProfileRow): ProfileForMatching {
  return {
    skills: p.skills,
    targetRoles: p.targetRoles as TargetRole[],
    experienceLevel: p.experienceLevel,
    yearsExperience: p.yearsExperience,
    preferences: p.preferences,
    projects: p.projects,
  };
}

/** Score jobs for one user (all recent jobs if `jobIds` is omitted). */
export async function scoreJobsForUser(userId: string, jobIds?: string[]): Promise<number> {
  const [profile] = await db.select().from(schema.profiles).where(eq(schema.profiles.userId, userId));
  if (!profile) return 0;
  const mp = toMatchingProfile(profile);
  const since = new Date(Date.now() - 60 * 86400000);
  const rows = await db
    .select({ job: schema.jobs, company: schema.companies })
    .from(schema.jobs)
    .leftJoin(schema.companies, eq(schema.jobs.companyId, schema.companies.id))
    .where(jobIds ? inArray(schema.jobs.id, jobIds.length ? jobIds : ["00000000-0000-0000-0000-000000000000"]) : gte(schema.jobs.createdAt, since))
    .limit(5000);
  let n = 0;
  for (const { job, company } of rows) {
    const m = scoreJob(mp, {
      title: job.title,
      company: job.companyName,
      description: job.description,
      location: job.location,
      remote: job.remote,
      workMode: job.workMode as never,
      employmentType: job.employmentType as never,
      salaryMin: job.salaryMin,
      salaryMax: job.salaryMax,
      currency: job.currency,
      tags: job.tags,
      companySize: company?.size ?? null,
      industry: company?.industry ?? null,
    });
    // Likely scams are pushed down hard.
    const score = job.scamScore >= 50 ? Math.min(m.score, 10) : job.scamScore >= 25 ? Math.round(m.score * 0.7) : m.score;
    await db
      .insert(schema.jobMatches)
      .values({ userId, jobId: job.id, score, reasons: m.reasons, matchedSkills: m.matchedSkills, missingSkills: m.missingSkills })
      .onConflictDoUpdate({
        target: [schema.jobMatches.userId, schema.jobMatches.jobId],
        set: { score, reasons: m.reasons, matchedSkills: m.matchedSkills, missingSkills: m.missingSkills },
      });
    n++;
  }
  return n;
}

export async function scoreJobsForAllUsers(jobIds: string[]) {
  if (!jobIds.length) return;
  const users = await db.select({ id: schema.users.id }).from(schema.users).where(isNotNull(schema.users.onboardedAt));
  for (const u of users) {
    await scoreJobsForUser(u.id, jobIds);
    const strong = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(schema.jobMatches)
      .where(and(eq(schema.jobMatches.userId, u.id), inArray(schema.jobMatches.jobId, jobIds), gte(schema.jobMatches.score, 75)));
    const count = strong[0]?.c ?? 0;
    if (count > 0) await notify(u.id, { type: "new_matches", title: `${count} new strong job match${count > 1 ? "es" : ""}`, body: "Fresh roles that fit your profile are in your feed.", link: "/jobs" });
  }
}

const AiMatchSchema = z.object({ score: z.number().min(0).max(100), reasons: z.array(z.string()), concerns: z.array(z.string()) });

/** On-demand AI second opinion for one job, blended with the deterministic score. */
export async function aiMatch(userId: string, jobId: string) {
  const [profile] = await db.select().from(schema.profiles).where(eq(schema.profiles.userId, userId));
  const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
  const [existing] = await db.select().from(schema.jobMatches).where(and(eq(schema.jobMatches.userId, userId), eq(schema.jobMatches.jobId, jobId)));
  if (!profile || !job) return null;
  const base = existing ?? null;
  const { data, source } = await aiStructured({
    task: "match",
    schema: AiMatchSchema,
    system: "You assess how well a candidate fits a job. Score 0-100. Reasons must cite specific overlaps (skills, projects, seniority, location). Concerns list real gaps. Be calibrated, not flattering.",
    prompt: `<candidate>\n${JSON.stringify({ level: profile.experienceLevel, years: profile.yearsExperience, roles: profile.targetRoles, skills: profile.skills, projects: profile.projects.map((p) => ({ name: p.name, tech: p.technologies, desc: p.description })), preferences: profile.preferences })}\n</candidate>\n<job>\n${job.title} at ${job.companyName} (${job.location ?? "n/a"})\n${job.description.slice(0, 8000)}\n</job>`,
    effort: "low",
    fallback: () => ({ score: base?.score ?? 50, reasons: base?.reasons ?? [], concerns: base?.missingSkills.map((s) => `No ${s} experience listed`) ?? [] }),
  });
  const blended = source === "ai" && base ? Math.round(base.score * 0.5 + data.score * 0.5) : data.score;
  if (base) await db.update(schema.jobMatches).set({ score: blended, reasons: data.reasons.length ? data.reasons : base.reasons }).where(and(eq(schema.jobMatches.userId, userId), eq(schema.jobMatches.jobId, jobId)));
  return { score: blended, reasons: data.reasons, concerns: data.concerns, source };
}

export async function ingestFunding(items: FundingItem[]): Promise<number> {
  let n = 0;
  for (const f of items) {
    const company = await findOrCreateCompany({ name: f.companyName });
    const [row] = await db
      .insert(schema.fundingEvents)
      .values({ companyName: f.companyName, companyId: company.id, amount: f.amount, round: f.round, title: f.title, url: f.url, announcedAt: f.announcedAt })
      .onConflictDoNothing()
      .returning({ id: schema.fundingEvents.id });
    if (row) {
      n++;
      const news = [{ title: f.title, url: f.url, date: f.announcedAt?.toISOString() }, ...company.recentNews].slice(0, 10);
      await db.update(schema.companies).set({ recentNews: news, fundingStage: f.round ?? company.fundingStage }).where(eq(schema.companies.id, company.id));
    }
  }
  return n;
}

export type SourceName = "ats" | "remotive" | "remoteok" | "hn" | "yc" | "x" | "funding";
export const ALL_SOURCES: SourceName[] = ["ats", "remotive", "remoteok", "hn", "yc", "x", "funding"];

/** Pull from every configured source, ingest, and score for all users. Each source fails independently. */
export async function runDiscovery(sources: SourceName[] = ALL_SOURCES) {
  const report: Record<string, { ok: boolean; count: number; error?: string }> = {};
  const all: RawJob[] = [];
  const run = async (name: string, fn: () => Promise<RawJob[]>) => {
    try {
      const jobs = await fn();
      all.push(...jobs);
      report[name] = { ok: true, count: jobs.length };
    } catch (e) {
      report[name] = { ok: false, count: 0, error: String(e instanceof Error ? e.message : e) };
      logger.warn(`discovery source ${name} failed`, { error: report[name].error });
    }
  };
  if (sources.includes("ats")) {
    const boards = configuredBoards();
    const extra = await db.select({ type: schema.companies.atsType, token: schema.companies.atsToken }).from(schema.companies).where(isNotNull(schema.companies.atsToken));
    const seen = new Set<string>();
    for (const b of [...boards, ...extra.map((e) => ({ type: e.type!, token: e.token! }))]) {
      const k = `${b.type}:${b.token}`;
      if (seen.has(k)) continue;
      seen.add(k);
      await run(k, () => fetchAts(b.type, b.token));
    }
  }
  if (sources.includes("remotive")) await run("remotive", () => fetchRemotive());
  if (sources.includes("remoteok")) await run("remoteok", () => fetchRemoteOk());
  if (sources.includes("hn")) await run("hn", () => fetchHnWhosHiring());
  if (sources.includes("yc")) await run("yc", () => fetchYc());
  if (sources.includes("x")) await run("x", () => fetchXHiringPosts());
  let funding = 0;
  if (sources.includes("funding")) {
    try {
      funding = await ingestFunding(await fetchFundingNews());
      report.funding = { ok: true, count: funding };
    } catch (e) {
      report.funding = { ok: false, count: 0, error: String(e) };
    }
  }
  const ingest = await ingestJobs(all);
  await scoreJobsForAllUsers(ingest.jobIds);
  return { report, ingest, funding };
}

/** Daily feed: new matches above a threshold, best first, scams hidden. */
export async function dailyFeed(userId: string, opts: { sinceHours?: number; minScore?: number; limit?: number; includeScams?: boolean } = {}) {
  const since = new Date(Date.now() - (opts.sinceHours ?? 24 * 7) * 3600000);
  const rows = await db
    .select({ match: schema.jobMatches, job: schema.jobs, company: schema.companies })
    .from(schema.jobMatches)
    .innerJoin(schema.jobs, eq(schema.jobMatches.jobId, schema.jobs.id))
    .leftJoin(schema.companies, eq(schema.jobs.companyId, schema.companies.id))
    .where(
      and(
        eq(schema.jobMatches.userId, userId),
        gte(schema.jobMatches.score, opts.minScore ?? 0),
        gte(schema.jobMatches.createdAt, since),
        opts.includeScams ? undefined : sql`${schema.jobs.scamScore} < 50`,
        sql`${schema.jobMatches.status} <> 'dismissed'`,
      ),
    )
    .orderBy(desc(schema.jobMatches.score), desc(schema.jobs.createdAt))
    .limit(opts.limit ?? 50);
  return rows;
}
