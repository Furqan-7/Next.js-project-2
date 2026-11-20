import { extractSkills, guessTimezone, normalizeSkills } from "shared";
import { XMLParser } from "fast-xml-parser";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { aiStructured } from "../lib/llm";
import { db, schema } from "db";
import { getText, stripHtml } from "../lib/http";
import { logger } from "../lib/logger";
import { sizeFromTeam, type Company } from "./companies";

/** Signatures of front-end/back-end technology visible in a homepage's HTML. */
const HTML_TECH: [RegExp, string][] = [
  [/_next\/static|__NEXT_DATA__/i, "Next.js"],
  [/data-reactroot|react-dom|__REACT_DEVTOOLS/i, "React"],
  [/__NUXT__|_nuxt\//i, "Nuxt"],
  [/ng-version=/i, "Angular"],
  [/data-v-[a-f0-9]{6,}|vue(\.min)?\.js/i, "Vue.js"],
  [/svelte-[a-z0-9]{5,}|__sveltekit/i, "Svelte"],
  [/tailwind|tw-[a-z]/i, "Tailwind CSS"],
  [/wp-content|wordpress/i, "WordPress"],
  [/cdn\.shopify\.com/i, "Shopify"],
  [/webflow/i, "Webflow"],
  [/framerusercontent|framer\.com/i, "Framer"],
  [/vercel|x-vercel/i, "Vercel"],
  [/cloudflare/i, "Cloudflare"],
  [/segment\.com\/analytics|cdn\.segment/i, "Segment"],
  [/stripe\.com\/v3|js\.stripe\.com/i, "Stripe"],
  [/intercom/i, "Intercom"],
  [/supabase/i, "Supabase"],
  [/firebase/i, "Firebase"],
  [/graphql/i, "GraphQL"],
];

export function detectTechFromHtml(html: string): string[] {
  return [...new Set(HTML_TECH.filter(([re]) => re.test(html)).map(([, t]) => t))];
}

export function extractMeta(html: string) {
  const pick = (re: RegExp) => html.match(re)?.[1]?.trim();
  return {
    title: pick(/<title[^>]*>([^<]*)<\/title>/i),
    description: pick(/<meta[^>]+(?:name|property)=["'](?:og:)?description["'][^>]+content=["']([^"']*)/i) ?? pick(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i),
    twitter: pick(/href=["'](https?:\/\/(?:twitter|x)\.com\/[A-Za-z0-9_]+)["']/i),
    linkedin: pick(/href=["'](https?:\/\/(?:www\.)?linkedin\.com\/company\/[^"'?]+)["']/i),
    github: pick(/href=["'](https?:\/\/github\.com\/[A-Za-z0-9-]+)["']/i),
    careers: pick(/href=["']([^"']*(?:careers|jobs)[^"']*)["']/i),
  };
}

const CardSchema = z.object({
  product: z.string().describe("One sentence: what the company sells and to whom"),
  industry: z.string(),
  teamSizeEstimate: z.number().nullable(),
  talkingPoints: z.array(z.string()).describe("Specific, verifiable hooks a candidate could mention"),
});

export async function googleNews(company: string): Promise<{ title: string; url: string; date?: string }[]> {
  try {
    const xml = await getText(`https://news.google.com/rss/search?q=${encodeURIComponent(`"${company}"`)}&hl=en-US&gl=US&ceid=US:en`);
    const doc = new XMLParser().parse(xml);
    const items: { title?: string; link?: string; pubDate?: string }[] = [doc?.rss?.channel?.item ?? []].flat();
    return items.slice(0, 6).map((i) => ({ title: String(i.title ?? ""), url: String(i.link ?? ""), date: i.pubDate ? new Date(i.pubDate).toISOString() : undefined }));
  } catch {
    return [];
  }
}

/** Builds the company research card: product, tech stack, news, team size. Safe to call repeatedly. */
export async function researchCompany(companyId: string): Promise<Company> {
  const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, companyId));
  if (!company) throw new Error("company not found");
  let html = "";
  if (company.website || company.domain) {
    try {
      html = await getText(company.website ?? `https://${company.domain}`, { timeoutMs: 10000 });
    } catch (e) {
      logger.debug("homepage fetch failed", { company: company.name, error: String(e) });
    }
  }
  const meta: Partial<ReturnType<typeof extractMeta>> = html ? extractMeta(html) : {};
  const pageText = html ? stripHtml(html).slice(0, 12000) : "";
  const jobs = await db.select({ title: schema.jobs.title, description: schema.jobs.description }).from(schema.jobs).where(eq(schema.jobs.companyId, companyId)).orderBy(desc(schema.jobs.createdAt)).limit(10);
  const jdText = jobs.map((j) => `${j.title}\n${j.description.slice(0, 3000)}`).join("\n\n");
  const techStack = normalizeSkills([...company.techStack, ...detectTechFromHtml(html), ...extractSkills(jdText)]);
  const news = (await googleNews(company.name)).filter((n) => n.title);
  const funding = await db.select().from(schema.fundingEvents).where(eq(schema.fundingEvents.companyId, companyId)).orderBy(desc(schema.fundingEvents.announcedAt)).limit(3);

  const { data } = await aiStructured({
    task: "company_card",
    schema: CardSchema,
    system: "You write concise research cards about companies for job seekers. Use only the provided page text, job posts and news. If unsure, say less.",
    prompt: `Company: ${company.name}\nWebsite title: ${meta.title ?? ""}\nMeta description: ${meta.description ?? ""}\n<homepage>\n${pageText.slice(0, 6000)}\n</homepage>\n<jobs>\n${jdText.slice(0, 6000)}\n</jobs>\n<news>\n${news.map((n) => n.title).join("\n")}\n${funding.map((f) => f.title).join("\n")}\n</news>`,
    fallback: () => ({
      product: meta.description || company.description || company.name,
      industry: company.industry ?? "",
      teamSizeEstimate: company.teamSize,
      talkingPoints: [...funding.map((f) => f.title), ...news.slice(0, 2).map((n) => n.title)].slice(0, 4),
    }),
  });

  const recentNews = [...funding.map((f) => ({ title: f.title, url: f.url, date: f.announcedAt?.toISOString() })), ...news, ...company.recentNews]
    .filter((n, i, arr) => arr.findIndex((x) => x.title === n.title) === i)
    .slice(0, 10);
  const teamSize = company.teamSize ?? data.teamSizeEstimate ?? null;
  const [updated] = await db
    .update(schema.companies)
    .set({
      product: data.product || company.product,
      description: company.description ?? meta.description ?? null,
      industry: data.industry || company.industry,
      techStack,
      teamSize,
      size: company.size ?? sizeFromTeam(teamSize),
      recentNews,
      timezone: company.timezone ?? guessTimezone(company.location, "UTC"),
      researchedAt: new Date(),
    })
    .where(eq(schema.companies.id, companyId))
    .returning();
  return updated;
}
