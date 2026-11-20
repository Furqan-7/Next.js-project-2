import {
  bestProject,
  checkSpam,
  templateCoverLetter,
  templateEmail,
  templateLinkedInNote,
  type EmailContext,
  type ReplyCategory,
  type Tone,
} from "shared";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { aiStructured } from "../lib/llm";
import { config } from "../config";
import { db, schema } from "db";
import { notFound } from "../lib/errors";
import { assertQuota, incrementUsage } from "./usage";

const TONE_GUIDE: Record<Tone, string> = {
  formal: "Polite and professional, complete sentences, no slang. Greeting 'Dear <first name>' or 'Hello <first name>'.",
  casual: "Warm and direct like a message to a friendly acquaintance. 'Hi <first name>'. Contractions are fine.",
  founder: "Founder-to-founder: peer energy, concise, shows ownership and builder mindset, talks about shipping and impact. 'Hey <first name>'.",
};

const EmailSchema = z.object({
  subjects: z.array(z.string()).describe("3-5 distinct subject lines, under 60 characters, no clickbait, no ALL CAPS"),
  body: z.string().describe("Plain-text email body including greeting and sign-off"),
  projectUsed: z.string().optional(),
  personalizationUsed: z.array(z.string()).describe("Which facts about the recipient/company were referenced"),
});

const SYSTEM = `You write cold emails from job seekers to people at companies (founders, CTOs, hiring managers, recruiters).
Principles:
- 70-130 words. One clear ask (a short call or consideration for a role).
- Open with something specific to the recipient or company (a post they wrote, the product, recent news). Never generic flattery.
- Connect ONE of the sender's projects to the company's product or the job: "I built X, which is similar to your Y".
- Use only facts provided. Never invent metrics, employers or links.
- Avoid spam-trigger words (free, guarantee, urgent, act now, click here), exclamation marks overuse, and ALL CAPS.
- Plain text, no markdown, no placeholders like [Name].
- Sign with the sender's name. If a resume/portfolio link is given, include it once near the end.`;

/**
 * The resume/portfolio link to put in emails: the user's own link if they set one, otherwise their
 * public profile tailored to the job (projects reordered for that role). Never a link that would 404.
 */
export function resumeLink(user: { publicSlug: string | null }, profile: { resumeUrl: string | null; publicVisible: boolean }, jobId?: string | null): string | undefined {
  if (profile.resumeUrl) return profile.resumeUrl;
  if (!profile.publicVisible || !user.publicSlug) return undefined;
  return `${config.APP_URL}/p/${user.publicSlug}${jobId ? `?for=${jobId}` : ""}`;
}

export async function loadEmailContext(userId: string, contactId: string, opts: { jobId?: string | null; tone: Tone; step?: number; includeLink?: boolean }): Promise<EmailContext & { writingStyle?: unknown; writingSample?: string | null }> {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  const [profile] = await db.select().from(schema.profiles).where(eq(schema.profiles.userId, userId));
  const [contact] = await db.select().from(schema.contacts).where(eq(schema.contacts.id, contactId));
  if (!user || !profile || !contact) throw notFound("Profile or contact not found");
  const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, contact.companyId));
  const [job] = opts.jobId ? await db.select().from(schema.jobs).where(eq(schema.jobs.id, opts.jobId)) : [];
  const resumeUrl = opts.includeLink === false ? undefined : resumeLink(user, profile, job?.id);
  return {
    sender: {
      name: user.name,
      headline: profile.headline ?? undefined,
      skills: profile.skills,
      projects: profile.projects,
      links: profile.links,
      experienceLevel: profile.experienceLevel,
      college: profile.college ?? undefined,
    },
    recipient: { name: contact.name, title: contact.title ?? undefined, role: contact.role, recentPosts: contact.recentPosts },
    company: { name: company.name, product: company.product ?? company.description ?? undefined, techStack: company.techStack, recentNews: company.recentNews.map((n) => n.title) },
    job: job ? { title: job.title, description: job.description.slice(0, 4000), url: job.url } : undefined,
    tone: opts.tone,
    step: opts.step ?? 0,
    resumeUrl,
    writingStyle: profile.writingStyle ?? undefined,
    writingSample: profile.writingSample,
  };
}

export interface GeneratedEmail {
  subject: string;
  subjects: string[];
  body: string;
  projectUsed?: string;
  spam: ReturnType<typeof checkSpam>;
  source: "ai" | "fallback";
}

export async function generateEmail(user: { id: string; plan: "free" | "pro" | "college" }, ctx: Awaited<ReturnType<typeof loadEmailContext>>): Promise<GeneratedEmail> {
  await assertQuota(user, "ai_drafts");
  const match = bestProject(ctx.sender.projects, `${ctx.job?.title ?? ""} ${ctx.job?.description ?? ""} ${ctx.company.product ?? ""} ${(ctx.company.techStack ?? []).join(" ")}`);
  const step = ctx.step ?? 0;
  const task = step === 0
    ? "Write the first cold email."
    : `Write follow-up #${step} (a short, polite bump of 2-4 sentences that adds one new piece of value; ${step >= 3 ? "this is the final follow-up, close the loop gracefully" : "don't repeat the first email"}). Subjects should start with "Re: ".`;
  const { data, source } = await aiStructured({
    task: "email",
    schema: EmailSchema,
    system: SYSTEM,
    prompt: `${task}
Tone: ${ctx.tone}. ${TONE_GUIDE[ctx.tone]}
${ctx.writingSample ? `Match the sender's own writing style from this sample (rhythm, greeting, sign-off), while following the principles:\n<style_sample>\n${ctx.writingSample.slice(0, 2000)}\n</style_sample>` : ""}
<sender>${JSON.stringify(ctx.sender)}</sender>
<best_matching_project>${match ? JSON.stringify({ ...match.project, overlap: match.overlap }) : "none"}</best_matching_project>
<recipient>${JSON.stringify(ctx.recipient)}</recipient>
<company>${JSON.stringify(ctx.company)}</company>
${ctx.job ? `<job>${JSON.stringify(ctx.job)}</job>` : ""}
${ctx.resumeUrl ? `Resume/portfolio link to include: ${ctx.resumeUrl}` : ""}`,
    effort: "low",
    fallback: () => {
      const t = templateEmail(ctx);
      return { subjects: t.subjects, body: t.body, projectUsed: t.projectUsed, personalizationUsed: [] };
    },
  });
  await incrementUsage(user.id, "ai_drafts");
  const subjects = data.subjects.filter(Boolean).slice(0, 5);
  const subject = subjects[0] ?? `${ctx.job?.title ?? "Role"} at ${ctx.company.name}`;
  return { subject, subjects, body: data.body, projectUsed: data.projectUsed ?? match?.project.name, spam: checkSpam(subject, data.body), source };
}

const TextSchema = z.object({ text: z.string() });

export async function generateLinkedIn(user: { id: string; plan: "free" | "pro" | "college" }, ctx: EmailContext, kind: "linkedin_note" | "linkedin_dm"): Promise<string> {
  await assertQuota(user, "ai_drafts");
  const { data } = await aiStructured({
    task: kind,
    schema: TextSchema,
    system: kind === "linkedin_note"
      ? "Write a LinkedIn connection request note. HARD LIMIT 300 characters including spaces. Specific, friendly, one reason to connect. No emojis, no links."
      : "Write a short LinkedIn DM (under 600 characters) to someone the sender is already connected with. Specific, one ask, plain text.",
    prompt: `<sender>${JSON.stringify(ctx.sender)}</sender>\n<recipient>${JSON.stringify(ctx.recipient)}</recipient>\n<company>${JSON.stringify(ctx.company)}</company>${ctx.job ? `\n<job>${ctx.job.title}</job>` : ""}`,
    fallback: () => ({ text: kind === "linkedin_note" ? templateLinkedInNote(ctx) : templateEmail({ ...ctx, tone: "casual" }).body.split("\n\n").slice(0, 3).join("\n\n") }),
  });
  await incrementUsage(user.id, "ai_drafts");
  const limit = kind === "linkedin_note" ? 300 : 1000;
  return data.text.length > limit ? `${data.text.slice(0, limit - 3)}...` : data.text;
}

export async function generateCoverLetter(user: { id: string; plan: "free" | "pro" | "college" }, ctx: EmailContext): Promise<string> {
  await assertQuota(user, "ai_drafts");
  const { data } = await aiStructured({
    task: "cover_letter",
    schema: TextSchema,
    system: "Write a tailored one-page cover letter (250-350 words) in plain text. Map 2-3 requirements from the job to concrete evidence from the candidate's projects and experience. No clichés, no invented facts.",
    prompt: `<candidate>${JSON.stringify(ctx.sender)}</candidate>\n<company>${JSON.stringify(ctx.company)}</company>\n<job>${JSON.stringify(ctx.job ?? {})}</job>`,
    effort: "medium",
    fallback: () => ({ text: templateCoverLetter(ctx) }),
  });
  await incrementUsage(user.id, "ai_drafts");
  return data.text;
}

/** Draft a response to an incoming reply ("They asked for availability → here's a draft"). */
export async function suggestReply(input: {
  category: ReplyCategory;
  asksForAvailability: boolean;
  replyBody: string;
  senderName: string;
  recipientFirstName: string;
  bookingLink?: string;
  resumeUrl?: string;
}): Promise<string> {
  const fallback = () => {
    const fn = input.recipientFirstName || "there";
    const book = input.bookingLink ? ` You can also grab any slot that suits you here: ${input.bookingLink}` : "";
    switch (input.category) {
      case "interested":
        return `Hi ${fn},\n\nThanks so much for getting back to me! ${input.asksForAvailability ? `I'm flexible this week: Tuesday or Thursday between 10 AM and 4 PM (your time) both work.${book}` : `I'd love to chat.${book}`}\n\nLooking forward to it,\n${input.senderName}`;
      case "asked_for_resume":
        return `Hi ${fn},\n\nThank you! Here's my resume: ${input.resumeUrl ?? "(attached)"}. Happy to walk you through any of the projects.${book}\n\nBest,\n${input.senderName}`;
      case "referral":
        return `Hi ${fn},\n\nThank you for pointing me in the right direction. I really appreciate it. I'll reach out to them and mention you suggested it, if that's okay.\n\nThanks again,\n${input.senderName}`;
      case "rejected":
        return `Hi ${fn},\n\nThanks for letting me know, and for taking the time to reply. If anything opens up in the future, I'd love to be considered. Wishing the team the best.\n\n${input.senderName}`;
      case "out_of_office":
        return "";
      default:
        return `Hi ${fn},\n\nThanks for your reply!${book}\n\nBest,\n${input.senderName}`;
    }
  };
  if (input.category === "out_of_office") return "";
  const { data } = await aiStructured({
    task: "suggest_reply",
    schema: TextSchema,
    system: "Draft a short, warm reply on behalf of a job seeker responding to a recruiter/founder email. Answer exactly what they asked. If they ask for availability, propose two concrete time windows and include the booking link if provided. Plain text, under 120 words, signed with the sender's name.",
    prompt: `Category: ${input.category}\nSender name: ${input.senderName}\nRecipient first name: ${input.recipientFirstName}\nBooking link: ${input.bookingLink ?? "none"}\nResume link: ${input.resumeUrl ?? "none"}\n<their_email>\n${input.replyBody.slice(0, 4000)}\n</their_email>`,
    fallback: () => ({ text: fallback() }),
  });
  return data.text;
}
