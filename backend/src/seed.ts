import { eq } from "drizzle-orm";
import { hashPassword } from "./lib/auth";
import { ingestJobs, scoreJobsForUser } from "./ingest";
import { SAMPLE_CONTACTS, SAMPLE_JOBS } from "./fixtures";
import { db, pool, schema } from "db";
import { runMigrations } from "db/migrate";

/** Creates a demo account (demo@jobpilot.dev / demo12345) with a filled profile, jobs, contacts and a dev mailbox. */
export async function seed() {
  await runMigrations();
  const email = "demo@jobpilot.dev";
  let [user] = await db.select().from(schema.users).where(eq(schema.users.email, email));
  if (!user) {
    [user] = await db
      .insert(schema.users)
      .values({ email, name: "Asha Verma", passwordHash: await hashPassword("demo12345"), publicSlug: "asha-verma", onboardedAt: new Date() })
      .returning();
    await db.insert(schema.profiles).values({
      userId: user.id,
      headline: "Full-stack developer (Next.js, Node.js, PostgreSQL)",
      summary: "Final-year CS student who ships products end to end.",
      experienceLevel: "fresher",
      yearsExperience: 0,
      targetRoles: ["frontend", "fullstack", "ai_engineer"],
      skills: ["TypeScript", "JavaScript", "Next.js", "React", "Node.js", "Express", "PostgreSQL", "Redis", "Tailwind CSS", "Python", "LLMs"],
      projects: [
        { name: "ShopSmart", description: "An e-commerce storefront with Stripe payments and an admin dashboard.", technologies: ["Next.js", "TypeScript", "PostgreSQL", "Stripe", "Tailwind CSS"], url: "https://github.com/asha/shopsmart" },
        { name: "ChatDocs", description: "A RAG chatbot that answers questions over uploaded PDFs.", technologies: ["Python", "FastAPI", "LLMs", "RAG", "PostgreSQL"], url: "https://github.com/asha/chatdocs" },
        { name: "InvoiceFlow", description: "Invoice generator for freelancers with reminders and payment links.", technologies: ["React", "Node.js", "Express", "Redis"] },
      ],
      education: [{ institution: "National Institute of Technology, Trichy", degree: "B.Tech", field: "Computer Science", end: "2026" }],
      links: { github: "https://github.com/asha", portfolio: "https://asha.dev" },
      preferences: { workModes: ["remote", "hybrid"], cities: ["Bangalore", "Pune"], companySizes: ["startup"], industries: ["fintech", "ai"], employmentTypes: ["internship", "full_time"], expectedComp: { min: 30000, currency: "INR", period: "month" } },
      writingSample: "Hey! I'm Asha. I like building small, useful things fast and then polishing them.\n\nThanks,\nAsha",
      college: "National Institute of Technology, Trichy",
      timezone: "Asia/Kolkata",
      publicVisible: true,
    });
    await db.insert(schema.emailAccounts).values({ userId: user.id, provider: "dev", email, warmupEnabled: false, dailyLimit: 50 });
  }
  const r = await ingestJobs(SAMPLE_JOBS);
  const companies = await db.select().from(schema.companies);
  for (const c of companies) {
    for (const p of SAMPLE_CONTACTS[c.domain ?? ""] ?? []) {
      await db
        .insert(schema.contacts)
        .values({ companyId: c.id, name: p.name, title: p.title, email: p.email, emailStatus: "valid", emailConfidence: 93, role: /ceo|founder/i.test(p.title) ? "founder" : /cto|head of eng/i.test(p.title) ? "cto" : "hiring_manager", source: "seed", timezone: c.timezone })
        .onConflictDoNothing();
    }
    if (c.domain === "paynest.io") await db.update(schema.companies).set({ product: "checkout and invoicing for small online stores", techStack: ["Next.js", "TypeScript", "Node.js", "PostgreSQL"], size: "startup", teamSize: 18, industry: "fintech", recentNews: [{ title: "PayNest raises $4M seed round" }] }).where(eq(schema.companies.id, c.id));
    if (c.domain === "tallyhouse.app") await db.update(schema.companies).set({ size: "startup", teamSize: 6, product: "bookkeeping automation for small businesses" }).where(eq(schema.companies.id, c.id));
  }
  await scoreJobsForUser(user.id);
  return { user, jobs: r };
}

if (process.argv[1]?.endsWith("seed.ts") || process.argv[1]?.endsWith("seed.js")) {
  seed()
    .then(({ jobs }) => {
      console.log(`seeded: demo@jobpilot.dev / demo12345 (${jobs.inserted} new jobs, ${jobs.merged} merged)`);
      return pool.end();
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
