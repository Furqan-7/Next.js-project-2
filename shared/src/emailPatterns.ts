export const EMAIL_PATTERNS = [
  "{first}",
  "{first}.{last}",
  "{first}{last}",
  "{f}{last}",
  "{f}.{last}",
  "{first}_{last}",
  "{first}{l}",
  "{first}.{l}",
  "{last}",
  "{last}.{first}",
  "{last}{f}",
  "{first}-{last}",
] as const;
export type EmailPattern = (typeof EMAIL_PATTERNS)[number];

/** How common each pattern is across startups/tech companies (prior, sums to ~1). */
export const PATTERN_PRIOR: Record<EmailPattern, number> = {
  "{first}": 0.3,
  "{first}.{last}": 0.25,
  "{first}{last}": 0.08,
  "{f}{last}": 0.12,
  "{f}.{last}": 0.04,
  "{first}_{last}": 0.03,
  "{first}{l}": 0.05,
  "{first}.{l}": 0.02,
  "{last}": 0.03,
  "{last}.{first}": 0.02,
  "{last}{f}": 0.03,
  "{first}-{last}": 0.03,
};

export function cleanNamePart(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

export function splitName(full: string): { first: string; last: string } {
  const parts = full
    .replace(/\b(dr|mr|mrs|ms|prof)\.?\s+/gi, "")
    .replace(/\(.*?\)/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return { first: "", last: "" };
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts[0], last: parts[parts.length - 1] };
}

export function applyPattern(pattern: EmailPattern, first: string, last: string, domain: string): string | null {
  const f = cleanNamePart(first);
  const l = cleanNamePart(last);
  if (!f) return null;
  if (pattern.includes("{last}") || pattern.includes("{l}")) {
    if (!l) return null;
  }
  const local = pattern
    .replace("{first}", f)
    .replace("{last}", l)
    .replace("{f}", f[0])
    .replace("{l}", l[0] ?? "");
  return `${local}@${domain.toLowerCase()}`;
}

/** Given a known address and the person's name, which pattern(s) produce it? */
export function inferPatternFromExample(email: string, fullName: string): EmailPattern[] {
  const [local, domain] = email.toLowerCase().split("@");
  if (!local || !domain) return [];
  const { first, last } = splitName(fullName);
  return EMAIL_PATTERNS.filter((p) => applyPattern(p, first, last, domain)?.split("@")[0] === local);
}

export interface PatternDetection {
  pattern: EmailPattern | null;
  confidence: number; // 0..1
  votes: Partial<Record<EmailPattern, number>>;
  sampleSize: number;
}

/** Detect a company's pattern from known (email, name) examples found on the web, commits, etc. */
export function detectPattern(examples: { email: string; name: string }[], domain: string): PatternDetection {
  const votes: Partial<Record<EmailPattern, number>> = {};
  let usable = 0;
  for (const ex of examples) {
    if (!ex.email.toLowerCase().endsWith(`@${domain.toLowerCase()}`)) continue;
    const matches = inferPatternFromExample(ex.email, ex.name);
    if (!matches.length) continue;
    usable++;
    for (const m of matches) votes[m] = (votes[m] ?? 0) + 1 / matches.length;
  }
  if (!usable) return { pattern: null, confidence: 0, votes, sampleSize: 0 };
  const ranked = (Object.entries(votes) as [EmailPattern, number][]).sort((a, b) => b[1] - a[1]);
  const [best, bestVotes] = ranked[0];
  const agreement = bestVotes / usable;
  // More samples => more confidence; cap at 0.97 because people use aliases.
  const confidence = Math.min(0.97, agreement * (1 - Math.pow(0.5, usable)) + 0.05);
  return { pattern: best, confidence: Number(confidence.toFixed(2)), votes, sampleSize: usable };
}

export interface EmailCandidate {
  email: string;
  pattern: EmailPattern;
  confidence: number; // 0..100
}

/**
 * Ranked candidate addresses for a person. If the company pattern is known, it dominates;
 * otherwise the global prior is used.
 */
export function generateCandidates(
  fullName: string,
  domain: string,
  known?: { pattern: EmailPattern | null; confidence: number },
  limit = 5,
): EmailCandidate[] {
  const { first, last } = splitName(fullName);
  const out: EmailCandidate[] = [];
  for (const p of EMAIL_PATTERNS) {
    const email = applyPattern(p, first, last, domain);
    if (!email) continue;
    let conf = PATTERN_PRIOR[p];
    if (known?.pattern) {
      conf = p === known.pattern ? 0.5 + 0.5 * known.confidence : conf * (1 - known.confidence);
    }
    out.push({ email, pattern: p, confidence: Math.round(conf * 100) });
  }
  // de-duplicate (e.g. single-letter names can collide)
  const seen = new Set<string>();
  return out
    .sort((a, b) => b.confidence - a.confidence)
    .filter((c) => (seen.has(c.email) ? false : (seen.add(c.email), true)))
    .slice(0, limit);
}

/** Combine pattern confidence with verification outcome into a 0–100 display score. */
export function finalEmailConfidence(
  patternConfidence: number,
  verification: "valid" | "invalid" | "risky" | "catch_all" | "unknown",
  hasMx: boolean,
): number {
  if (!hasMx || verification === "invalid") return 0;
  switch (verification) {
    case "valid":
      return Math.max(90, Math.min(99, patternConfidence + 30));
    case "catch_all":
      return Math.min(85, Math.round(patternConfidence * 0.9));
    case "risky":
      return Math.min(60, Math.round(patternConfidence * 0.7));
    default:
      return Math.min(80, Math.round(patternConfidence * 0.85));
  }
}

export const ROLE_TITLE_PATTERNS: { role: "founder" | "cto" | "hiring_manager" | "recruiter" | "engineer"; re: RegExp; priority: number }[] = [
  { role: "founder", re: /\b(co[- ]?founder|founder|ceo|chief executive)\b/i, priority: 1 },
  { role: "cto", re: /\b(cto|chief technology|vp,? engineering|vp of engineering|head of engineering)\b/i, priority: 2 },
  { role: "hiring_manager", re: /\b(engineering manager|em\b|tech lead|team lead|director of engineering|head of (product|ai|data|frontend|backend))\b/i, priority: 3 },
  { role: "recruiter", re: /\b(recruit(er|ing)|talent|people (ops|partner)|hr\b|human resources)\b/i, priority: 4 },
  { role: "engineer", re: /\b(engineer|developer|scientist)\b/i, priority: 5 },
];

export function classifyTitle(title: string): "founder" | "cto" | "hiring_manager" | "recruiter" | "engineer" | "other" {
  for (const r of ROLE_TITLE_PATTERNS) if (r.re.test(title)) return r.role;
  return "other";
}

/** Who to email first, given company size: founders at startups, recruiters/HMs at bigger companies. */
export function contactPriority(role: string, companySize: "startup" | "scaleup" | "mnc" | null | undefined): number {
  const startup: Record<string, number> = { founder: 1, cto: 2, hiring_manager: 3, recruiter: 4, engineer: 5, other: 6 };
  const big: Record<string, number> = { hiring_manager: 1, recruiter: 2, cto: 3, engineer: 4, founder: 5, other: 6 };
  return (companySize === "mnc" || companySize === "scaleup" ? big : startup)[role] ?? 6;
}
