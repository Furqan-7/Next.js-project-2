import { extractSkills, normalizeSkills, type Project } from "shared";
import { z } from "zod";
import { aiStructured } from "../lib/llm";
import { config } from "../config";
import { getJson, getText, stripHtml } from "../lib/http";
import { logger } from "../lib/logger";

export interface GithubEnrichment {
  username: string;
  name?: string;
  bio?: string;
  followers: number;
  publicRepos: number;
  topLanguages: { language: string; repos: number }[];
  repos: { name: string; description: string | null; url: string; stars: number; language: string | null; topics: string[]; updatedAt: string; homepage?: string | null }[];
  skills: string[];
}

export function githubUsername(url?: string | null): string | null {
  if (!url) return null;
  const m = url.match(/github\.com\/([A-Za-z0-9-]+)/i);
  if (m) return m[1];
  return /^[A-Za-z0-9-]{1,39}$/.test(url) ? url : null;
}

const ghHeaders = () => ({
  accept: "application/vnd.github+json",
  ...(config.GITHUB_TOKEN ? { authorization: `Bearer ${config.GITHUB_TOKEN}` } : {}),
});

/** Public GitHub data: top repos, languages and topics become skills and project candidates. */
export async function enrichGithub(urlOrUser: string): Promise<GithubEnrichment | null> {
  const username = githubUsername(urlOrUser);
  if (!username) return null;
  try {
    const user = await getJson<{ login: string; name?: string; bio?: string; followers: number; public_repos: number }>(`https://api.github.com/users/${username}`, { headers: ghHeaders() });
    const repos = await getJson<
      { name: string; description: string | null; html_url: string; stargazers_count: number; language: string | null; topics?: string[]; fork: boolean; pushed_at: string; homepage?: string | null }[]
    >(`https://api.github.com/users/${username}/repos?per_page=100&sort=pushed`, { headers: ghHeaders() });
    const own = repos.filter((r) => !r.fork);
    const langCount = new Map<string, number>();
    for (const r of own) if (r.language) langCount.set(r.language, (langCount.get(r.language) ?? 0) + 1);
    const topLanguages = [...langCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([language, n]) => ({ language, repos: n }));
    const ranked = own.sort((a, b) => b.stargazers_count - a.stargazers_count || b.pushed_at.localeCompare(a.pushed_at)).slice(0, 12);
    const skillText = ranked.map((r) => `${r.name} ${r.description ?? ""} ${(r.topics ?? []).join(" ")} ${r.language ?? ""}`).join("\n");
    return {
      username: user.login,
      name: user.name,
      bio: user.bio,
      followers: user.followers,
      publicRepos: user.public_repos,
      topLanguages,
      repos: ranked.map((r) => ({ name: r.name, description: r.description, url: r.html_url, stars: r.stargazers_count, language: r.language, topics: r.topics ?? [], updatedAt: r.pushed_at, homepage: r.homepage })),
      skills: normalizeSkills([...topLanguages.map((l) => l.language), ...extractSkills(skillText)]),
    };
  } catch (e) {
    logger.warn("github enrichment failed", { username, error: String(e) });
    return null;
  }
}

export function githubReposToProjects(gh: GithubEnrichment, limit = 6): Project[] {
  return gh.repos
    .filter((r) => r.description)
    .slice(0, limit)
    .map((r) => ({
      name: r.name,
      description: r.description ?? "",
      technologies: normalizeSkills([...(r.language ? [r.language] : []), ...extractSkills(`${r.description} ${r.topics.join(" ")}`)]),
      url: r.homepage || r.url,
    }));
}

export interface PortfolioEnrichment {
  url: string;
  title?: string;
  description?: string;
  skills: string[];
  projects: Project[];
}

const PortfolioSchema = z.object({
  projects: z.array(z.object({ name: z.string(), description: z.string(), technologies: z.array(z.string()), url: z.string().optional() })),
  skills: z.array(z.string()),
});

export async function enrichPortfolio(url: string): Promise<PortfolioEnrichment | null> {
  try {
    const html = await getText(url);
    const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim();
    const description = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i)?.[1];
    const text = stripHtml(html).slice(0, 20000);
    const { data } = await aiStructured({
      task: "portfolio",
      schema: PortfolioSchema,
      system: "Extract the projects and technical skills a developer lists on their portfolio site. Only include what the page states.",
      prompt: `Portfolio page text:\n<page>\n${text}\n</page>`,
      fallback: () => ({ projects: [], skills: extractSkills(text) }),
    });
    return { url, title, description, skills: normalizeSkills(data.skills), projects: data.projects.map((p) => ({ ...p, technologies: normalizeSkills(p.technologies) })) };
  } catch (e) {
    logger.warn("portfolio enrichment failed", { url, error: String(e) });
    return null;
  }
}

/**
 * LinkedIn has no public profile API and forbids scraping, so we don't fetch it.
 * Users can upload LinkedIn's own "Save to PDF" export, which goes through the resume parser.
 */
export function linkedinNote(url?: string) {
  return url ? { url, note: "Stored as a link. To import details, upload LinkedIn's \"Save to PDF\" export of your profile." } : null;
}

const StyleSchema = z.object({
  formality: z.enum(["casual", "neutral", "formal"]),
  averageSentenceLength: z.number(),
  usesEmoji: z.boolean(),
  signOff: z.string(),
  greeting: z.string(),
  traits: z.array(z.string()),
});
export type WritingStyle = z.infer<typeof StyleSchema>;

export function heuristicStyle(sample: string): WritingStyle {
  const sentences = sample.split(/[.!?]+/).map((s) => s.trim()).filter(Boolean);
  const words = sample.split(/\s+/).filter(Boolean).length;
  const avg = sentences.length ? Math.round(words / sentences.length) : 15;
  const casualHits = (sample.match(/\b(hey|hi|cool|awesome|gonna|wanna|super|btw|lol|!)\b|!/gi) ?? []).length;
  const formalHits = (sample.match(/\b(dear|regards|sincerely|therefore|furthermore|kindly)\b/gi) ?? []).length;
  const lines = sample.trim().split("\n").map((l) => l.trim()).filter(Boolean);
  return {
    formality: casualHits > formalHits + 1 ? "casual" : formalHits > casualHits ? "formal" : "neutral",
    averageSentenceLength: avg,
    usesEmoji: /\p{Extended_Pictographic}/u.test(sample),
    greeting: lines[0]?.split(/[ ,]/)[0] ?? "Hi",
    signOff: lines.length > 1 ? lines[lines.length - 2].replace(/,$/, "") : "Thanks",
    traits: [avg < 14 ? "short sentences" : "longer sentences", casualHits ? "friendly" : "straightforward"],
  };
}

export async function analyzeWritingStyle(sample: string): Promise<WritingStyle> {
  const { data } = await aiStructured({
    task: "style",
    schema: StyleSchema,
    system: "Describe the author's writing style so future emails can imitate it. Be concrete: greeting, sign-off, sentence length, formality, distinctive habits.",
    prompt: `<sample>\n${sample.slice(0, 6000)}\n</sample>`,
    fallback: () => heuristicStyle(sample),
  });
  return data;
}
