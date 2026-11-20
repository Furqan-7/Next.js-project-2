import { and, desc, eq, ilike, sql } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { me } from "../lib/auth";
import { db, schema } from "db";
import { forbidden, notFound } from "../lib/errors";
import { domainFromUrl } from "../lib/http";
import { findOrCreateCompany } from "../services/companies";
import { verifyEmail } from "../services/emailVerify";
import { addContact, fetchRecentPosts, findPeople, referralCandidates } from "../services/people";
import { researchCompany } from "../services/research";
import { assertQuota, incrementUsage } from "../services/usage";

export const companiesRouter = Router();

async function getCompany(id: string) {
  const [c] = await db.select().from(schema.companies).where(eq(schema.companies.id, id));
  if (!c) throw notFound("Company not found");
  return c;
}

companiesRouter.get("/", async (req, res) => {
  const { q } = z.object({ q: z.string().optional() }).parse(req.query);
  const rows = await db
    .select({ company: schema.companies, jobs: sql<number>`(select count(*)::int from jobs j where j.company_id = ${schema.companies.id})` })
    .from(schema.companies)
    .where(q ? ilike(schema.companies.name, `%${q}%`) : undefined)
    .orderBy(desc(schema.companies.createdAt))
    .limit(100);
  res.json({ items: rows.map((r) => ({ ...r.company, jobCount: r.jobs })) });
});

companiesRouter.post("/", async (req, res) => {
  const body = z.object({ name: z.string().min(1), website: z.string().optional(), location: z.string().optional() }).parse(req.body);
  const company = await findOrCreateCompany({ name: body.name, domain: domainFromUrl(body.website), website: body.website, location: body.location });
  res.status(201).json({ company });
});

/** Company research card + people + referral candidates + open roles. */
companiesRouter.get("/:id", async (req, res) => {
  const user = me(req);
  const company = await getCompany(req.params.id);
  const contacts = await db.select().from(schema.contacts).where(eq(schema.contacts.companyId, company.id)).orderBy(desc(schema.contacts.emailConfidence));
  const jobs = await db.select().from(schema.jobs).where(eq(schema.jobs.companyId, company.id)).orderBy(desc(schema.jobs.createdAt)).limit(20);
  const funding = await db.select().from(schema.fundingEvents).where(eq(schema.fundingEvents.companyId, company.id)).orderBy(desc(schema.fundingEvents.announcedAt));
  const [profile] = await db.select().from(schema.profiles).where(eq(schema.profiles.userId, user.id));
  const referrals = await referralCandidates(company.id, profile?.college);
  // College plan: classmates in the same organization who've worked at this company
  let alumni: { name: string; title: string }[] = [];
  if (user.orgId) {
    const mates = await db
      .select({ name: schema.users.name, experience: schema.profiles.experience })
      .from(schema.users)
      .innerJoin(schema.profiles, eq(schema.profiles.userId, schema.users.id))
      .where(and(eq(schema.users.orgId, user.orgId), sql`${schema.users.id} <> ${user.id}`));
    alumni = mates.flatMap((m) => m.experience.filter((e) => e.company.toLowerCase().includes(company.name.toLowerCase())).map((e) => ({ name: m.name, title: e.title })));
  }
  res.json({ company, contacts, jobs, funding, referrals, alumni });
});

companiesRouter.post("/:id/research", async (req, res) => {
  res.json({ company: await researchCompany(req.params.id) });
});

companiesRouter.post("/:id/find-people", async (req, res) => {
  const company = await getCompany(req.params.id);
  const r = await findPeople(company, me(req));
  res.json(r);
});

companiesRouter.post("/:id/contacts", async (req, res) => {
  const body = z.object({ name: z.string().min(2), title: z.string().optional(), email: z.string().email().optional(), linkedinUrl: z.string().optional(), college: z.string().optional() }).parse(req.body);
  const company = await getCompany(req.params.id);
  res.status(201).json({ contact: await addContact(company, body, me(req)) });
});

export const contactsRouter = Router();

contactsRouter.post("/:id/verify", async (req, res) => {
  const user = me(req);
  const [c] = await db.select().from(schema.contacts).where(eq(schema.contacts.id, req.params.id));
  if (!c?.email) throw notFound("Contact has no email");
  await assertQuota(user, "verifications");
  const v = await verifyEmail(c.email);
  await incrementUsage(user.id, "verifications");
  const conf = v.status === "valid" ? Math.max(c.emailConfidence, 92) : v.status === "invalid" ? 0 : c.emailConfidence;
  const [updated] = await db.update(schema.contacts).set({ emailStatus: v.status, emailConfidence: conf, verifiedAt: new Date() }).where(eq(schema.contacts.id, c.id)).returning();
  res.json({ contact: updated, verification: v });
});

contactsRouter.post("/:id/posts", async (req, res) => {
  res.json({ contact: await fetchRecentPosts(req.params.id) });
});

contactsRouter.patch("/:id", async (req, res) => {
  const body = z.object({ email: z.string().email().optional(), title: z.string().optional(), college: z.string().optional(), linkedinUrl: z.string().optional(), twitterUrl: z.string().optional(), githubUrl: z.string().optional() }).parse(req.body);
  const [existing] = await db.select().from(schema.contacts).where(eq(schema.contacts.id, String(req.params.id)));
  if (!existing) throw notFound("Contact not found");
  // Contacts are shared across accounts; only the person who added one can edit it.
  if (existing.createdByUserId && existing.createdByUserId !== me(req).id) throw forbidden("Only the person who added this contact can edit it");
  const [updated] = await db.update(schema.contacts).set({ ...body, ...(body.email ? { emailStatus: "unknown", emailConfidence: 50 } : {}) }).where(eq(schema.contacts.id, existing.id)).returning();
  res.json({ contact: updated });
});
