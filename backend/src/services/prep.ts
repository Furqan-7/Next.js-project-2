import { extractSkills, rankProjects } from "shared";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { aiStructured } from "../lib/llm";
import { db, schema } from "db";
import type { PrepPackContent } from "db/schema";
import { notFound } from "../lib/errors";
import { researchCompany } from "./research";

const PrepSchema = z.object({
  companyBrief: z.string(),
  likelyQuestions: z.array(z.object({ question: z.string(), why: z.string(), category: z.enum(["technical", "behavioral", "company"]) })),
  yourStories: z.array(z.object({ prompt: z.string(), story: z.string(), project: z.string().optional() })),
  questionsToAsk: z.array(z.string()),
  negotiation: z.array(z.string()),
  checklist: z.array(z.string()),
});

const TECH_QUESTIONS: Record<string, string[]> = {
  React: ["How does React reconciliation work, and when would you use useMemo or useCallback?", "How would you structure state for a complex form?"],
  "Next.js": ["When would you choose server components vs client components?", "How do you handle data fetching and caching in the App Router?"],
  TypeScript: ["Explain generics with a real example from your code.", "What's the difference between `unknown` and `any`?"],
  "Node.js": ["How does the event loop handle I/O, and what blocks it?", "How would you design rate limiting for an API?"],
  PostgreSQL: ["How would you find and fix a slow query?", "When do you add an index, and what does it cost?"],
  Python: ["How do generators help with large data?", "What are common pitfalls with mutable default arguments?"],
  LLMs: ["How would you evaluate the quality of an LLM feature?", "How do you reduce hallucinations in a RAG system?"],
  "System Design": ["Design a URL shortener. What breaks first at 10× traffic?"],
  Redis: ["When would you use Redis instead of the database, and how do you handle cache invalidation?"],
};

export function fallbackPrep(input: { company: typeof schema.companies.$inferSelect; job?: typeof schema.jobs.$inferSelect | null; profile: typeof schema.profiles.$inferSelect; fresher: boolean }): PrepPackContent {
  const target = `${input.job?.title ?? ""} ${input.job?.description ?? ""} ${input.company.techStack.join(" ")}`;
  const skills = extractSkills(target).filter((s) => TECH_QUESTIONS[s]);
  const ranked = rankProjects(input.profile.projects, target).slice(0, 3);
  const technical = skills.slice(0, 4).flatMap((s) => TECH_QUESTIONS[s].map((q) => ({ question: q, why: `${s} appears in the role or their stack`, category: "technical" as const })));
  return {
    companyBrief: [
      input.company.product ? `${input.company.name}: ${input.company.product}` : input.company.description ?? input.company.name,
      input.company.techStack.length ? `Stack: ${input.company.techStack.slice(0, 8).join(", ")}` : "",
      input.company.recentNews[0] ? `Recent: ${input.company.recentNews[0].title}` : "",
    ]
      .filter(Boolean)
      .map((x) => x.replace(/[.\s]+$/, ""))
      .join(". ")
      .concat("."),
    likelyQuestions: [
      { question: `Why ${input.company.name}?`, why: "Asked in almost every first round", category: "company" },
      { question: "Walk me through a project you're proud of.", why: "Tests depth and ownership", category: "behavioral" },
      { question: "Tell me about a time you got stuck. What did you do?", why: "Problem-solving and communication", category: "behavioral" },
      ...technical,
      ...(input.fresher ? [{ question: "Reverse a linked list / find duplicates in an array: talk through complexity.", why: "Common DSA screen for interns", category: "technical" as const }] : []),
    ],
    yourStories: ranked.map((r) => ({
      prompt: `When they ask about ${r.overlap[0] ?? "a relevant project"}`,
      story: `Situation: ${r.project.description} Task: what you owned. Action: how you built it with ${r.project.technologies.slice(0, 3).join(", ")}. Result: a number if you have one (users, latency, time saved).`,
      project: r.project.name,
    })),
    questionsToAsk: ["What does success look like in the first 90 days?", "What's the biggest technical challenge the team is facing right now?", "How do you review code and ship to production?", "What's the next step in the process?"],
    negotiation: input.fresher
      ? ["Ask for the stipend range before sharing a number.", "Compare with similar internships (location, remote or onsite, duration).", "If the stipend is fixed, ask about a PPO (pre-placement offer), mentorship, or a laptop/WFH allowance.", "Get the offer in writing, with start date and duration."]
      : ["Let them name a number first; if pushed, give a researched range anchored at the top.", "Negotiate total compensation: base, bonus, equity (vesting and cliff), joining bonus.", "Use competing offers honestly; never bluff.", "Ask for a day to review; reply in writing."],
    checklist: ["Re-read the job description and their homepage", "Test your camera, mic and screen-share", "Have your project links open", "Prepare a 60-second intro", "Send a thank-you note within 24 hours"],
  };
}

/** Build (or rebuild) the interview prep pack for an application. */
export async function buildPrepPack(userId: string, applicationId: string) {
  const [app] = await db.select().from(schema.applications).where(eq(schema.applications.id, applicationId));
  if (!app || app.userId !== userId) throw notFound("Application not found");
  let [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, app.companyId));
  if (!company.researchedAt) {
    try {
      company = await researchCompany(company.id);
    } catch {
      /* offline */
    }
  }
  const [job] = app.jobId ? await db.select().from(schema.jobs).where(eq(schema.jobs.id, app.jobId)) : [null];
  const [profile] = await db.select().from(schema.profiles).where(eq(schema.profiles.userId, userId));
  const replies = await db.select().from(schema.replies).where(eq(schema.replies.applicationId, applicationId)).orderBy(desc(schema.replies.receivedAt)).limit(3);
  const fresher = profile.experienceLevel === "fresher";
  const { data } = await aiStructured({
    task: "prep_pack",
    schema: PrepSchema,
    system: `You are an interview coach. Build a prep pack for a candidate's upcoming interview.
- companyBrief: 3-4 sentences from the provided research only.
- likelyQuestions: 8-12, mixing technical (based on the job and stack), behavioral and company questions, each with why it's likely.
- yourStories: 3-4 STAR stories drawn ONLY from the candidate's real projects/experience.
- questionsToAsk: 4-5 sharp questions for the interviewer.
- negotiation: ${fresher ? "stipend negotiation tips for an intern/fresher" : "salary/CTC negotiation tips"}.
- checklist: practical day-before items.`,
    prompt: `<company>${JSON.stringify({ name: company.name, product: company.product, stack: company.techStack, news: company.recentNews.slice(0, 5), size: company.size, teamSize: company.teamSize })}</company>
<job>${job ? JSON.stringify({ title: job.title, description: job.description.slice(0, 6000) }) : "General interview (no specific job)"}</job>
<candidate>${JSON.stringify({ level: profile.experienceLevel, years: profile.yearsExperience, skills: profile.skills, projects: profile.projects, experience: profile.experience })}</candidate>
<recent_emails>${replies.map((r) => r.body.slice(0, 1500)).join("\n---\n")}</recent_emails>`,
    effort: "medium",
    fallback: () => fallbackPrep({ company, job, profile, fresher }),
  });
  const [pack] = await db.insert(schema.prepPacks).values({ userId, applicationId, content: data }).returning();
  return pack;
}
