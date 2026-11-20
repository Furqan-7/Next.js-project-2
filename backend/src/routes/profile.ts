import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  COMPANY_SIZES,
  EMPLOYMENT_TYPES,
  EXPERIENCE_LEVELS,
  guessTimezone,
  normalizeSkills,
  TARGET_ROLES,
  WORK_MODES,
  type Project,
} from "shared";
import { eq } from "drizzle-orm";
import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { me } from "../lib/auth";
import { config } from "../config";
import { db, schema } from "db";
import { badRequest } from "../lib/errors";
import { scoreJobsForUser } from "../ingest";
import { analyzeWritingStyle, enrichGithub, enrichPortfolio, githubReposToProjects, linkedinNote } from "../services/enrich";
import { parseResume } from "../services/resume";
import { resumePath, UPLOAD_DIR } from "../lib/storage";

export const profileRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

const ProjectZ = z.object({ name: z.string(), description: z.string().default(""), technologies: z.array(z.string()).default([]), url: z.string().optional(), highlights: z.array(z.string()).optional() });

const ProfilePatch = z.object({
  name: z.string().min(1).optional(),
  phone: z.string().optional(),
  headline: z.string().optional(),
  summary: z.string().optional(),
  experienceLevel: z.enum(EXPERIENCE_LEVELS).optional(),
  yearsExperience: z.number().min(0).max(50).optional(),
  targetRoles: z.array(z.enum(TARGET_ROLES)).optional(),
  skills: z.array(z.string()).optional(),
  projects: z.array(ProjectZ).optional(),
  experience: z.array(z.object({ company: z.string(), title: z.string(), start: z.string().optional(), end: z.string().optional(), description: z.string().optional(), technologies: z.array(z.string()).optional() })).optional(),
  education: z.array(z.object({ institution: z.string(), degree: z.string().optional(), field: z.string().optional(), start: z.string().optional(), end: z.string().optional(), grade: z.string().optional() })).optional(),
  links: z.object({ github: z.string().optional(), linkedin: z.string().optional(), portfolio: z.string().optional() }).optional(),
  preferences: z
    .object({
      workModes: z.array(z.enum(WORK_MODES)).default([]),
      cities: z.array(z.string()).default([]),
      expectedComp: z.object({ min: z.number().optional(), max: z.number().optional(), currency: z.string(), period: z.enum(["month", "year"]) }).optional(),
      companySizes: z.array(z.enum(COMPANY_SIZES)).default([]),
      industries: z.array(z.string()).default([]),
      employmentTypes: z.array(z.enum(EMPLOYMENT_TYPES)).default([]),
    })
    .optional(),
  writingSample: z.string().max(10000).optional(),
  college: z.string().optional(),
  timezone: z.string().optional(),
  publicVisible: z.boolean().optional(),
  resumeUrl: z.string().url().optional().or(z.literal("")),
});

profileRouter.get("/", async (req, res) => {
  const [profile] = await db.select().from(schema.profiles).where(eq(schema.profiles.userId, me(req).id));
  res.json({ profile });
});

profileRouter.put("/", async (req, res) => {
  const user = me(req);
  const body = ProfilePatch.parse(req.body);
  const { name, phone, ...p } = body;
  if (name || phone !== undefined) await db.update(schema.users).set({ ...(name ? { name } : {}), ...(phone !== undefined ? { phone } : {}) }).where(eq(schema.users.id, user.id));
  const patch: Partial<typeof schema.profiles.$inferInsert> = { ...p, updatedAt: new Date() };
  if (p.skills) patch.skills = normalizeSkills(p.skills);
  if (p.resumeUrl === "") patch.resumeUrl = null;
  if (p.writingSample) patch.writingStyle = await analyzeWritingStyle(p.writingSample);
  if (p.preferences?.cities?.length && !p.timezone) patch.timezone = guessTimezone(p.preferences.cities[0], "UTC");
  const [profile] = await db.update(schema.profiles).set(patch).where(eq(schema.profiles.userId, user.id)).returning();
  if (p.skills || p.targetRoles || p.preferences || p.experienceLevel || p.projects) await scoreJobsForUser(user.id);
  res.json({ profile });
});

/** Upload a PDF resume (or LinkedIn "Save to PDF" export): AI extracts skills, projects, experience, education. */
profileRouter.post("/resume", upload.single("file"), async (req, res) => {
  const user = me(req);
  const text = typeof req.body?.text === "string" ? req.body.text : undefined;
  if (!req.file && !text) throw badRequest("Attach a PDF as 'file' or send 'text'");
  if (req.file && req.file.mimetype !== "application/pdf" && !req.file.originalname.toLowerCase().endsWith(".pdf")) throw badRequest("Only PDF resumes are supported");
  const { resume, text: extracted, source } = await parseResume({ pdf: req.file?.buffer, text });
  if (source === "fallback" && !extracted.trim()) {
    // Without AI we can only read text-based PDFs; don't wipe the profile with an empty parse.
    throw badRequest("We couldn't read any text from this PDF (it may be a scanned image). Paste the text instead, or set ANTHROPIC_API_KEY so Claude can read it.");
  }
  if (req.file) {
    // Stored for the public profile download and for attaching when someone asks for your resume.
    await mkdir(UPLOAD_DIR, { recursive: true });
    await writeFile(resumePath(user.id), req.file.buffer);
  }
  const [current] = await db.select().from(schema.profiles).where(eq(schema.profiles.userId, user.id));
  // Default: merge, so re-uploading never wipes projects imported from GitHub or added by hand.
  // ?mode=replace swaps everything for what's in the new resume.
  const replace = req.query.mode === "replace";
  const parsedNames = new Set(resume.projects.map((pr) => pr.name.toLowerCase()));
  const [profile] = await db
    .update(schema.profiles)
    .set({
      headline: resume.headline ?? current.headline,
      summary: resume.summary ?? current.summary,
      skills: normalizeSkills(replace ? resume.skills : [...current.skills, ...resume.skills]),
      projects: replace ? resume.projects : [...resume.projects, ...current.projects.filter((pr) => !parsedNames.has(pr.name.toLowerCase()))],
      experience: replace || resume.experience.length ? resume.experience : current.experience,
      education: replace || resume.education.length ? resume.education : current.education,
      links: { ...current.links, ...Object.fromEntries(Object.entries(resume.links).filter(([, v]) => v)) },
      yearsExperience: replace || resume.yearsExperience > 0 ? resume.yearsExperience : current.yearsExperience,
      experienceLevel: resume.yearsExperience >= 1 ? "experienced" : current.experienceLevel,
      college: current.college ?? resume.education[0]?.institution ?? null,
      resumeText: extracted.slice(0, 50000),
      resumeFileName: req.file?.originalname ?? current.resumeFileName,
      updatedAt: new Date(),
    })
    .where(eq(schema.profiles.userId, user.id))
    .returning();
  if (resume.name && user.name !== resume.name && user.name.length < 3) await db.update(schema.users).set({ name: resume.name }).where(eq(schema.users.id, user.id));
  res.json({ profile, parsed: resume, source });
});

/** Connect GitHub / portfolio / LinkedIn to enrich the profile. */
profileRouter.post("/enrich", async (req, res) => {
  const user = me(req);
  const body = z.object({ github: z.string().optional(), portfolio: z.string().optional(), linkedin: z.string().optional() }).parse(req.body);
  const [current] = await db.select().from(schema.profiles).where(eq(schema.profiles.userId, user.id));
  const enrichment: Record<string, unknown> = { ...current.enrichment };
  let skills = [...current.skills];
  let projects: Project[] = [...current.projects];
  const errors: string[] = [];
  if (body.github) {
    const gh = await enrichGithub(body.github);
    if (gh) {
      enrichment.github = gh;
      skills = normalizeSkills([...skills, ...gh.skills]);
      const known = new Set(projects.map((p) => p.name.toLowerCase()));
      projects = [...projects, ...githubReposToProjects(gh).filter((p) => !known.has(p.name.toLowerCase()))];
    } else errors.push("Couldn't read that GitHub profile");
  }
  if (body.portfolio) {
    const pf = await enrichPortfolio(body.portfolio);
    if (pf) {
      enrichment.portfolio = pf;
      skills = normalizeSkills([...skills, ...pf.skills]);
      const known = new Set(projects.map((p) => p.name.toLowerCase()));
      projects = [...projects, ...pf.projects.filter((p) => !known.has(p.name.toLowerCase()))];
    } else errors.push("Couldn't read that portfolio site");
  }
  if (body.linkedin) enrichment.linkedin = linkedinNote(body.linkedin);
  const [profile] = await db
    .update(schema.profiles)
    .set({ enrichment, skills, projects, links: { ...current.links, ...Object.fromEntries(Object.entries(body).filter(([, v]) => v)) }, updatedAt: new Date() })
    .where(eq(schema.profiles.userId, user.id))
    .returning();
  res.json({ profile, errors });
});

profileRouter.post("/complete-onboarding", async (req, res) => {
  const user = me(req);
  await db.update(schema.users).set({ onboardedAt: new Date() }).where(eq(schema.users.id, user.id));
  const scored = await scoreJobsForUser(user.id);
  res.json({ ok: true, scored });
});
