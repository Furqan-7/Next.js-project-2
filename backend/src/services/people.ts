import {
  classifyTitle,
  contactPriority,
  detectPattern,
  finalEmailConfidence,
  generateCandidates,
  guessTimezone,
  splitName,
  type EmailPattern,
} from "shared";
import { XMLParser } from "fast-xml-parser";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { aiStructured } from "../lib/llm";
import { config } from "../config";
import { db, schema } from "db";
import { getJson, getText, httpFetch, stripHtml } from "../lib/http";
import { logger } from "../lib/logger";
import type { Company } from "./companies";
import { verifyEmail } from "./emailVerify";
import { extractMeta } from "./research";
import { assertQuota, incrementUsage } from "./usage";

export type Contact = typeof schema.contacts.$inferSelect;

export interface PersonLead {
  name: string;
  title?: string;
  email?: string;
  linkedinUrl?: string;
  twitterUrl?: string;
  githubUrl?: string;
  source: string;
}

const ghHeaders = () => ({ accept: "application/vnd.github+json", ...(config.GITHUB_TOKEN ? { authorization: `Bearer ${config.GITHUB_TOKEN}` } : {}) });

const TEAM_PATHS = ["/about", "/team", "/about-us", "/company", "/our-team", "/people"];

const PeopleSchema = z.object({ people: z.array(z.object({ name: z.string(), title: z.string(), linkedinUrl: z.string().optional(), twitterUrl: z.string().optional() })) });

/** Heuristic: "Jane Doe\nCo-founder & CEO" or "Jane Doe – CTO" on team pages. */
export function extractPeopleFromText(text: string): PersonLead[] {
  const out: PersonLead[] = [];
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const nameRe = /^[A-Z][a-z]+(?:[ '-][A-Z][a-z]+){1,2}$/;
  const titleRe = /\b(founder|co-founder|ceo|cto|coo|cpo|chief|head of|vp|director|engineering manager|recruiter|talent|lead|engineer)\b/i;
  for (let i = 0; i < lines.length; i++) {
    const inline = lines[i].match(/^([A-Z][a-z]+(?:[ '-][A-Z][a-z]+){1,2})\s*[,–—|-]\s*(.{3,60})$/);
    if (inline && titleRe.test(inline[2])) {
      out.push({ name: inline[1], title: inline[2].trim(), source: "website" });
      continue;
    }
    if (nameRe.test(lines[i]) && lines[i + 1] && titleRe.test(lines[i + 1]) && lines[i + 1].length < 70) {
      out.push({ name: lines[i], title: lines[i + 1], source: "website" });
      i++;
    }
  }
  return out;
}

async function fromWebsite(company: Company): Promise<{ leads: PersonLead[]; githubOrg?: string }> {
  const base = company.website ?? (company.domain ? `https://${company.domain}` : null);
  if (!base) return { leads: [] };
  const leads: PersonLead[] = [];
  let githubOrg: string | undefined;
  let combined = "";
  for (const path of ["", ...TEAM_PATHS]) {
    try {
      const html = await getText(new URL(path, base).toString(), { timeoutMs: 8000 });
      if (!path) {
        const meta = extractMeta(html);
        githubOrg = meta.github?.match(/github\.com\/([A-Za-z0-9-]+)/)?.[1];
      }
      // mailto links are real examples for pattern detection
      for (const m of html.matchAll(/mailto:([\w.+-]+@[\w.-]+)/gi)) leads.push({ name: "", email: m[1].toLowerCase(), source: "website" });
      combined += `\n${stripHtml(html).slice(0, 8000)}`;
    } catch {
      /* page missing */
    }
  }
  if (combined.trim()) {
    const { data } = await aiStructured({
      task: "team_page",
      schema: PeopleSchema,
      system: "List the people named on this company's website with their job titles. Only people explicitly shown with a title. No guesses.",
      prompt: `<pages>\n${combined.slice(0, 20000)}\n</pages>`,
      fallback: () => ({ people: extractPeopleFromText(combined).map((p) => ({ name: p.name, title: p.title ?? "" })) }),
    });
    leads.push(...data.people.map((p) => ({ ...p, source: "website" })));
  }
  return { leads, githubOrg };
}

/** Public org members + commit author emails (great for learning the company's email pattern). */
async function fromGithub(org: string, domain: string | null): Promise<{ leads: PersonLead[]; examples: { email: string; name: string }[] }> {
  const leads: PersonLead[] = [];
  const examples: { email: string; name: string }[] = [];
  try {
    const members = await getJson<{ login: string; html_url: string }[]>(`https://api.github.com/orgs/${org}/public_members?per_page=30`, { headers: ghHeaders() });
    for (const m of members.slice(0, 15)) {
      const u = await getJson<{ name?: string; email?: string; blog?: string; twitter_username?: string; bio?: string; company?: string }>(`https://api.github.com/users/${m.login}`, { headers: ghHeaders() }).catch(() => null);
      if (!u?.name) continue;
      leads.push({
        name: u.name,
        title: u.bio?.match(/\b(founder|co-founder|ceo|cto|engineer|developer|lead|head of [a-z]+)\b/i)?.[0] ?? "Engineer",
        email: u.email ?? undefined,
        githubUrl: m.html_url,
        twitterUrl: u.twitter_username ? `https://x.com/${u.twitter_username}` : undefined,
        source: "github",
      });
    }
    if (domain) {
      const repos = await getJson<{ name: string; fork: boolean }[]>(`https://api.github.com/orgs/${org}/repos?per_page=10&sort=pushed`, { headers: ghHeaders() });
      for (const r of repos.filter((x) => !x.fork).slice(0, 4)) {
        const commits = await getJson<{ commit: { author: { name: string; email: string } } }[]>(`https://api.github.com/repos/${org}/${r.name}/commits?per_page=50`, { headers: ghHeaders() }).catch(() => []);
        for (const c of commits) {
          const { name, email } = c.commit.author;
          if (email?.toLowerCase().endsWith(`@${domain}`) && !/noreply|bot|github/i.test(email)) examples.push({ email: email.toLowerCase(), name });
        }
      }
    }
  } catch (e) {
    logger.debug("github people lookup failed", { org, error: String(e) });
  }
  return { leads, examples };
}

/** "Reach out to Jane Doe (jane@acme.com)" inside job descriptions. */
export function fromJobText(text: string): PersonLead[] {
  const out: PersonLead[] = [];
  for (const m of text.matchAll(/([A-Z][a-z]+ [A-Z][a-z]+)\s*(?:\(|,|at|:|-)\s*([\w.+-]+@[\w-]+\.[\w.]+)/g)) out.push({ name: m[1], email: m[2].toLowerCase(), source: "job_post" });
  for (const m of text.matchAll(/(?:contact|email|reach out to|send .{0,20} to)\s+([\w.+-]+@[\w-]+\.[\w.]+)/gi)) out.push({ name: "", email: m[1].toLowerCase(), source: "job_post" });
  return out;
}

async function fromApollo(domain: string): Promise<PersonLead[]> {
  if (!config.APOLLO_API_KEY) return [];
  try {
    const res = await httpFetch("https://api.apollo.io/api/v1/mixed_people/api_search", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": config.APOLLO_API_KEY },
      body: JSON.stringify({ q_organization_domains_list: [domain], person_titles: ["founder", "cto", "engineering manager", "recruiter", "head of engineering"], per_page: 10 }),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { people?: { name: string; title?: string; linkedin_url?: string; email?: string }[] };
    return (data.people ?? []).map((p) => ({ name: p.name, title: p.title, linkedinUrl: p.linkedin_url, email: p.email && !p.email.includes("not_unlocked") ? p.email : undefined, source: "apollo" }));
  } catch {
    return [];
  }
}

async function fromHunter(domain: string): Promise<{ leads: PersonLead[]; pattern?: string }> {
  if (!config.HUNTER_API_KEY) return { leads: [] };
  try {
    const data = await getJson<{ data: { pattern?: string; emails: { value: string; first_name?: string; last_name?: string; position?: string; linkedin?: string }[] } }>(
      `https://api.hunter.io/v2/domain-search?domain=${domain}&limit=10&api_key=${config.HUNTER_API_KEY}`,
    );
    return {
      pattern: data.data.pattern,
      leads: data.data.emails.map((e) => ({ name: [e.first_name, e.last_name].filter(Boolean).join(" "), title: e.position, email: e.value, linkedinUrl: e.linkedin, source: "hunter" })),
    };
  } catch {
    return { leads: [] };
  }
}

const HUNTER_TO_PATTERN: Record<string, EmailPattern> = { "{first}": "{first}", "{first}.{last}": "{first}.{last}", "{f}{last}": "{f}{last}", "{first}{last}": "{first}{last}", "{f}.{last}": "{f}.{last}", "{first}_{last}": "{first}_{last}", "{last}": "{last}", "{first}{l}": "{first}{l}" };

/** Pick the best address for a person: known email, else verify pattern candidates until one checks out. */
export async function resolveEmail(name: string, domain: string, pattern: { pattern: EmailPattern | null; confidence: number }, knownEmail?: string, verifyLimit = 3) {
  if (knownEmail) {
    const v = await verifyEmail(knownEmail);
    return { email: knownEmail, status: v.status, confidence: finalEmailConfidence(95, v.status, v.hasMx || config.OFFLINE), candidates: [{ email: knownEmail, confidence: 95, status: v.status }] };
  }
  const candidates = generateCandidates(name, domain, pattern, 5);
  const checked: { email: string; confidence: number; status?: string }[] = [];
  let best: { email: string; status: string; confidence: number } | null = null;
  for (const [i, c] of candidates.entries()) {
    if (i >= verifyLimit) {
      checked.push({ email: c.email, confidence: c.confidence });
      continue;
    }
    const v = await verifyEmail(c.email);
    const conf = finalEmailConfidence(c.confidence, v.status, v.hasMx || config.OFFLINE);
    checked.push({ email: c.email, confidence: conf, status: v.status });
    if (v.status === "valid") {
      best = { email: c.email, status: "valid", confidence: conf };
      break;
    }
    if (v.status === "catch_all") {
      // every candidate "passes" on catch-all domains, so the pattern prior decides
      best = { email: candidates[0].email, status: "catch_all", confidence: finalEmailConfidence(candidates[0].confidence, "catch_all", true) };
      break;
    }
    if (!best && v.status !== "invalid") best = { email: c.email, status: v.status, confidence: conf };
  }
  return { email: best?.email ?? null, status: best?.status ?? "invalid", confidence: best?.confidence ?? 0, candidates: checked };
}

/**
 * Finds founders / CTO / hiring managers / recruiters for a company, detects its email pattern and
 * verifies addresses before saving. Returns contacts sorted by who to email first.
 */
export async function findPeople(company: Company, user: { id: string; plan: "free" | "pro" | "college" }) {
  const domain = company.domain;
  const leads: PersonLead[] = [];
  const examples: { email: string; name: string }[] = [];

  const site = await fromWebsite(company);
  leads.push(...site.leads);
  if (site.githubOrg) {
    const gh = await fromGithub(site.githubOrg, domain);
    leads.push(...gh.leads);
    examples.push(...gh.examples);
  }
  const jobs = await db.select({ description: schema.jobs.description }).from(schema.jobs).where(eq(schema.jobs.companyId, company.id)).limit(10);
  for (const j of jobs) leads.push(...fromJobText(j.description));
  let hunterPattern: string | undefined;
  if (domain) {
    leads.push(...(await fromApollo(domain)));
    const h = await fromHunter(domain);
    leads.push(...h.leads);
    hunterPattern = h.pattern;
  }
  for (const l of leads) if (l.email && l.name && domain && l.email.endsWith(`@${domain}`)) examples.push({ email: l.email, name: l.name });

  let pattern = domain ? detectPattern(examples, domain) : { pattern: null, confidence: 0, votes: {}, sampleSize: 0 };
  if (!pattern.pattern && hunterPattern && HUNTER_TO_PATTERN[hunterPattern]) pattern = { pattern: HUNTER_TO_PATTERN[hunterPattern], confidence: 0.8, votes: {}, sampleSize: 0 };
  if (pattern.pattern && domain) await db.update(schema.companies).set({ emailPattern: pattern.pattern, emailPatternConfidence: pattern.confidence }).where(eq(schema.companies.id, company.id));

  // merge leads by name
  const byName = new Map<string, PersonLead>();
  for (const l of leads) {
    if (!l.name || l.name.split(" ").length < 2) continue;
    const key = l.name.toLowerCase();
    const prev = byName.get(key);
    byName.set(key, { ...prev, ...Object.fromEntries(Object.entries(l).filter(([, v]) => v)), name: l.name } as PersonLead);
  }
  const people = [...byName.values()]
    .map((p) => ({ ...p, role: classifyTitle(p.title ?? "") }))
    .sort((a, b) => contactPriority(a.role, company.size) - contactPriority(b.role, company.size))
    .slice(0, 8);

  const saved: Contact[] = [];
  for (const p of people) {
    let email: string | null = p.email ?? null;
    let status = "unknown";
    let confidence = 0;
    let candidates: { email: string; confidence: number; status?: string }[] = [];
    if (domain && (p.role !== "engineer" || saved.length < 4)) {
      await assertQuota(user, "verifications", 1);
      const r = await resolveEmail(p.name, domain, pattern, p.email);
      await incrementUsage(user.id, "verifications", r.candidates.filter((c) => c.status).length || 1);
      email = r.email;
      status = r.status;
      confidence = r.confidence;
      candidates = r.candidates;
    }
    const [row] = await db
      .insert(schema.contacts)
      .values({
        companyId: company.id,
        name: p.name,
        title: p.title ?? null,
        role: p.role,
        email,
        emailStatus: status,
        emailConfidence: confidence,
        emailCandidates: candidates,
        verifiedAt: status !== "unknown" ? new Date() : null,
        linkedinUrl: p.linkedinUrl ?? null,
        twitterUrl: p.twitterUrl ?? null,
        githubUrl: p.githubUrl ?? null,
        timezone: company.timezone ?? guessTimezone(company.location, "UTC"),
        source: p.source,
        createdByUserId: user.id,
      })
      .onConflictDoUpdate({
        target: [schema.contacts.companyId, schema.contacts.name],
        set: { title: p.title ?? null, role: p.role, email, emailStatus: status, emailConfidence: confidence, emailCandidates: candidates, verifiedAt: new Date() },
      })
      .returning();
    saved.push(row);
  }
  return { contacts: saved, pattern, sources: [...new Set(leads.map((l) => l.source))] };
}

/** Manually added contact (e.g. found on LinkedIn by the user). Generates + verifies an email if missing. */
export async function addContact(company: Company, input: { name: string; title?: string; email?: string; linkedinUrl?: string; college?: string }, user: { id: string; plan: "free" | "pro" | "college" }) {
  let email = input.email ?? null;
  let status = "unknown";
  let confidence = 0;
  let candidates: { email: string; confidence: number; status?: string }[] = [];
  if (company.domain || email) {
    await assertQuota(user, "verifications");
    const pattern = { pattern: (company.emailPattern as EmailPattern | null) ?? null, confidence: company.emailPatternConfidence };
    const r = await resolveEmail(input.name, company.domain ?? email!.split("@")[1], pattern, input.email);
    await incrementUsage(user.id, "verifications");
    email = r.email;
    status = r.status;
    confidence = r.confidence;
    candidates = r.candidates;
  }
  const [row] = await db
    .insert(schema.contacts)
    .values({
      companyId: company.id,
      name: input.name,
      title: input.title ?? null,
      role: classifyTitle(input.title ?? ""),
      email,
      emailStatus: status,
      emailConfidence: confidence,
      emailCandidates: candidates,
      linkedinUrl: input.linkedinUrl ?? null,
      college: input.college ?? null,
      timezone: company.timezone ?? guessTimezone(company.location, "UTC"),
      source: "manual",
      createdByUserId: user.id,
    })
    .onConflictDoUpdate({ target: [schema.contacts.companyId, schema.contacts.name], set: { title: input.title ?? null, email, emailStatus: status, emailConfidence: confidence, emailCandidates: candidates } })
    .returning();
  return row;
}

/** Recent posts, blogs and talks for personalization: GitHub activity, blog RSS, X timeline (with API token). */
export async function fetchRecentPosts(contactId: string): Promise<Contact> {
  const [c] = await db.select().from(schema.contacts).where(eq(schema.contacts.id, contactId));
  if (!c) throw new Error("contact not found");
  const posts: { title: string; url?: string; date?: string; source: string }[] = [];
  const gh = c.githubUrl?.match(/github\.com\/([A-Za-z0-9-]+)/)?.[1];
  if (gh) {
    const u = await getJson<{ blog?: string }>(`https://api.github.com/users/${gh}`, { headers: ghHeaders() }).catch(() => null);
    const repos = await getJson<{ name: string; description?: string; html_url: string; pushed_at: string; fork: boolean }[]>(`https://api.github.com/users/${gh}/repos?sort=pushed&per_page=5`, { headers: ghHeaders() }).catch(() => []);
    for (const r of repos.filter((x) => !x.fork).slice(0, 3)) posts.push({ title: `GitHub: ${r.name}${r.description ? ` (${r.description})` : ""}`, url: r.html_url, date: r.pushed_at, source: "github" });
    if (u?.blog) {
      const blog = u.blog.startsWith("http") ? u.blog : `https://${u.blog}`;
      for (const feed of ["/rss.xml", "/feed", "/atom.xml", "/index.xml", "/feed.xml"]) {
        try {
          const xml = await getText(new URL(feed, blog).toString(), { timeoutMs: 6000 });
          const doc = new XMLParser({ ignoreAttributes: false }).parse(xml);
          const items = [doc?.rss?.channel?.item ?? doc?.feed?.entry ?? []].flat().slice(0, 3);
          for (const it of items) {
            const link = typeof it.link === "string" ? it.link : it.link?.["@_href"];
            posts.push({ title: String(it.title?.["#text"] ?? it.title ?? ""), url: link, date: it.pubDate ?? it.updated, source: "blog" });
          }
          if (items.length) break;
        } catch {
          /* try next */
        }
      }
    }
  }
  const handle = c.twitterUrl?.match(/(?:x|twitter)\.com\/([A-Za-z0-9_]+)/)?.[1];
  if (handle && config.X_BEARER_TOKEN) {
    try {
      const u = await getJson<{ data: { id: string } }>(`https://api.x.com/2/users/by/username/${handle}`, { headers: { authorization: `Bearer ${config.X_BEARER_TOKEN}` } });
      const t = await getJson<{ data?: { id: string; text: string; created_at?: string }[] }>(`https://api.x.com/2/users/${u.data.id}/tweets?max_results=5&exclude=replies,retweets&tweet.fields=created_at`, { headers: { authorization: `Bearer ${config.X_BEARER_TOKEN}` } });
      for (const tw of t.data ?? []) posts.push({ title: tw.text.slice(0, 200), url: `https://x.com/${handle}/status/${tw.id}`, date: tw.created_at, source: "x" });
    } catch {
      /* rate limited or private */
    }
  }
  const [updated] = await db.update(schema.contacts).set({ recentPosts: posts.filter((p) => p.title).slice(0, 8) }).where(eq(schema.contacts.id, contactId)).returning();
  return updated;
}

/** Alumni from the user's college working at this company. */
export async function referralCandidates(companyId: string, college: string | null | undefined) {
  if (!college) return [];
  const key = college.toLowerCase().replace(/[^a-z ]/g, "").split(" ").filter((w) => w.length > 3);
  const people = await db.select().from(schema.contacts).where(and(eq(schema.contacts.companyId, companyId)));
  return people.filter((p) => p.college && key.length && key.every((w) => p.college!.toLowerCase().includes(w)));
}

export { splitName };
