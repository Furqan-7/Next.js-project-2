import { extractSkills, normalizeSkills } from "./skills";
import type { EducationItem, ExperienceItem, ParsedResume, Project } from "./types";

const SECTION_HEADINGS: Record<string, RegExp> = {
  summary: /^(summary|profile|about( me)?|objective|professional summary)$/i,
  skills: /^(technical )?skills( & tools| and tools)?$|^tech(nical)? stack$|^technologies$|^core competencies$/i,
  experience: /^(work |professional )?experience$|^employment( history)?$|^internships?$|^work history$/i,
  projects: /^(personal |academic |key |side )?projects$/i,
  education: /^education( & certifications)?$|^academics?$|^academic background$/i,
  certifications: /^certifications?$|^achievements?$|^awards?$/i,
};

const MONTH = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?";
const DATE_RANGE_RE = new RegExp(
  `((?:${MONTH}\\s+)?(?:19|20)\\d{2}|\\d{1,2}/(?:19|20)\\d{2})\\s*(?:-|–|—|to)\\s*((?:${MONTH}\\s+)?(?:19|20)\\d{2}|\\d{1,2}/(?:19|20)\\d{2}|present|current|now|ongoing)`,
  "i",
);

function splitSections(text: string): Record<string, string[]> {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const sections: Record<string, string[]> = { header: [] };
  let current = "header";
  for (const line of lines) {
    const bare = line.replace(/[:\-–_|•*#]+$/g, "").replace(/^[#•*\s]+/, "").trim();
    const heading = Object.entries(SECTION_HEADINGS).find(([, re]) => bare.length < 40 && re.test(bare));
    if (heading) {
      current = heading[0];
      sections[current] ??= [];
      continue;
    }
    if (line) (sections[current] ??= []).push(line);
  }
  return sections;
}

function parseYear(s: string): number | null {
  if (/present|current|now|ongoing/i.test(s)) return new Date().getFullYear() + new Date().getMonth() / 12;
  const y = s.match(/(19|20)\d{2}/);
  if (!y) return null;
  const monthMatch = s.toLowerCase().match(/jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/);
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const m = monthMatch ? months.indexOf(monthMatch[0]) : 0;
  return Number(y[0]) + m / 12;
}

const BULLET = /^[•\-*▪◦●‣]\s*/;

function groupEntries(lines: string[]): string[][] {
  // New entry when a non-bullet line follows bullet lines, or a line contains a date range
  const entries: string[][] = [];
  let cur: string[] = [];
  let sawBullet = false;
  for (const l of lines) {
    const isBullet = BULLET.test(l);
    const startsNew = !isBullet && (sawBullet || (DATE_RANGE_RE.test(l) && cur.length > 1));
    if (startsNew && cur.length) {
      entries.push(cur);
      cur = [];
      sawBullet = false;
    }
    cur.push(l);
    if (isBullet) sawBullet = true;
  }
  if (cur.length) entries.push(cur);
  return entries;
}

function parseExperience(lines: string[]): ExperienceItem[] {
  return groupEntries(lines)
    .map((entry) => {
      const headerLines = entry.filter((l) => !BULLET.test(l));
      const bullets = entry.filter((l) => BULLET.test(l)).map((l) => l.replace(BULLET, ""));
      const joined = headerLines.join(" | ");
      const dates = joined.match(DATE_RANGE_RE);
      const cleaned = joined.replace(DATE_RANGE_RE, "").replace(/\s*\|\s*$/, "");
      const parts = cleaned.split(/\s+(?:at|@)\s+|\s*[|,–—]\s*|\s+-\s+/).map((p) => p.trim()).filter(Boolean);
      const titleIdx = parts.findIndex((p) => /engineer|developer|intern|analyst|scientist|designer|manager|lead|architect|consultant|associate|founder/i.test(p));
      const title = titleIdx >= 0 ? parts[titleIdx] : parts[0] ?? "";
      const company = parts.find((p, i) => i !== titleIdx && !/^(remote|hybrid|onsite)$/i.test(p)) ?? "";
      const description = bullets.join(" ");
      return {
        title,
        company,
        start: dates?.[1],
        end: dates?.[2],
        description,
        technologies: extractSkills(`${joined} ${description}`),
      };
    })
    .filter((e) => e.title || e.company);
}

function parseProjects(lines: string[]): Project[] {
  return groupEntries(lines)
    .map((entry) => {
      const header = entry.find((l) => !BULLET.test(l)) ?? entry[0];
      const rest = entry.filter((l) => l !== header).map((l) => l.replace(BULLET, ""));
      const url = entry.join(" ").match(/https?:\/\/\S+|github\.com\/\S+/)?.[0];
      const [namePart, techPart] = header.split(/\s*[|–—:]\s*|\s+-\s+/, 2);
      const techFromHeader = techPart ? techPart.split(/[,/]/).map((t) => t.trim()).filter(Boolean) : [];
      const description = rest.join(" ");
      return {
        name: namePart.replace(/\(.*?\)/g, "").replace(/https?:\/\/\S+/, "").trim(),
        description,
        technologies: normalizeSkills([...techFromHeader.filter((t) => t.length < 25), ...extractSkills(`${header} ${description}`)]),
        url: url ? (url.startsWith("http") ? url : `https://${url}`) : undefined,
        highlights: rest.slice(0, 4),
      };
    })
    .filter((p) => p.name && p.name.length < 80);
}

function parseEducation(lines: string[]): EducationItem[] {
  const out: EducationItem[] = [];
  for (const entry of groupEntries(lines)) {
    const text = entry.join(" | ");
    const institution =
      entry.find((l) => /university|college|institute|school|iit|nit|iiit|bits|academy/i.test(l))?.split(/\s*[|,–—]\s*/)[0] ?? entry[0];
    const degree = text.match(/\b(b\.?\s?tech|b\.?e\.?|b\.?sc|bachelor[^,|]*|m\.?\s?tech|m\.?sc|master[^,|]*|mba|ph\.?d|bca|mca|diploma|high school|12th|10th)\b/i)?.[0];
    const field = text.match(/\b(computer science|information technology|electronics|electrical|mechanical|data science|artificial intelligence|mathematics|software engineering)[^,|]*/i)?.[0];
    const dates = text.match(DATE_RANGE_RE) ?? text.match(/((?:19|20)\d{2})/);
    const grade = text.match(/\b(cgpa|gpa|percentage)[:\s]*([\d.]+\s*(\/\s*[\d.]+)?%?)/i)?.[0];
    out.push({ institution: institution.trim(), degree, field: field?.trim(), start: dates?.[1], end: dates?.[2], grade });
  }
  return out.filter((e) => e.institution);
}

/** Best-effort resume parser used when no LLM is configured (and as a cross-check). */
export function parseResumeText(text: string): ParsedResume {
  const sections = splitSections(text);
  const header = sections.header ?? [];
  const email = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0];
  const phone = text.match(/(\+?\d[\d\s-]{8,14}\d)/)?.[0]?.trim();
  const github = text.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/[A-Za-z0-9-]+/i)?.[0];
  const linkedin = text.match(/(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[A-Za-z0-9-_%]+/i)?.[0];
  const portfolio = text
    .match(/(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+\.(?:dev|me|io|app|vercel\.app|netlify\.app|com|in|xyz|site)(?:\/[^\s|]*)?/gi)
    ?.find((u) => !/github|linkedin|gmail|outlook|yahoo|hotmail/i.test(u));
  const name = header.find((l) => /^[A-Za-z][A-Za-z .'-]{2,40}$/.test(l) && l.split(" ").length <= 4 && !/resume|curriculum/i.test(l));
  const headline = header.find((l) => l !== name && /engineer|developer|student|designer|scientist|intern/i.test(l) && l.length < 100);

  const skillLines = sections.skills ?? [];
  const listed = skillLines
    .join(", ")
    .replace(/^[^:]{0,30}:/gm, "")
    .split(/[,|•;\n]|(?:\s{2,})/)
    .map((s) => s.replace(/^[A-Za-z ]{2,25}:\s*/, "").trim())
    .filter((s) => s.length > 0 && s.length < 30);
  const skills = normalizeSkills([...listed, ...extractSkills(text)]);

  const experience = parseExperience(sections.experience ?? []);
  const projects = parseProjects(sections.projects ?? []);
  const education = parseEducation(sections.education ?? []);

  let months = 0;
  for (const e of experience) {
    const s = e.start ? parseYear(e.start) : null;
    const en = e.end ? parseYear(e.end) : null;
    if (s && en && en >= s && !/intern/i.test(e.title)) months += (en - s) * 12;
  }
  const norm = (u?: string) => (u ? (u.startsWith("http") ? u : `https://${u}`) : undefined);
  return {
    name,
    email,
    phone,
    headline,
    summary: (sections.summary ?? []).join(" ") || undefined,
    skills,
    projects,
    experience,
    education,
    links: { github: norm(github), linkedin: norm(linkedin), portfolio: norm(portfolio) },
    yearsExperience: Math.round((months / 12) * 10) / 10,
  };
}
