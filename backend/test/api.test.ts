import { and, eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { db, pool, schema } from "db";
import { SAMPLE_CONTACTS, SAMPLE_JOBS } from "../src/fixtures";
import { ingestJobs } from "../src/ingest";
import { devOutbox } from "../src/services/mail/providers";
import { dispatchDue } from "../src/services/sequencer";
import { tasks } from "../src/tasks";
import { mkdir, writeFile } from "node:fs/promises";
import { resumePath, UPLOAD_DIR } from "../src/lib/storage";
import { makePdf } from "./pdf";

const app = createApp();
const agent = request.agent(app); // keeps the session cookie
const FUTURE = () => new Date(Date.now() + 20 * 86400000);

const RESUME = `Asha Verma
Full Stack Developer
asha.verma@example.com | github.com/ashav

SKILLS
TypeScript, JavaScript, Next.js, React, Node.js, Express, PostgreSQL, Redis, Tailwind CSS, Python

PROJECTS
ShopSmart | Next.js, PostgreSQL, Stripe
• E-commerce storefront with payments and an admin dashboard
ChatDocs | Python, LangChain
• RAG chatbot that answers questions over PDFs

EDUCATION
National Institute of Technology, Trichy
B.Tech in Computer Science, 2022 - 2026
`;

let ids: { userId: string; paynest: string; tallyhouse: string; contact: string; account: string; message: string; campaign: string; app: string } = {} as never;

beforeAll(async () => {
  await ingestJobs(SAMPLE_JOBS);
  for (const c of await db.select().from(schema.companies)) {
    for (const p of SAMPLE_CONTACTS[c.domain ?? ""] ?? []) {
      await db.insert(schema.contacts).values({ companyId: c.id, name: p.name, title: p.title, email: p.email, emailStatus: "valid", emailConfidence: 93, role: /founder|ceo/i.test(p.title) ? "founder" : "cto", timezone: "Asia/Kolkata" }).onConflictDoNothing();
    }
  }
});

afterAll(async () => {
  await pool.end();
});

describe("onboarding & profile", () => {
  it("signs up and reads the session", async () => {
    const res = await agent.post("/api/auth/signup").send({ name: "Asha Verma", email: "asha@example.com", password: "supersecret1" });
    expect(res.status).toBe(201);
    expect(res.body.user.passwordHash).toBeUndefined();
    ids.userId = res.body.user.id;
    const me = await agent.get("/api/auth/me");
    expect(me.body.user.email).toBe("asha@example.com");
    expect(me.body.profile.userId).toBe(ids.userId);
  });

  it("rejects duplicate signup and wrong passwords", async () => {
    expect((await request(app).post("/api/auth/signup").send({ name: "X", email: "asha@example.com", password: "supersecret1" })).status).toBe(400);
    expect((await request(app).post("/api/auth/login").send({ email: "asha@example.com", password: "nope" })).status).toBe(401);
    expect((await request(app).get("/api/profile")).status).toBe(401);
  });

  it("parses a resume into skills, projects and education", async () => {
    const res = await agent.post("/api/profile/resume").field("text", RESUME);
    expect(res.status).toBe(200);
    expect(res.body.source).toBe("fallback");
    expect(res.body.profile.skills).toEqual(expect.arrayContaining(["Next.js", "PostgreSQL", "TypeScript"]));
    expect(res.body.profile.projects.map((p: { name: string }) => p.name)).toEqual(["ShopSmart", "ChatDocs"]);
    expect(res.body.profile.links.github).toBe("https://github.com/ashav");
  });

  it("parses a real PDF upload (text layer)", async () => {
    const other = request.agent(app);
    await other.post("/api/auth/signup").send({ name: "Pdf Tester", email: "pdf@example.com", password: "supersecret1" });
    const pdf = makePdf(["Pdf Tester", "Backend Developer", "SKILLS", "Go, PostgreSQL, Docker, Kubernetes, Redis", "PROJECTS", "QueueKit | Go, Redis", "- A background job queue"]);
    const res = await other.post("/api/profile/resume").attach("file", pdf, { filename: "resume.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(200);
    expect(res.body.profile.skills).toEqual(expect.arrayContaining(["PostgreSQL", "Docker", "Kubernetes", "Redis"]));
    expect(res.body.profile.resumeFileName).toBe("resume.pdf");
  });

  it("refuses an unreadable PDF instead of wiping the profile", async () => {
    const before = (await agent.get("/api/profile")).body.profile.skills;
    const res = await agent.post("/api/profile/resume").attach("file", Buffer.from("%PDF-1.4 garbage"), { filename: "scan.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/couldn't read/i);
    expect((await agent.get("/api/profile")).body.profile.skills).toEqual(before);
  });

  it("re-uploading merges: keeps projects you added, updates matching ones", async () => {
    await agent.put("/api/profile").send({ projects: [{ name: "ShopSmart", description: "old", technologies: [] }, { name: "MyGithubThing", description: "From GitHub", technologies: ["Go"] }] });
    const res = await agent.post("/api/profile/resume").field("text", RESUME);
    const names = res.body.profile.projects.map((p: { name: string }) => p.name);
    expect(names).toEqual(expect.arrayContaining(["ShopSmart", "ChatDocs", "MyGithubThing"]));
    expect(names.filter((n: string) => n === "ShopSmart")).toHaveLength(1);
    const replaced = await agent.post("/api/profile/resume?mode=replace").field("text", RESUME);
    expect(replaced.body.profile.projects.map((p: { name: string }) => p.name)).toEqual(["ShopSmart", "ChatDocs"]);
  });

  it("rejects non-PDF uploads", async () => {
    const res = await agent.post("/api/profile/resume").attach("file", Buffer.from("hello"), "resume.txt");
    expect(res.status).toBe(400);
  });

  it("saves preferences and completes onboarding (scores existing jobs)", async () => {
    const res = await agent.put("/api/profile").send({
      experienceLevel: "fresher",
      targetRoles: ["frontend", "fullstack"],
      preferences: { workModes: ["remote"], cities: ["Bangalore"], companySizes: ["startup"], industries: ["fintech"], employmentTypes: ["internship", "full_time"] },
      writingSample: "Hey! I love building things fast.\n\nThanks,\nAsha",
      publicVisible: true,
    });
    expect(res.status).toBe(200);
    expect(res.body.profile.writingStyle.formality).toBe("casual");
    expect(res.body.profile.timezone).toBe("Asia/Kolkata");
    const done = await agent.post("/api/profile/complete-onboarding");
    expect(done.body.scored).toBeGreaterThan(0);
  });
});

describe("job discovery", () => {
  it("dedupes the same job posted on two boards", async () => {
    const rows = await db.select().from(schema.jobs).where(eq(schema.jobs.title, "Full-stack Engineer"));
    expect(rows).toHaveLength(1);
    expect(rows[0].sources.map((s) => s.source).sort()).toEqual(["hn", "yc"]);
  });

  it("feed ranks matching roles first with reasons, and hides scams", async () => {
    const res = await agent.get("/api/jobs/feed");
    expect(res.status).toBe(200);
    const items = res.body.items as { title: string; companyName: string; match: { score: number; reasons: string[] } }[];
    expect(items.length).toBeGreaterThan(3);
    expect(["PayNest", "Tallyhouse"]).toContain(items[0].companyName);
    expect(items[0].match.score).toBeGreaterThanOrEqual(70);
    expect(items[0].match.reasons.join(" ")).toMatch(/Next\.js|TypeScript/);
    expect(items.find((i) => i.companyName === "Global Opportunities")).toBeUndefined();
    const go = items.find((i) => i.companyName === "Streamline Logistics");
    expect(go!.match.score).toBeLessThan(40);
    ids.paynest = (await db.select().from(schema.companies).where(eq(schema.companies.domain, "paynest.io")))[0].id;
    ids.tallyhouse = (await db.select().from(schema.companies).where(eq(schema.companies.domain, "tallyhouse.app")))[0].id;
  });

  it("flags scams with reasons", async () => {
    const [scam] = await db.select().from(schema.jobs).where(eq(schema.jobs.companyName, "Global Opportunities"));
    expect(scam.scamScore).toBeGreaterThanOrEqual(50);
    expect(scam.scamReasons.length).toBeGreaterThan(1);
  });

  it("imports a job captured manually / by the extension and scores it", async () => {
    const res = await agent.post("/api/jobs/import").send({ title: "React Intern", company: "Wellfound Startup", url: "https://wellfound.com/jobs/1", description: "Remote internship using React, Next.js and TypeScript", source: "wellfound", remote: true });
    expect(res.status).toBe(201);
    expect(res.body.inserted).toBe(1);
    const job = await agent.get(`/api/jobs/${res.body.jobIds[0]}`);
    expect(job.body.match.score).toBeGreaterThan(60);
  });

  it("returns an AI-or-fallback match explanation", async () => {
    const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.companyName, "PayNest"));
    const res = await agent.post(`/api/jobs/${job.id}/ai-match`);
    expect(res.status).toBe(200);
    expect(res.body.source).toBe("fallback");
    expect(res.body.score).toBeGreaterThan(0);
  });
});

describe("people, research card and writer", () => {
  it("shows the company research card with contacts", async () => {
    const res = await agent.get(`/api/companies/${ids.paynest}`);
    expect(res.status).toBe(200);
    expect(res.body.contacts.length).toBe(2);
    expect(res.body.jobs.length).toBeGreaterThan(0);
    ids.contact = res.body.contacts.find((c: { role: string }) => c.role === "founder").id;
  });

  it("adds a contact manually and guesses their email from the company pattern", async () => {
    await db.update(schema.companies).set({ emailPattern: "{first}", emailPatternConfidence: 0.9 }).where(eq(schema.companies.id, ids.paynest));
    const res = await agent.post(`/api/companies/${ids.paynest}/contacts`).send({ name: "Kabir Singh", title: "Engineering Manager" });
    expect(res.status).toBe(201);
    expect(res.body.contact.email).toBe("kabir@paynest.io");
    expect(res.body.contact.role).toBe("hiring_manager");
    expect(res.body.contact.emailCandidates.length).toBeGreaterThan(1);
  });

  it("writes LinkedIn notes (≤300 chars) and cover letters", async () => {
    const note = await agent.post("/api/outreach/generate").send({ kind: "linkedin_note", contactId: ids.contact });
    expect(note.status).toBe(201);
    expect(note.body.draft.content.length).toBeLessThanOrEqual(300);
    const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.companyName, "PayNest"));
    const cl = await agent.post("/api/outreach/generate").send({ kind: "cover_letter", contactId: ids.contact, jobId: job.id });
    expect(cl.body.draft.content).toContain("PayNest");
  });

  it("checks spam words", async () => {
    const res = await agent.post("/api/outreach/spam-check").send({ subject: "FREE OFFER", body: "Click here, act now!!!" });
    expect(res.body.level).toBe("risky");
  });
});

describe("sending, approval and tracking", () => {
  it("refuses to approve without a mailbox", async () => {
    const draft = await agent.post("/api/outreach/drafts").send({ contactId: ids.contact, tone: "founder" });
    expect(draft.status).toBe(201);
    expect(draft.body.message.status).toBe("pending_approval");
    expect(draft.body.message.body).toContain("Riya");
    expect(draft.body.message.subjectVariants.length).toBeGreaterThanOrEqual(3);
    ids.message = draft.body.message.id;
    const res = await agent.post(`/api/outreach/messages/${ids.message}/approve`).send({});
    expect(res.status).toBe(400);
  });

  it("connects a dev mailbox and checks deliverability", async () => {
    const acc = await agent.post("/api/mailboxes/dev").send({ email: "asha.verma@gmail.com" });
    expect(acc.status).toBe(201);
    expect(acc.body.account.accessToken).toBeUndefined();
    ids.account = acc.body.account.id;
    const check = await agent.post(`/api/mailboxes/${ids.account}/check`);
    expect(check.body.dns.hostedProvider).toBe(true);
    expect(check.body.health.score).toBe(100);
  });

  it("approves, edits and sends from the user's mailbox with tracking", async () => {
    const res = await agent.post(`/api/outreach/messages/${ids.message}/approve`).send({ subject: "Built a checkout like yours", sendNow: true });
    expect(res.status).toBe(200);
    const before = devOutbox.length;
    const report = await dispatchDue(new Date(Date.now() + 1000));
    expect(report.sent).toBe(1);
    const sent = devOutbox[before];
    expect(sent.subject).toBe("Built a checkout like yours");
    expect(sent.to).toContain("riya@paynest.io");
    expect(sent.html).toContain("/api/t/o/");
    expect(sent.headers?.["List-Unsubscribe"]).toBeTruthy();
    const [msg] = await db.select().from(schema.messages).where(eq(schema.messages.id, ids.message));
    expect(msg.status).toBe("sent");
    const [appRow] = await db.select().from(schema.applications).where(eq(schema.applications.id, msg.applicationId!));
    expect(appRow.stage).toBe("emailed");
  });

  it("records opens via the tracking pixel (ignores instant prefetch)", async () => {
    const [msg] = await db.select().from(schema.messages).where(eq(schema.messages.id, ids.message));
    await db.update(schema.messages).set({ sentAt: new Date(Date.now() - 60_000) }).where(eq(schema.messages.id, msg.id));
    const res = await request(app).get(`/api/t/o/${msg.trackingId}.gif`);
    expect(res.headers["content-type"]).toBe("image/gif");
    const [after] = await db.select().from(schema.messages).where(eq(schema.messages.id, msg.id));
    expect(after.openCount).toBe(1);
    expect(after.openedAt).toBeTruthy();
  });
});

describe("campaigns and sequences", () => {
  it("blocks bulk campaigns and autopilot on the free plan", async () => {
    const res = await agent.post("/api/campaigns").send({ name: "Startups hiring frontend", mode: "autopilot" });
    expect(res.status).toBe(403);
    const c = await agent.post("/api/campaigns").send({ name: "Startups hiring frontend", filters: { minScore: 50 } });
    expect(c.status).toBe(201);
    const launch = await agent.post(`/api/campaigns/${c.body.campaign.id}/launch`).send({});
    expect(launch.status).toBe(403);
    await agent.delete(`/api/campaigns/${c.body.campaign.id}`);
  });

  it("launches an autopilot bulk campaign on Pro, one email per company, skipping already-contacted ones", async () => {
    expect((await agent.post("/api/billing/plan").send({ plan: "pro" })).body.plan).toBe("pro");
    const c = await agent.post("/api/campaigns").send({ name: "All startups hiring frontend", mode: "autopilot", tone: "casual", filters: { minScore: 40 }, abTest: true });
    expect(c.status).toBe(201);
    ids.campaign = c.body.campaign.id;
    const preview = await agent.get(`/api/campaigns/${ids.campaign}/preview`);
    expect(preview.body.count).toBeGreaterThan(1);
    const launch = await agent.post(`/api/campaigns/${ids.campaign}/launch`).send({});
    expect(launch.status).toBe(200);
    expect(launch.body.created).toBeGreaterThanOrEqual(1);
    expect(launch.body.skipped.some((s: { company: string; reason: string }) => s.company === "PayNest" && s.reason === "already contacted")).toBe(true);
    const msgs = launch.body.messages as { status: string; scheduledAt: string; variant: string | null }[];
    expect(msgs.every((m) => m.status === "scheduled")).toBe(true);
    // Scheduled for 10 AM recipient time (+ jitter) on a weekday
    expect(new Date(msgs[0].scheduledAt).getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(msgs[0].variant).toBe("A");
  });

  it("sends due emails respecting the random gap, then queues a day-3 follow-up", async () => {
    const r1 = await dispatchDue(FUTURE(), { minGapSeconds: 0, maxGapSeconds: 0 });
    expect(r1.sent).toBeGreaterThanOrEqual(1);
    const [th] = await db.select().from(schema.messages).where(and(eq(schema.messages.campaignId, ids.campaign), eq(schema.messages.toEmail, "sam@tallyhouse.app"), eq(schema.messages.step, 0)));
    expect(th.status).toBe("sent");
    const [fu] = await db.select().from(schema.messages).where(and(eq(schema.messages.applicationId, th.applicationId!), eq(schema.messages.step, 1)));
    expect(fu.status).toBe("scheduled");
    expect(fu.subject.startsWith("Re: ")).toBe(true);
    const gapDays = (fu.scheduledAt!.getTime() - th.sentAt!.getTime()) / 86400000;
    expect(gapDays).toBeGreaterThanOrEqual(2.5);
    expect(gapDays).toBeLessThan(7);
    ids.app = th.applicationId!;
  });

  it("approving a follow-up keeps its day-3 slot instead of sending it now", async () => {
    const [fu] = await db.select().from(schema.messages).where(and(eq(schema.messages.applicationId, ids.app), eq(schema.messages.step, 1)));
    const slot = new Date(Date.now() + 3 * 86400000);
    await db.update(schema.messages).set({ status: "pending_approval", scheduledAt: slot }).where(eq(schema.messages.id, fu.id));
    const res = await agent.post(`/api/outreach/messages/${fu.id}/approve`).send({});
    expect(res.status).toBe(200);
    expect(new Date(res.body.message.scheduledAt).getTime()).toBeGreaterThanOrEqual(slot.getTime() - 60_000);
    await db.update(schema.messages).set({ status: "scheduled" }).where(eq(schema.messages.id, fu.id));
  });

  it("enforces a minimum gap between sends from one mailbox", async () => {
    // make two messages due at once
    const due = await db.select().from(schema.messages).where(and(eq(schema.messages.userId, ids.userId), eq(schema.messages.status, "scheduled")));
    for (const m of due) await db.update(schema.messages).set({ scheduledAt: new Date(Date.now() - 1000) }).where(eq(schema.messages.id, m.id));
    const r = await dispatchDue(new Date(), { minGapSeconds: 3600, maxGapSeconds: 3600 });
    expect(r.sent).toBe(0); // last send from this mailbox was moments ago
    expect(r.deferred).toBeGreaterThan(0);
  });

  it("one-click pause stops all sending", async () => {
    await agent.post("/api/sending/pause");
    const r = await dispatchDue(FUTURE(), { minGapSeconds: 0, maxGapSeconds: 0 });
    expect(r.sent).toBe(0);
    await agent.post("/api/sending/resume");
  });
});

describe("replies, bounces and the inbox", () => {
  it("classifies an interested reply, stops the sequence, moves the card and notifies", async () => {
    const [th] = await db.select().from(schema.messages).where(and(eq(schema.messages.applicationId, ids.app), eq(schema.messages.step, 0)));
    const res = await agent.post("/api/inbox/simulate").send({ messageId: th.id, body: "Hi Asha, thanks for reaching out! Would love to chat. What's your availability next week?" });
    expect(res.status).toBe(200);
    expect(res.body.category).toBe("interested");
    expect(res.body.reply.suggestedReply).toMatch(/Tuesday|Thursday/);
    const pending = await db.select().from(schema.messages).where(and(eq(schema.messages.applicationId, ids.app), eq(schema.messages.status, "scheduled")));
    expect(pending).toHaveLength(0);
    const [a] = await db.select().from(schema.applications).where(eq(schema.applications.id, ids.app));
    expect(a.stage).toBe("replied");
    const notes = await agent.get("/api/notifications");
    expect(notes.body.items.some((n: { type: string }) => n.type === "reply")).toBe(true);
    const inbox = await agent.get("/api/inbox");
    expect(inbox.body.items[0].category).toBe("interested");
    const links = await agent.get(`/api/inbox/${inbox.body.items[0].id}/booking-links`);
    expect(links.body.googleCalendar).toContain("calendar.google.com");
  });

  it("responds in-thread with the suggested reply, and the response actually sends", async () => {
    const inbox = await agent.get("/api/inbox");
    const r = inbox.body.items[0];
    const res = await agent.post(`/api/inbox/${r.id}/respond`).send({ body: r.suggestedReply });
    expect(res.status).toBe(201);
    expect(res.body.message.subject).toMatch(/^Re:/);
    const report = await dispatchDue(FUTURE(), { minGapSeconds: 0, maxGapSeconds: 0 });
    expect(report.sent).toBeGreaterThanOrEqual(1);
    const [m] = await db.select().from(schema.messages).where(eq(schema.messages.id, res.body.message.id));
    expect(m.status).toBe("sent"); // used to be cancelled by the "reply received" check
  });

  it("attaches the resume PDF when they ask for it", async () => {
    await mkdir(UPLOAD_DIR, { recursive: true });
    await writeFile(resumePath(ids.userId), makePdf(["Asha Verma resume"]));
    const [company] = await db.select().from(schema.companies).where(eq(schema.companies.domain, "paynest.io"));
    const [dev] = await db.select().from(schema.contacts).where(and(eq(schema.contacts.companyId, company.id), eq(schema.contacts.name, "Dev Malhotra")));
    const d = await agent.post("/api/outreach/drafts").send({ contactId: dev.id });
    await agent.post(`/api/outreach/messages/${d.body.message.id}/approve`).send({ sendNow: true });
    await dispatchDue(FUTURE(), { minGapSeconds: 0, maxGapSeconds: 0 });
    const sim = await agent.post("/api/inbox/simulate").send({ messageId: d.body.message.id, body: "Thanks! Could you send over your resume?" });
    expect(sim.body.category).toBe("asked_for_resume");
    const resp = await agent.post(`/api/inbox/${sim.body.reply.id}/respond`).send({ body: "Here it is!" });
    expect(resp.body.message.attachResume).toBe(true);
    const before = devOutbox.length;
    await dispatchDue(FUTURE(), { minGapSeconds: 0, maxGapSeconds: 0 });
    const sent = devOutbox.slice(before).find((e) => e.text === "Here it is!");
    expect(sent?.attachments?.[0]).toMatchObject({ filename: "Asha_Verma_Resume.pdf", contentType: "application/pdf" });
  });

  it("handles bounces: suppress the address and mark the contact invalid", async () => {
    // a fresh message to a bad address
    const [company] = await db.select().from(schema.companies).where(eq(schema.companies.domain, "lumenai.dev"));
    const [contact] = await db.select().from(schema.contacts).where(eq(schema.contacts.companyId, company.id));
    const d = await agent.post("/api/outreach/drafts").send({ contactId: contact.id });
    await agent.post(`/api/outreach/messages/${d.body.message.id}/approve`).send({ sendNow: true });
    await dispatchDue(FUTURE(), { minGapSeconds: 0, maxGapSeconds: 0 });
    const res = await agent.post("/api/inbox/simulate").send({ messageId: d.body.message.id, body: "Address not found", bounce: true });
    expect(res.body.bounced).toBe(true);
    const [c] = await db.select().from(schema.contacts).where(eq(schema.contacts.id, contact.id));
    expect(c.emailStatus).toBe("invalid");
    const again = await agent.post("/api/outreach/drafts").send({ contactId: contact.id });
    expect(again.status).toBe(400);
  });

  it("respects daily send limits", async () => {
    await db.update(schema.emailAccounts).set({ dailyLimit: 1 }).where(eq(schema.emailAccounts.id, ids.account));
    const [company] = await db.select().from(schema.companies).where(eq(schema.companies.domain, "pixelcraft.design"));
    const [contact] = await db.select().from(schema.contacts).where(eq(schema.contacts.companyId, company.id));
    const d = await agent.post("/api/outreach/drafts").send({ contactId: contact.id });
    await agent.post(`/api/outreach/messages/${d.body.message.id}/approve`).send({ sendNow: true });
    const r = await dispatchDue(new Date(), { minGapSeconds: 0, maxGapSeconds: 0 });
    expect(r.sent).toBe(0);
    const [m] = await db.select().from(schema.messages).where(eq(schema.messages.id, d.body.message.id));
    expect(m.status).toBe("scheduled");
    expect(m.scheduledAt!.getTime()).toBeGreaterThan(Date.now() + 3600_000);
    await db.update(schema.emailAccounts).set({ dailyLimit: 50 }).where(eq(schema.emailAccounts.id, ids.account));
  });
});

describe("CRM tracker, prep and analytics", () => {
  it("shows the kanban board and moves a card to interview (auto-building a prep pack)", async () => {
    const board = await agent.get("/api/crm/board");
    expect(board.body.stages).toEqual(["found", "emailed", "replied", "interview", "offer", "rejected"]);
    expect(board.body.columns.replied.length).toBeGreaterThan(0);
    const res = await agent.patch(`/api/crm/applications/${ids.app}`).send({ stage: "interview" });
    expect(res.body.application.stage).toBe("interview");
    const detail = await agent.get(`/api/crm/applications/${ids.app}`);
    expect(detail.body.prep.content.likelyQuestions.length).toBeGreaterThan(3);
    expect(detail.body.prep.content.negotiation.join(" ")).toMatch(/stipend/i);
    expect(detail.body.events.map((e: { type: string }) => e.type)).toEqual(expect.arrayContaining(["email_sent", "reply", "stage_changed"]));
  });

  it("logs manual applications, notes and reminders", async () => {
    const res = await agent.post("/api/crm/applications").send({ company: "Notion", website: "https://notion.so", roleTitle: "SWE Intern", url: "https://notion.so/careers", note: "Applied via referral" });
    expect(res.status).toBe(201);
    expect(res.body.application.source).toBe("manual");
    await agent.post(`/api/crm/applications/${res.body.application.id}/notes`).send({ text: "Follow up next week" });
    const rem = await agent.post("/api/crm/reminders").send({ text: "Ping Notion recruiter", dueAt: new Date(Date.now() - 1000).toISOString(), applicationId: res.body.application.id });
    expect(rem.status).toBe(201);
    const r = await tasks.reminders();
    expect(r.notified).toBeGreaterThanOrEqual(1);
  });

  it("computes analytics", async () => {
    const res = await agent.get("/api/analytics/overview");
    expect(res.status).toBe(200);
    expect(res.body.totals.sent).toBeGreaterThanOrEqual(3);
    expect(res.body.totals.replied).toBeGreaterThanOrEqual(1);
    expect(res.body.byTemplate.length).toBeGreaterThan(0);
    const advice = await agent.get("/api/analytics/advice");
    expect(advice.body.suggestions.length).toBeGreaterThan(0);
  });
});

describe("extras", () => {
  it("serves a public profile, tailored to a job", async () => {
    const me = await agent.get("/api/auth/me");
    const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.companyName, "Lumen AI"));
    const res = await request(app).get(`/api/public/${me.body.user.publicSlug}?for=${job.id}`);
    expect(res.status).toBe(200);
    expect(res.body.tailoredFor).toContain("Lumen AI");
    expect(res.body.projects[0].name).toBe("ChatDocs");
  });

  it("captures a job page from the Chrome extension", async () => {
    const res = await agent.post("/api/extension/capture").send({ url: "https://jobs.lever.co/tallyhouse/123", title: "Frontend Engineer - Tallyhouse", text: "Frontend Engineer. React, Next.js, TypeScript. Remote.", job: { title: "Frontend Engineer", company: "Tallyhouse" } });
    expect(res.status).toBe(200);
    expect(res.body.company.name).toBe("Tallyhouse");
    expect(res.body.jobId).toBeTruthy();
    expect(res.body.target.email).toBe("sam@tallyhouse.app");
    expect(res.body.draft.body).toContain("Sam");
  });

  it("runs a college plan: admin creates an org, a student joins, admin sees pipelines", async () => {
    const org = await agent.post("/api/org").send({ name: "NIT Trichy Placement Cell", seats: 50 });
    expect(org.status).toBe(201);
    const student = request.agent(app);
    const s = await student.post("/api/auth/signup").send({ name: "Ravi Kumar", email: "ravi@example.com", password: "supersecret1", inviteCode: org.body.org.inviteCode });
    expect(s.body.user.plan).toBe("college");
    const list = await agent.get("/api/org/students");
    expect(list.status).toBe(200);
    expect(list.body.students.map((x: { name: string }) => x.name)).toEqual(expect.arrayContaining(["Asha Verma", "Ravi Kumar"]));
    expect((await student.get("/api/org/students")).status).toBe(403);
  });

  it("reports plan usage", async () => {
    const res = await agent.get("/api/billing");
    expect(res.body.plan).toBe("college");
    expect(res.body.usage.sends.used).toBeGreaterThan(0);
  });

  it("unsubscribe: GET only confirms (link scanners), POST suppresses", async () => {
    const [m] = await db.select().from(schema.messages).where(eq(schema.messages.id, ids.message));
    const page = await request(app).get(`/api/t/u/${m.trackingId}`).expect(200);
    expect(page.text).toContain('method="post"');
    expect(await db.select().from(schema.suppressions).where(eq(schema.suppressions.email, m.toEmail))).toHaveLength(0);
    await request(app).post(`/api/t/u/${m.trackingId}`).type("form").send("List-Unsubscribe=One-Click").expect(200);
    expect(await db.select().from(schema.suppressions).where(eq(schema.suppressions.email, m.toEmail))).toHaveLength(1);
  });

  it("only the person who added a contact can edit it", async () => {
    const [kabir] = await db.select().from(schema.contacts).where(eq(schema.contacts.name, "Kabir Singh"));
    const stranger = request.agent(app);
    await stranger.post("/api/auth/signup").send({ name: "Stranger", email: "stranger@example.com", password: "supersecret1" });
    expect((await stranger.patch(`/api/contacts/${kabir.id}`).send({ title: "CEO" })).status).toBe(403);
    expect((await agent.patch(`/api/contacts/${kabir.id}`).send({ title: "Senior EM" })).status).toBe(200);
  });

  it("sends the daily digest of new matches", async () => {
    const r = await tasks.dailyDigest();
    expect(r.users).toBeGreaterThanOrEqual(1);
    const notes = await agent.get("/api/notifications");
    expect(notes.body.items.some((n: { type: string }) => n.type === "daily_digest")).toBe(true);
  });

  it("uses a role-tailored public profile link in emails", async () => {
    const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.companyName, "PayNest"));
    const [contact] = await db.select().from(schema.contacts).where(eq(schema.contacts.name, "Kabir Singh"));
    const d = await agent.post("/api/outreach/drafts").send({ contactId: contact.id, jobId: job.id });
    expect(d.body.message.body).toContain(`/p/asha-verma?for=${job.id}`);
  });

  it("answers the Outlook webhook validation handshake", async () => {
    const res = await request(app).post("/api/webhooks/outlook?validationToken=abc123");
    expect(res.text).toBe("abc123");
  });
});
