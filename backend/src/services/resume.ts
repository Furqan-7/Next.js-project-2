import "../lib/polyfills"; // must load before pdf.js (see file)
import { normalizeSkills, parseResumeText, type ParsedResume } from "shared";
import { z } from "zod";
import { aiStructured, pdfBlock } from "../lib/llm";
import { logger } from "../lib/logger";

const ResumeSchema = z.object({
  name: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  headline: z.string().optional(),
  summary: z.string().optional(),
  skills: z.array(z.string()),
  projects: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      technologies: z.array(z.string()),
      url: z.string().optional(),
      highlights: z.array(z.string()).optional(),
    }),
  ),
  experience: z.array(
    z.object({
      company: z.string(),
      title: z.string(),
      start: z.string().optional(),
      end: z.string().optional(),
      description: z.string().optional(),
      technologies: z.array(z.string()).optional(),
    }),
  ),
  education: z.array(
    z.object({
      institution: z.string(),
      degree: z.string().optional(),
      field: z.string().optional(),
      start: z.string().optional(),
      end: z.string().optional(),
      grade: z.string().optional(),
    }),
  ),
  links: z.object({ github: z.string().optional(), linkedin: z.string().optional(), portfolio: z.string().optional() }),
  yearsExperience: z.number(),
});

/** Extract plain text from a PDF buffer (pdf.js via unpdf, pure JS). */
export async function pdfToText(buf: Buffer): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await extractText(pdf, { mergePages: true });
  return Array.isArray(text) ? text.join("\n") : text;
}

const SYSTEM = `You extract structured data from resumes for a job-search assistant.
Rules:
- Only include facts present in the resume. Never invent employers, dates, or links.
- skills: concrete technologies, languages, frameworks and tools (e.g. "Next.js", "PostgreSQL"), canonical capitalisation, no soft skills.
- projects: each with a one-sentence description and the technologies it used.
- yearsExperience: total full-time professional experience in years (internships count as 0), as a number.
- links: full URLs when present.`;

export async function parseResume(input: { pdf?: Buffer; text?: string }): Promise<{ resume: ParsedResume; text: string; source: "ai" | "fallback" }> {
  let text = input.text ?? "";
  if (input.pdf && !text) {
    try {
      text = await pdfToText(input.pdf);
    } catch (e) {
      logger.warn("pdf text extraction failed", { error: String(e) });
    }
  }
  const heuristic = parseResumeText(text);
  const prompt = input.pdf
    ? [pdfBlock(input.pdf), { type: "text" as const, text: "Extract this resume." }]
    : `Extract this resume:\n\n<resume>\n${text}\n</resume>`;
  const { data, source } = await aiStructured({
    task: "resume",
    schema: ResumeSchema,
    system: SYSTEM,
    prompt,
    effort: "low",
    fallback: () => heuristic,
  });
  const resume: ParsedResume = {
    ...data,
    skills: normalizeSkills(data.skills),
    links: { ...heuristic.links, ...Object.fromEntries(Object.entries(data.links).filter(([, v]) => v)) },
  };
  return { resume, text, source };
}
