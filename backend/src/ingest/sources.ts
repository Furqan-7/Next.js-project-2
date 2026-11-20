import { detectEmploymentType, detectWorkMode, type EmploymentType } from "shared";
import { XMLParser } from "fast-xml-parser";
import { config } from "../config";
import { domainFromUrl, getJson, getText, stripHtml } from "../lib/http";

export interface RawJob {
  source: string;
  externalId: string;
  url: string;
  title: string;
  company: string;
  companyDomain?: string | null;
  location?: string | null;
  remote?: boolean;
  description: string;
  salaryMin?: number | null;
  salaryMax?: number | null;
  currency?: string | null;
  tags?: string[];
  postedAt?: Date | null;
  employmentType?: EmploymentType | null;
  isHiringPost?: boolean;
}

const isRemote = (s?: string | null) => /remote|anywhere|worldwide|distributed/i.test(s ?? "");

function decodeEntities(s: string) {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
}

/** Parse "$120k – $150k", "₹6,00,000 - ₹9,00,000", "100000-130000 USD". */
export function parseSalary(s?: string | null): { min: number | null; max: number | null; currency: string | null } {
  if (!s) return { min: null, max: null, currency: null };
  const currency = /₹|inr|lpa/i.test(s) ? "INR" : /€|eur/i.test(s) ? "EUR" : /£|gbp/i.test(s) ? "GBP" : /\$|usd/i.test(s) ? "USD" : null;
  const nums = [...s.replace(/,/g, "").matchAll(/(\d+(?:\.\d+)?)\s*(k|lpa|l|lakh)?/gi)].map((m) => {
    const n = Number(m[1]);
    const unit = (m[2] ?? "").toLowerCase();
    return unit === "k" ? n * 1000 : unit === "lpa" || unit === "l" || unit === "lakh" ? n * 100000 : n;
  }).filter((n) => n >= 1000);
  if (!nums.length) return { min: null, max: null, currency };
  return { min: Math.min(...nums), max: Math.max(...nums), currency };
}

// ---------------- Greenhouse ----------------
interface GreenhouseResp { jobs: { id: number; title: string; absolute_url: string; location?: { name?: string }; content?: string; updated_at?: string; departments?: { name: string }[] }[] }
export function parseGreenhouse(token: string, companyName: string, data: GreenhouseResp): RawJob[] {
  return data.jobs.map((j) => {
    const description = stripHtml(decodeEntities(j.content ?? ""));
    return {
      source: "greenhouse",
      externalId: `gh:${token}:${j.id}`,
      url: j.absolute_url,
      title: j.title,
      company: companyName,
      location: j.location?.name ?? null,
      remote: isRemote(j.location?.name),
      description,
      tags: (j.departments ?? []).map((d) => d.name),
      postedAt: j.updated_at ? new Date(j.updated_at) : null,
      employmentType: detectEmploymentType(`${j.title} ${description.slice(0, 500)}`),
    };
  });
}
export async function fetchGreenhouse(token: string): Promise<RawJob[]> {
  const board = await getJson<{ name?: string }>(`https://boards-api.greenhouse.io/v1/boards/${token}`).catch(() => ({ name: undefined }));
  const data = await getJson<GreenhouseResp>(`https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`);
  return parseGreenhouse(token, board.name ?? token, data);
}

// ---------------- Lever ----------------
type LeverResp = { id: string; text: string; hostedUrl: string; categories?: { location?: string; commitment?: string; team?: string }; descriptionPlain?: string; additionalPlain?: string; lists?: { text: string; content: string }[]; createdAt?: number; workplaceType?: string; salaryRange?: { min?: number; max?: number; currency?: string } }[];
export function parseLever(company: string, data: LeverResp): RawJob[] {
  return data.map((j) => {
    const lists = (j.lists ?? []).map((l) => `${l.text}\n${stripHtml(l.content)}`).join("\n");
    const description = [j.descriptionPlain, lists, j.additionalPlain].filter(Boolean).join("\n\n");
    return {
      source: "lever",
      externalId: `lever:${company}:${j.id}`,
      url: j.hostedUrl,
      title: j.text,
      company: company.charAt(0).toUpperCase() + company.slice(1),
      location: j.categories?.location ?? null,
      remote: j.workplaceType === "remote" || isRemote(j.categories?.location),
      description,
      salaryMin: j.salaryRange?.min ?? null,
      salaryMax: j.salaryRange?.max ?? null,
      currency: j.salaryRange?.currency ?? null,
      tags: [j.categories?.team, j.categories?.commitment].filter(Boolean) as string[],
      postedAt: j.createdAt ? new Date(j.createdAt) : null,
      employmentType: detectEmploymentType(`${j.categories?.commitment ?? ""} ${j.text}`),
    };
  });
}
export async function fetchLever(company: string): Promise<RawJob[]> {
  return parseLever(company, await getJson<LeverResp>(`https://api.lever.co/v0/postings/${company}?mode=json`));
}

// ---------------- Ashby ----------------
interface AshbyResp { jobs: { id: string; title: string; location?: string; isRemote?: boolean; descriptionPlain?: string; jobUrl: string; publishedAt?: string; employmentType?: string; compensation?: { compensationTierSummary?: string } }[] }
export function parseAshby(org: string, data: AshbyResp): RawJob[] {
  return data.jobs.map((j) => {
    const sal = parseSalary(j.compensation?.compensationTierSummary);
    const et = j.employmentType === "Intern" ? "internship" : j.employmentType === "Contract" ? "contract" : j.employmentType === "FullTime" ? "full_time" : detectEmploymentType(j.title);
    return {
      source: "ashby",
      externalId: `ashby:${org}:${j.id}`,
      url: j.jobUrl,
      title: j.title,
      company: org.charAt(0).toUpperCase() + org.slice(1),
      location: j.location ?? null,
      remote: Boolean(j.isRemote) || isRemote(j.location),
      description: j.descriptionPlain ?? "",
      salaryMin: sal.min,
      salaryMax: sal.max,
      currency: sal.currency,
      postedAt: j.publishedAt ? new Date(j.publishedAt) : null,
      employmentType: et,
    };
  });
}
export async function fetchAshby(org: string): Promise<RawJob[]> {
  return parseAshby(org, await getJson<AshbyResp>(`https://api.ashbyhq.com/posting-api/job-board/${org}?includeCompensation=true`));
}

// ---------------- Workable ----------------
interface WorkableResp { name?: string; jobs: { title: string; shortcode: string; url?: string; shortlink?: string; city?: string; country?: string; telecommuting?: boolean; description?: string; employment_type?: string; published_on?: string }[] }
export function parseWorkable(account: string, data: WorkableResp): RawJob[] {
  return data.jobs.map((j) => {
    const location = [j.city, j.country].filter(Boolean).join(", ") || null;
    return {
      source: "workable",
      externalId: `workable:${account}:${j.shortcode}`,
      url: j.url ?? j.shortlink ?? `https://apply.workable.com/${account}/j/${j.shortcode}/`,
      title: j.title,
      company: data.name ?? account,
      location,
      remote: Boolean(j.telecommuting),
      description: stripHtml(j.description ?? ""),
      postedAt: j.published_on ? new Date(j.published_on) : null,
      employmentType: detectEmploymentType(`${j.employment_type ?? ""} ${j.title}`),
    };
  });
}
export async function fetchWorkable(account: string): Promise<RawJob[]> {
  return parseWorkable(account, await getJson<WorkableResp>(`https://apply.workable.com/api/v1/widget/accounts/${account}?details=true`));
}

// ---------------- Remotive ----------------
interface RemotiveResp { jobs: { id: number; url: string; title: string; company_name: string; tags?: string[]; job_type?: string; publication_date?: string; candidate_required_location?: string; salary?: string; description?: string }[] }
export function parseRemotive(data: RemotiveResp): RawJob[] {
  return data.jobs.map((j) => {
    const sal = parseSalary(j.salary);
    return {
      source: "remotive",
      externalId: `remotive:${j.id}`,
      url: j.url,
      title: j.title,
      company: j.company_name,
      location: j.candidate_required_location ? `Remote (${j.candidate_required_location})` : "Remote",
      remote: true,
      description: stripHtml(j.description ?? ""),
      salaryMin: sal.min,
      salaryMax: sal.max,
      currency: sal.currency,
      tags: j.tags ?? [],
      postedAt: j.publication_date ? new Date(j.publication_date) : null,
      employmentType: j.job_type === "internship" ? "internship" : j.job_type === "contract" ? "contract" : j.job_type === "freelance" ? "freelance" : j.job_type === "full_time" ? "full_time" : null,
    };
  });
}
export async function fetchRemotive(search?: string): Promise<RawJob[]> {
  const q = search ? `&search=${encodeURIComponent(search)}` : "";
  return parseRemotive(await getJson<RemotiveResp>(`https://remotive.com/api/remote-jobs?limit=150${q}`));
}

// ---------------- RemoteOK ----------------
type RemoteOkResp = ({ id?: string; url?: string; position?: string; company?: string; tags?: string[]; location?: string; description?: string; date?: string; salary_min?: number; salary_max?: number; legal?: string })[];
export function parseRemoteOk(data: RemoteOkResp): RawJob[] {
  return data
    .filter((j) => j.id && j.position && j.company)
    .map((j) => ({
      source: "remoteok",
      externalId: `remoteok:${j.id}`,
      url: j.url ?? `https://remoteok.com/remote-jobs/${j.id}`,
      title: j.position!,
      company: j.company!,
      location: j.location || "Remote",
      remote: true,
      description: stripHtml(j.description ?? ""),
      salaryMin: j.salary_min || null,
      salaryMax: j.salary_max || null,
      currency: j.salary_min ? "USD" : null,
      tags: j.tags ?? [],
      postedAt: j.date ? new Date(j.date) : null,
      employmentType: detectEmploymentType(`${j.position} ${(j.tags ?? []).join(" ")}`),
    }));
}
export async function fetchRemoteOk(): Promise<RawJob[]> {
  return parseRemoteOk(await getJson<RemoteOkResp>("https://remoteok.com/api"));
}

// ---------------- Hacker News "Who's Hiring" ----------------
interface HnItem { id: number; text?: string; created_at?: string; author?: string; children?: HnItem[] }
/** Typical first line: "Acme | Senior Engineer | NYC or REMOTE | Full-time | https://acme.com" */
export function parseHnComment(c: HnItem, threadId: number): RawJob | null {
  if (!c.text) return null;
  const text = stripHtml(decodeEntities(c.text.replace(/<p>/g, "\n")));
  const firstLine = text.split("\n")[0];
  const parts = firstLine.split(/\s+\|\s+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const company = parts[0].replace(/\(.*?\)/g, "").trim();
  const title = parts.find((p, i) => i > 0 && /engineer|developer|scientist|designer|intern|manager|lead|sre|devops|architect|analyst|founding/i.test(p)) ?? parts[1];
  const location = parts.find((p) => /remote|onsite|on-site|hybrid|[A-Z][a-z]+,? [A-Z]{2}\b|london|berlin|nyc|sf|bay area|bangalore|toronto|new york/i.test(p) && p !== title) ?? null;
  const url = text.match(/https?:\/\/[^\s)]+/)?.[0];
  const sal = parseSalary(parts.find((p) => /[$€£₹]\s?\d|\d+k/i.test(p)));
  return {
    source: "hn",
    externalId: `hn:${c.id}`,
    url: `https://news.ycombinator.com/item?id=${c.id}`,
    title: title.slice(0, 140),
    company: company.slice(0, 80),
    companyDomain: domainFromUrl(url),
    location,
    remote: isRemote(firstLine),
    description: text,
    salaryMin: sal.min,
    salaryMax: sal.max,
    currency: sal.currency,
    postedAt: c.created_at ? new Date(c.created_at) : null,
    employmentType: detectEmploymentType(firstLine),
    tags: [`hn-thread:${threadId}`],
  };
}
export async function fetchHnWhosHiring(): Promise<RawJob[]> {
  const search = await getJson<{ hits: { objectID: string; title: string }[] }>(
    "https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=5",
  );
  const thread = search.hits.find((h) => /who is hiring/i.test(h.title));
  if (!thread) return [];
  const item = await getJson<HnItem>(`https://hn.algolia.com/api/v1/items/${thread.objectID}`);
  return (item.children ?? []).map((c) => parseHnComment(c, item.id)).filter((j): j is RawJob => j !== null);
}

// ---------------- Y Combinator (hiring companies) ----------------
/**
 * Work at a Startup has no public API. We use the community-maintained yc-oss dataset of YC
 * companies that are currently hiring, and surface them as hiring leads. Their actual roles come
 * in through their ATS boards (most YC startups use Ashby, Lever, Greenhouse or Workable).
 */
interface YcCompany { id: number; name: string; slug: string; website?: string; one_liner?: string; long_description?: string; team_size?: number; industry?: string; all_locations?: string; batch?: string; isHiring?: boolean; regions?: string[]; url?: string }
export function parseYc(data: YcCompany[]): RawJob[] {
  return data
    .filter((c) => c.isHiring !== false)
    .map((c) => ({
      source: "yc",
      externalId: `yc:${c.id}`,
      url: `https://www.workatastartup.com/companies/${c.slug}`,
      title: "Engineering roles (hiring)",
      company: c.name,
      companyDomain: domainFromUrl(c.website),
      location: c.all_locations ?? null,
      remote: isRemote(c.all_locations) || (c.regions ?? []).some((r) => /remote/i.test(r)),
      description: [c.one_liner, c.long_description, c.batch ? `YC ${c.batch}` : "", c.team_size ? `Team size: ${c.team_size}` : "", c.industry ? `Industry: ${c.industry}` : ""].filter(Boolean).join("\n"),
      tags: ["yc", c.batch ?? "", c.industry ?? ""].filter(Boolean),
      isHiringPost: true,
    }));
}
export async function fetchYc(): Promise<RawJob[]> {
  return parseYc(await getJson<YcCompany[]>("https://yc-oss.github.io/api/companies/hiring.json"));
}

// ---------------- X (Twitter) hiring posts ----------------
interface XResp { data?: { id: string; text: string; author_id: string; created_at?: string }[]; includes?: { users?: { id: string; name: string; username: string; description?: string; url?: string }[] } }
export function parseXPosts(data: XResp): RawJob[] {
  const users = new Map((data.includes?.users ?? []).map((u) => [u.id, u]));
  return (data.data ?? []).map((t) => {
    const u = users.get(t.author_id);
    const atCompany = t.text.match(/\b(?:at|@)\s*@?([A-Z][\w.-]{1,30})/)?.[1];
    const role = t.text.match(/\b(?:hiring|looking for)\s+(?:an?\s+)?((?:senior |junior |founding |full[- ]?stack |front[- ]?end |back[- ]?end |ai |ml )*(?:engineers?|developers?|interns?|designers?))/i)?.[1];
    return {
      source: "x",
      externalId: `x:${t.id}`,
      url: `https://x.com/${u?.username ?? "i"}/status/${t.id}`,
      title: role ? role.replace(/\b\w/g, (m) => m.toUpperCase()) : "Hiring post",
      company: atCompany ?? u?.name ?? "Unknown",
      companyDomain: domainFromUrl(u?.url),
      location: detectWorkMode(t.text) === "remote" ? "Remote" : null,
      remote: detectWorkMode(t.text) === "remote",
      description: `${t.text}\n\nPosted by ${u?.name ?? ""} (@${u?.username ?? ""})${u?.description ? `: ${u.description}` : ""}`,
      postedAt: t.created_at ? new Date(t.created_at) : null,
      employmentType: detectEmploymentType(t.text),
      isHiringPost: true,
    };
  });
}
export async function fetchXHiringPosts(keywords = "engineer OR developer OR intern"): Promise<RawJob[]> {
  if (!config.X_BEARER_TOKEN) return [];
  const query = `("we're hiring" OR "we are hiring" OR "looking for interns" OR "now hiring") (${keywords}) -is:retweet lang:en`;
  const url = `https://api.x.com/2/tweets/search/recent?max_results=50&query=${encodeURIComponent(query)}&tweet.fields=created_at,author_id&expansions=author_id&user.fields=name,username,description,url`;
  return parseXPosts(await getJson<XResp>(url, { headers: { authorization: `Bearer ${config.X_BEARER_TOKEN}` } }));
}

// ---------------- Funding news (RSS) ----------------
export interface FundingItem { companyName: string; amount: string | null; round: string | null; title: string; url: string; announcedAt: Date | null }

const FUNDING_RE = /^(.+?)\s+(?:raises|raised|secures|closes|lands|bags|nabs|gets)\s+(?:a\s+)?(\$|₹|€|£|US\$|Rs\.?\s?)?([\d.,]+\s*(?:[mbk]n?|million|billion|crore|lakh)?)\b[^,]*?(pre-seed|seed|series [a-f]|growth|bridge)?/i;
export function parseFundingTitle(title: string): Omit<FundingItem, "url" | "announcedAt" | "title"> | null {
  const m = title.match(FUNDING_RE);
  if (!m) return null;
  const companyName = m[1].replace(/^(exclusive|breaking|scoop):\s*/i, "").replace(/^[A-Z][\w-]*-backed\s+/i, "").split(/,\s+/).pop()!.trim();
  if (companyName.length > 60) return null;
  return { companyName, amount: `${m[2] ?? ""}${m[3]}`.trim(), round: (title.match(/pre-seed|seed|series [a-f]/i)?.[0] ?? m[4] ?? null)?.replace(/\b\w/g, (c) => c.toUpperCase()) ?? null };
}
export function parseFundingRss(xml: string): FundingItem[] {
  const parser = new XMLParser({ ignoreAttributes: true });
  const doc = parser.parse(xml);
  const items: { title?: string; link?: string; pubDate?: string }[] = [doc?.rss?.channel?.item ?? []].flat();
  const out: FundingItem[] = [];
  for (const it of items) {
    if (!it.title || !it.link) continue;
    const title = decodeEntities(String(it.title));
    const parsed = parseFundingTitle(title);
    if (!parsed) continue;
    out.push({ ...parsed, title, url: String(it.link), announcedAt: it.pubDate ? new Date(it.pubDate) : null });
  }
  return out;
}
export const FUNDING_FEEDS = ["https://techcrunch.com/category/venture/feed/", "https://news.crunchbase.com/feed/", "https://inc42.com/buzz/funding-galore/feed/"];
export async function fetchFundingNews(): Promise<FundingItem[]> {
  const all: FundingItem[] = [];
  for (const feed of FUNDING_FEEDS) {
    try {
      all.push(...parseFundingRss(await getText(feed)));
    } catch {
      /* one feed down shouldn't stop others */
    }
  }
  return all;
}

// ---------------- ATS detection from a careers URL ----------------
export function detectAts(url: string): { type: "greenhouse" | "lever" | "ashby" | "workable"; token: string } | null {
  const u = url.toLowerCase();
  let m = u.match(/(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/(?:embed\/job_board\?for=)?([a-z0-9_-]+)/);
  if (m) return { type: "greenhouse", token: m[1] };
  m = u.match(/jobs\.(?:eu\.)?lever\.co\/([a-z0-9_.-]+)/);
  if (m) return { type: "lever", token: m[1] };
  m = u.match(/jobs\.ashbyhq\.com\/([a-z0-9_.%-]+)/);
  if (m) return { type: "ashby", token: decodeURIComponent(m[1]) };
  m = u.match(/apply\.workable\.com\/([a-z0-9_-]+)/);
  if (m) return { type: "workable", token: m[1] };
  return null;
}

export async function fetchAts(type: string, token: string): Promise<RawJob[]> {
  switch (type) {
    case "greenhouse": return fetchGreenhouse(token);
    case "lever": return fetchLever(token);
    case "ashby": return fetchAshby(token);
    case "workable": return fetchWorkable(token);
    default: return [];
  }
}

/** A small default set of public boards; extend via DISCOVERY_COMPANIES or by adding companies' careers URLs. */
export const DEFAULT_BOARDS: { type: string; token: string }[] = [
  { type: "greenhouse", token: "vercel" },
  { type: "greenhouse", token: "stripe" },
  { type: "greenhouse", token: "discord" },
  { type: "greenhouse", token: "anthropic" },
  { type: "lever", token: "plaid" },
  { type: "ashby", token: "linear" },
  { type: "ashby", token: "ramp" },
  { type: "ashby", token: "supabase" },
];

export function configuredBoards(): { type: string; token: string }[] {
  if (!config.DISCOVERY_COMPANIES) return DEFAULT_BOARDS;
  return config.DISCOVERY_COMPANIES.split(",").map((s) => s.trim()).filter(Boolean).map((s) => {
    const [type, token] = s.split(":");
    return { type, token };
  });
}
