import { promises as dns } from "node:dns";
import { and, desc, eq } from "drizzle-orm";
import { config } from "../config";
import { db, schema } from "db";
import { randomToken } from "../lib/crypto";
import { gmailFindPlacement, sendEmail, type EmailAccount } from "./mail/providers";
import { lookupMx } from "./emailVerify";
import { recomputeHealth } from "./replies";

const HOSTED = new Set(["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "yahoo.com", "icloud.com"]);
const DKIM_SELECTORS = ["google", "selector1", "selector2", "default", "k1", "s1", "s2", "mail", "dkim", "zoho", "mxvault"];

async function txt(name: string): Promise<string[]> {
  if (config.OFFLINE) return [];
  try {
    return (await dns.resolveTxt(name)).map((r) => r.join(""));
  } catch {
    return [];
  }
}

export interface DnsCheck {
  domain: string;
  hostedProvider: boolean;
  mx: { ok: boolean; hosts: string[]; provider: string | null };
  spf: { ok: boolean; record: string | null; issues: string[] };
  dkim: { ok: boolean; selectors: string[] };
  dmarc: { ok: boolean; record: string | null; policy: string | null; issues: string[] };
  score: number;
  guides: { title: string; steps: string[] }[];
}

export function analyzeSpf(records: string[], provider: string | null) {
  const spf = records.filter((r) => r.toLowerCase().startsWith("v=spf1"));
  const issues: string[] = [];
  if (spf.length === 0) issues.push("No SPF record");
  if (spf.length > 1) issues.push("Multiple SPF records (only one is allowed)");
  const rec = spf[0] ?? null;
  if (rec) {
    if (/\+all\b/.test(rec)) issues.push("SPF uses +all, which lets anyone send as you");
    if (provider === "google" && !/include:_spf\.google\.com/.test(rec)) issues.push("SPF doesn't include Google (include:_spf.google.com)");
    if (provider === "microsoft" && !/include:spf\.protection\.outlook\.com/.test(rec)) issues.push("SPF doesn't include Microsoft (include:spf.protection.outlook.com)");
    const lookups = (rec.match(/\b(include|a|mx|ptr|exists|redirect)[:=]/g) ?? []).length;
    if (lookups > 10) issues.push(`SPF needs ${lookups} DNS lookups (max 10)`);
  }
  return { ok: Boolean(rec) && issues.length === 0, record: rec, issues };
}

export function analyzeDmarc(records: string[]) {
  const rec = records.find((r) => r.toLowerCase().startsWith("v=dmarc1")) ?? null;
  const policy = rec?.match(/;\s*p=(\w+)/i)?.[1]?.toLowerCase() ?? null;
  const issues: string[] = [];
  if (!rec) issues.push("No DMARC record");
  else if (policy === "none") issues.push("DMARC policy is p=none (monitoring only); move to quarantine once reports look clean");
  return { ok: Boolean(rec), record: rec, policy, issues };
}

function guidesFor(c: Omit<DnsCheck, "guides" | "score">): DnsCheck["guides"] {
  const g: DnsCheck["guides"] = [];
  const google = c.mx.provider === "google";
  if (!c.spf.ok) {
    g.push({
      title: "Fix SPF",
      steps: [
        "Open your domain's DNS settings (Cloudflare, GoDaddy, Namecheap…).",
        `Add or edit ONE TXT record at the root (@): v=spf1 ${google ? "include:_spf.google.com" : c.mx.provider === "microsoft" ? "include:spf.protection.outlook.com" : "include:<your-provider>"} ~all`,
        "Remove any second v=spf1 record. Wait up to an hour, then re-run this check.",
      ],
    });
  }
  if (!c.dkim.ok) {
    g.push({
      title: "Turn on DKIM",
      steps: google
        ? ["Google Admin → Apps → Google Workspace → Gmail → Authenticate email.", "Generate a 2048-bit key with selector 'google'.", "Add the TXT record google._domainkey to DNS, then click Start authentication."]
        : c.mx.provider === "microsoft"
          ? ["Microsoft Defender portal → Email & collaboration → Policies → DKIM.", "Select your domain, create the two CNAMEs (selector1/selector2) shown, then enable signing."]
          : ["In your email provider's admin panel, find DKIM / domain authentication.", "Copy the TXT or CNAME record it gives you into DNS and enable signing."],
    });
  }
  if (!c.dmarc.ok || c.dmarc.policy === "none") {
    g.push({
      title: c.dmarc.ok ? "Tighten DMARC" : "Add DMARC",
      steps: [
        `Add a TXT record at _dmarc.${c.domain}: v=DMARC1; p=${c.dmarc.ok ? "quarantine" : "none"}; rua=mailto:dmarc@${c.domain}; adkim=s; aspf=s`,
        "Start with p=none for a week, then move to p=quarantine once SPF and DKIM both pass.",
      ],
    });
  }
  return g;
}

export async function checkDomain(domain: string): Promise<DnsCheck> {
  const d = domain.toLowerCase();
  if (HOSTED.has(d)) {
    return {
      domain: d,
      hostedProvider: true,
      mx: { ok: true, hosts: [], provider: d.includes("gmail") ? "google" : "microsoft" },
      spf: { ok: true, record: "managed by provider", issues: [] },
      dkim: { ok: true, selectors: ["managed by provider"] },
      dmarc: { ok: true, record: "managed by provider", policy: "managed", issues: [] },
      score: 100,
      guides: [{ title: "Personal mailbox", steps: ["SPF, DKIM and DMARC are handled by your provider. Keep daily volume low (warm-up is on) and personalise every email."] }],
    };
  }
  const mxRecords = await lookupMx(d);
  const hosts = mxRecords.map((m) => m.exchange.toLowerCase());
  const provider = hosts.some((h) => h.includes("google")) ? "google" : hosts.some((h) => h.includes("outlook") || h.includes("protection.outlook")) ? "microsoft" : hosts.length ? "other" : null;
  const spf = analyzeSpf(await txt(d), provider);
  const dmarc = analyzeDmarc(await txt(`_dmarc.${d}`));
  const selectors: string[] = [];
  for (const s of DKIM_SELECTORS) {
    const recs = await txt(`${s}._domainkey.${d}`);
    if (recs.some((r) => /v=DKIM1|k=rsa|p=/i.test(r))) selectors.push(s);
    else if (!config.OFFLINE) {
      try {
        const cname = await dns.resolveCname(`${s}._domainkey.${d}`);
        if (cname.length) selectors.push(s);
      } catch {
        /* not this selector */
      }
    }
  }
  const base = { domain: d, hostedProvider: false, mx: { ok: hosts.length > 0, hosts, provider }, spf, dkim: { ok: selectors.length > 0, selectors }, dmarc };
  const score = (base.mx.ok ? 20 : 0) + (spf.ok ? 30 : spf.record ? 15 : 0) + (base.dkim.ok ? 30 : 0) + (dmarc.ok ? (dmarc.policy === "none" ? 12 : 20) : 0);
  return { ...base, score, guides: guidesFor(base) };
}

export async function runDeliverabilityCheck(account: EmailAccount) {
  const domain = account.email.split("@")[1];
  const result = await checkDomain(domain);
  await db.insert(schema.deliverabilityChecks).values({ emailAccountId: account.id, domain, result: result as unknown as Record<string, unknown>, score: result.score });
  const health = await recomputeHealth(account.id);
  return { dns: result, health };
}

/** Inbox-placement test: send to a seed mailbox the user owns and later check which folder it landed in. */
export async function startPlacementTest(account: EmailAccount, seedEmail: string) {
  const token = `JP-${randomToken(6)}`;
  await sendEmail(account, {
    from: account.email,
    to: seedEmail,
    subject: `Quick question about your team (${token})`,
    text: `Hi,\n\nThis is a deliverability test from JobPilot (${token}). You can delete it.\n\nThanks`,
  });
  const [row] = await db.insert(schema.placementTests).values({ emailAccountId: account.id, seedEmail, token }).returning();
  return row;
}

export async function checkPlacementTests(account: EmailAccount, seedAccount?: EmailAccount | null) {
  const pending = await db.select().from(schema.placementTests).where(and(eq(schema.placementTests.emailAccountId, account.id), eq(schema.placementTests.result, "pending"))).orderBy(desc(schema.placementTests.createdAt));
  const results = [];
  for (const t of pending) {
    if (!seedAccount || seedAccount.provider !== "gmail") break;
    const placement = await gmailFindPlacement(seedAccount, t.token);
    const [u] = await db.update(schema.placementTests).set({ result: placement, checkedAt: new Date() }).where(eq(schema.placementTests.id, t.id)).returning();
    results.push(u);
  }
  if (results.length) await recomputeHealth(account.id);
  return results;
}
