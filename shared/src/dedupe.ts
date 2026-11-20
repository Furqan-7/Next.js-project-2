const COMPANY_SUFFIX = /\b(inc|inc\.|llc|ltd|ltd\.|limited|corp|corporation|co|gmbh|pvt|private|technologies|technology|labs|hq|ai)\b\.?/gi;
const TITLE_NOISE = /\b(remote|hybrid|onsite|on-site|urgent|hiring|immediate joiner|f\/m\/d|m\/f\/d|\(.*?\)|\[.*?\])/gi;

const TITLE_SYNONYMS: [RegExp, string][] = [
  [/\bsr\.?\b/g, "senior"],
  [/\bjr\.?\b/g, "junior"],
  [/\bswe\b/g, "software engineer"],
  [/\bsde\b/g, "software engineer"],
  [/\bsoftware development engineer\b/g, "software engineer"],
  [/\bdeveloper\b/g, "engineer"],
  [/\bfront[- ]end\b/g, "frontend"],
  [/\bback[- ]end\b/g, "backend"],
  [/\bfull[- ]stack\b/g, "fullstack"],
  [/\bintern(ship)?\b/g, "intern"],
  [/\bml\b/g, "machine learning"],
];

export function normalizeCompany(name: string): string {
  return name
    .toLowerCase()
    .replace(COMPANY_SUFFIX, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeTitle(title: string): string {
  let t = title.toLowerCase().replace(TITLE_NOISE, " ");
  for (const [re, rep] of TITLE_SYNONYMS) t = t.replace(re, rep);
  return t.replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

export function normalizeLocation(loc?: string | null): string {
  if (!loc) return "";
  const l = loc.toLowerCase();
  if (/remote|anywhere|worldwide/.test(l)) return "remote";
  return l.split(/[,/|(]/)[0].replace(/[^a-z]+/g, " ").trim();
}

/** Stable key identifying "the same job" across platforms. */
export function dedupeKey(job: { company: string; title: string; location?: string | null }): string {
  return `${normalizeCompany(job.company)}|${normalizeTitle(job.title)}|${normalizeLocation(job.location)}`;
}

function tokens(s: string): Set<string> {
  return new Set(s.split(" ").filter((w) => w.length > 1));
}

export function jaccard(a: string, b: string): number {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.size && !B.size) return 1;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Fuzzy duplicate check, for near-identical titles that don't produce the same key. */
export function isLikelyDuplicate(
  a: { company: string; title: string; location?: string | null },
  b: { company: string; title: string; location?: string | null },
): boolean {
  if (normalizeCompany(a.company) !== normalizeCompany(b.company)) return false;
  const la = normalizeLocation(a.location);
  const lb = normalizeLocation(b.location);
  if (la && lb && la !== lb) return false;
  return jaccard(normalizeTitle(a.title), normalizeTitle(b.title)) >= 0.8;
}

/** Merge a list of jobs, collapsing duplicates; keeps the first and records all source URLs. */
export function dedupeJobs<T extends { company: string; title: string; location?: string | null; url: string; source: string }>(
  jobs: T[],
): (T & { sources: { source: string; url: string }[] })[] {
  const out: (T & { sources: { source: string; url: string }[] })[] = [];
  const byKey = new Map<string, number>();
  for (const j of jobs) {
    const key = dedupeKey(j);
    let idx = byKey.get(key);
    if (idx === undefined) idx = out.findIndex((o) => isLikelyDuplicate(o, j));
    if (idx === undefined || idx < 0) {
      byKey.set(key, out.length);
      out.push({ ...j, sources: [{ source: j.source, url: j.url }] });
    } else {
      const existing = out[idx];
      if (!existing.sources.some((s) => s.url === j.url)) existing.sources.push({ source: j.source, url: j.url });
    }
  }
  return out;
}
