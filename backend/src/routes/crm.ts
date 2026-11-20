import { STAGES } from "shared";
import { and, asc, desc, eq, lte } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { me } from "../lib/auth";
import { db, schema } from "db";
import { notFound } from "../lib/errors";
import { domainFromUrl } from "../lib/http";
import { findOrCreateCompany } from "../services/companies";
import { buildPrepPack } from "../services/prep";
import { logEvent, stopSequence, upsertApplication } from "../services/sequencer";

export const crmRouter = Router();

/** Kanban board: Found → Emailed → Replied → Interview → Offer → Rejected */
crmRouter.get("/board", async (req, res) => {
  const rows = await db
    .select({ app: schema.applications, company: schema.companies, job: schema.jobs, contact: schema.contacts })
    .from(schema.applications)
    .innerJoin(schema.companies, eq(schema.applications.companyId, schema.companies.id))
    .leftJoin(schema.jobs, eq(schema.applications.jobId, schema.jobs.id))
    .leftJoin(schema.contacts, eq(schema.applications.contactId, schema.contacts.id))
    .where(eq(schema.applications.userId, me(req).id))
    .orderBy(asc(schema.applications.position), desc(schema.applications.updatedAt));
  const columns = Object.fromEntries(STAGES.map((s) => [s, [] as unknown[]]));
  for (const r of rows) {
    columns[r.app.stage].push({ ...r.app, company: { id: r.company.id, name: r.company.name, domain: r.company.domain }, job: r.job ? { id: r.job.id, title: r.job.title, url: r.job.url } : null, contact: r.contact ? { id: r.contact.id, name: r.contact.name, title: r.contact.title } : null });
  }
  res.json({ stages: STAGES, columns });
});

async function ownApp(userId: string, id: string) {
  const [a] = await db.select().from(schema.applications).where(and(eq(schema.applications.id, id), eq(schema.applications.userId, userId)));
  if (!a) throw notFound("Application not found");
  return a;
}

crmRouter.patch("/applications/:id", async (req, res) => {
  const user = me(req);
  const body = z.object({ stage: z.enum(STAGES).optional(), position: z.number().int().optional(), roleTitle: z.string().optional() }).parse(req.body);
  const app = await ownApp(user.id, req.params.id);
  const [u] = await db.update(schema.applications).set({ ...body, updatedAt: new Date() }).where(eq(schema.applications.id, app.id)).returning();
  if (body.stage && body.stage !== app.stage) {
    await logEvent(app.id, "stage_changed", { from: app.stage, to: body.stage, reason: "moved by you" });
    if (["replied", "interview", "offer", "rejected"].includes(body.stage)) await stopSequence(app.id, `moved to ${body.stage}`);
    if (body.stage === "interview") {
      const [existing] = await db.select({ id: schema.prepPacks.id }).from(schema.prepPacks).where(eq(schema.prepPacks.applicationId, app.id));
      if (!existing) await buildPrepPack(user.id, app.id);
    }
  }
  res.json({ application: u });
});

/** Log a job you applied to yourself (company site, LinkedIn Easy Apply, referral…). */
crmRouter.post("/applications", async (req, res) => {
  const user = me(req);
  const body = z
    .object({ company: z.string().min(1), website: z.string().optional(), roleTitle: z.string().optional(), url: z.string().optional(), stage: z.enum(STAGES).default("emailed"), note: z.string().optional(), appliedVia: z.string().optional() })
    .parse(req.body);
  const company = await findOrCreateCompany({ name: body.company, domain: domainFromUrl(body.website) });
  const app = await upsertApplication({ userId: user.id, companyId: company.id, source: "manual", roleTitle: body.roleTitle, stage: body.stage, appliedVia: body.appliedVia ?? body.url });
  await logEvent(app.id, "manual_apply", { url: body.url, via: body.appliedVia });
  if (body.note) await logEvent(app.id, "note", { text: body.note });
  res.status(201).json({ application: app });
});

crmRouter.get("/applications/:id", async (req, res) => {
  const user = me(req);
  const app = await ownApp(user.id, req.params.id);
  const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, app.companyId));
  const [job] = app.jobId ? await db.select().from(schema.jobs).where(eq(schema.jobs.id, app.jobId)) : [];
  const [contact] = app.contactId ? await db.select().from(schema.contacts).where(eq(schema.contacts.id, app.contactId)) : [];
  const events = await db.select().from(schema.applicationEvents).where(eq(schema.applicationEvents.applicationId, app.id)).orderBy(desc(schema.applicationEvents.createdAt));
  const messages = await db.select().from(schema.messages).where(eq(schema.messages.applicationId, app.id)).orderBy(asc(schema.messages.step), asc(schema.messages.createdAt));
  const replies = await db.select().from(schema.replies).where(eq(schema.replies.applicationId, app.id)).orderBy(desc(schema.replies.receivedAt));
  const reminders = await db.select().from(schema.reminders).where(eq(schema.reminders.applicationId, app.id)).orderBy(asc(schema.reminders.dueAt));
  const [prep] = await db.select().from(schema.prepPacks).where(eq(schema.prepPacks.applicationId, app.id)).orderBy(desc(schema.prepPacks.createdAt)).limit(1);
  const drafts = await db.select().from(schema.outreachDrafts).where(eq(schema.outreachDrafts.applicationId, app.id)).orderBy(desc(schema.outreachDrafts.createdAt));
  res.json({ application: app, company, job: job ?? null, contact: contact ?? null, events, messages, replies, reminders, prep: prep ?? null, drafts });
});

crmRouter.post("/applications/:id/notes", async (req, res) => {
  const { text } = z.object({ text: z.string().min(1).max(5000) }).parse(req.body);
  const app = await ownApp(me(req).id, req.params.id);
  await logEvent(app.id, "note", { text });
  await db.update(schema.applications).set({ updatedAt: new Date() }).where(eq(schema.applications.id, app.id));
  res.status(201).json({ ok: true });
});

crmRouter.post("/applications/:id/prep", async (req, res) => {
  res.status(201).json({ prep: await buildPrepPack(me(req).id, req.params.id) });
});

crmRouter.delete("/applications/:id", async (req, res) => {
  const app = await ownApp(me(req).id, req.params.id);
  await stopSequence(app.id, "application deleted");
  await db.delete(schema.applications).where(eq(schema.applications.id, app.id));
  res.json({ ok: true });
});

// Reminders
crmRouter.get("/reminders", async (req, res) => {
  const { due } = z.object({ due: z.coerce.boolean().optional() }).parse(req.query);
  const rows = await db
    .select()
    .from(schema.reminders)
    .where(and(eq(schema.reminders.userId, me(req).id), eq(schema.reminders.done, false), due ? lte(schema.reminders.dueAt, new Date()) : undefined))
    .orderBy(asc(schema.reminders.dueAt));
  res.json({ items: rows });
});

crmRouter.post("/reminders", async (req, res) => {
  const body = z.object({ text: z.string().min(1), dueAt: z.string().datetime(), applicationId: z.string().uuid().optional() }).parse(req.body);
  const user = me(req);
  if (body.applicationId) await ownApp(user.id, body.applicationId);
  const [r] = await db.insert(schema.reminders).values({ userId: user.id, text: body.text, dueAt: new Date(body.dueAt), applicationId: body.applicationId ?? null }).returning();
  if (body.applicationId) await logEvent(body.applicationId, "reminder", { text: body.text, dueAt: body.dueAt });
  res.status(201).json({ reminder: r });
});

crmRouter.patch("/reminders/:id", async (req, res) => {
  const { done } = z.object({ done: z.boolean() }).parse(req.body);
  const [r] = await db.update(schema.reminders).set({ done }).where(and(eq(schema.reminders.id, req.params.id), eq(schema.reminders.userId, me(req).id))).returning();
  if (!r) throw notFound("Reminder not found");
  res.json({ reminder: r });
});
