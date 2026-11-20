import { extractSkills, normalizeSkills, RELATED_SKILLS } from "./skills";
import type { EmploymentType, JobForMatching, MatchResult, ProfileForMatching, TargetRole, WorkMode } from "./types";

const ROLE_KEYWORDS: Record<TargetRole, RegExp> = {
  sde: /\b(software (development )?engineer|sde|swe|software developer|developer|programmer)\b/i,
  frontend: /\b(front[- ]?end|ui engineer|react developer|web developer)\b/i,
  backend: /\b(back[- ]?end|api engineer|server|platform engineer)\b/i,
  fullstack: /\b(full[- ]?stack)\b/i,
  ai_engineer: /\b(ai engineer|llm|genai|generative ai|applied ai|ai\/ml|prompt engineer)\b/i,
  ml_engineer: /\b(machine learning|ml engineer|mlops|data scientist|research engineer)\b/i,
  data_engineer: /\b(data engineer|analytics engineer|etl|data platform)\b/i,
  devops: /\b(devops|sre|site reliability|infrastructure|cloud engineer)\b/i,
  mobile: /\b(mobile|android|ios|react native|flutter)\b/i,
  designer: /\b(designer|ux|ui\/ux|product design)\b/i,
  product: /\b(product manager|pm\b|product owner)\b/i,
};

const SENIOR_RE = /\b(senior|sr\.?|staff|principal|lead|head of|director|manager|architect)\b/i;
const JUNIOR_RE = /\b(intern|internship|junior|jr\.?|entry[- ]level|graduate|new grad|fresher|trainee|associate)\b/i;

export function detectEmploymentType(text: string): EmploymentType | null {
  if (/\bintern(ship)?\b/i.test(text)) return "internship";
  if (/\b(freelance|freelancer)\b/i.test(text)) return "freelance";
  if (/\b(contract|contractor|c2c|1099)\b/i.test(text)) return "contract";
  if (/\b(full[- ]?time|permanent|fte)\b/i.test(text)) return "full_time";
  return null;
}

export function detectWorkMode(text: string): WorkMode | null {
  if (/\bhybrid\b/i.test(text)) return "hybrid";
  if (/\b(remote|work from home|wfh|anywhere|distributed)\b/i.test(text)) return "remote";
  if (/\b(on[- ]?site|in[- ]office|in office)\b/i.test(text)) return "onsite";
  return null;
}

/** Years-of-experience requirement, e.g. "3+ years", "2-4 years of experience". */
export function detectRequiredYears(text: string): number | null {
  const m = text.match(/(\d{1,2})\s*(?:\+|-\s*\d{1,2})?\s*(?:\+\s*)?(?:years?|yrs?)(?:\s+of)?(?:\s+\w+){0,3}\s+experience/i)
    ?? text.match(/experience[^.]{0,30}?(\d{1,2})\s*\+?\s*(?:years?|yrs?)/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n < 30 ? n : null;
}

function clamp(n: number, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Deterministic 0–100 match score with human-readable reasons.
 * Weights: skills 45, role 20, seniority 15, location/work-mode 10, employment type 5, compensation 5.
 */
export function scoreJob(profile: ProfileForMatching, job: JobForMatching): MatchResult {
  const text = `${job.title}\n${job.description}\n${(job.tags ?? []).join(", ")}`;
  const jobSkills = normalizeSkills([...extractSkills(text), ...(job.tags ?? [])]).filter((s) => s.length > 1);
  const mySkills = new Set(normalizeSkills(profile.skills));
  const reasons: string[] = [];
  const breakdown: Record<string, number> = {};

  // ---- Skills (45)
  const matched: string[] = [];
  const partial: string[] = [];
  const missing: string[] = [];
  for (const s of jobSkills) {
    if (mySkills.has(s)) matched.push(s);
    else if ((RELATED_SKILLS[s] ?? []).some((r) => mySkills.has(r))) partial.push(s);
    else missing.push(s);
  }
  let skillScore: number;
  if (jobSkills.length === 0) {
    skillScore = 22; // unknown requirements: neutral
  } else {
    const ratio = (matched.length + partial.length * 0.5) / jobSkills.length;
    // Reward absolute overlap too, so a long JD listing 20 tools isn't over-penalised.
    const absolute = Math.min(1, (matched.length + partial.length * 0.5) / 5);
    skillScore = 45 * (0.6 * ratio + 0.4 * absolute);
  }
  breakdown.skills = Math.round(skillScore);
  if (matched.length) reasons.push(`Matches your ${humanList(matched.slice(0, 4))}`);
  if (partial.length) reasons.push(`Related experience for ${humanList(partial.slice(0, 3))}`);

  // ---- Role (20)
  let roleScore = 0;
  const matchedRole = profile.targetRoles.find((r) => ROLE_KEYWORDS[r]?.test(job.title));
  if (matchedRole) {
    roleScore = 20;
    reasons.push(`Title fits your target role (${matchedRole.replace("_", " ")})`);
  } else if (profile.targetRoles.some((r) => ROLE_KEYWORDS[r]?.test(job.description.slice(0, 1500)))) {
    roleScore = 10;
  } else if (profile.targetRoles.length === 0) {
    roleScore = 10;
  }
  breakdown.role = roleScore;

  // ---- Seniority (15)
  let seniority = 10;
  const reqYears = detectRequiredYears(job.description);
  const isSenior = SENIOR_RE.test(job.title);
  const isJunior = JUNIOR_RE.test(job.title) || JUNIOR_RE.test(job.description.slice(0, 600));
  if (profile.experienceLevel === "fresher") {
    if (isJunior) { seniority = 15; reasons.push("Open to freshers / entry level"); }
    else if (isSenior) seniority = 0;
    else if (reqYears != null && reqYears > 2) seniority = 2;
  } else {
    if (isSenior && profile.yearsExperience < 4) seniority = 4;
    else if (isJunior && profile.yearsExperience > 3) seniority = 6;
    else seniority = 13;
    if (reqYears != null) {
      if (profile.yearsExperience >= reqYears) { seniority = 15; reasons.push(`You meet the ${reqYears}+ years requirement`); }
      else if (reqYears - profile.yearsExperience >= 3) seniority = Math.min(seniority, 3);
      else seniority = Math.min(seniority, 8);
    }
  }
  breakdown.seniority = seniority;

  // ---- Location / work mode (10)
  const prefs = profile.preferences;
  const mode = job.workMode ?? (job.remote ? "remote" : detectWorkMode(`${job.location ?? ""} ${job.title} ${job.description.slice(0, 800)}`));
  let loc = 5;
  if (prefs.workModes.length && mode) {
    if (prefs.workModes.includes(mode)) {
      loc = 7;
      if (mode === "remote") reasons.push("Remote, as you prefer");
    } else loc = 1;
  }
  if (mode !== "remote" && prefs.cities.length && job.location) {
    const cityHit = prefs.cities.some((c) => job.location!.toLowerCase().includes(c.toLowerCase()));
    if (cityHit) { loc = 10; reasons.push(`Located in ${job.location}`); }
    else if (mode === "onsite" || mode === "hybrid") loc = Math.min(loc, 2);
  } else if (mode === "remote" && prefs.workModes.includes("remote")) {
    loc = 10;
  }
  breakdown.location = loc;

  // ---- Employment type (5)
  const et = job.employmentType ?? detectEmploymentType(`${job.title} ${job.description.slice(0, 800)}`);
  let etScore = 3;
  if (prefs.employmentTypes.length && et) etScore = prefs.employmentTypes.includes(et) ? 5 : 0;
  breakdown.employmentType = etScore;

  // ---- Compensation (5)
  let comp = 3;
  const want = prefs.expectedComp?.min;
  const offered = job.salaryMax ?? job.salaryMin;
  if (want && offered && (!job.currency || !prefs.expectedComp?.currency || job.currency === prefs.expectedComp.currency)) {
    comp = offered >= want ? 5 : offered >= want * 0.8 ? 3 : 0;
    if (offered >= want) reasons.push("Pay meets your expectation");
  }
  breakdown.compensation = comp;

  // ---- Company size / industry bonus (up to +5, capped at 100)
  let bonus = 0;
  if (job.companySize && prefs.companySizes.includes(job.companySize)) bonus += 3;
  if (job.industry && prefs.industries.some((i) => job.industry!.toLowerCase().includes(i.toLowerCase()))) bonus += 2;
  breakdown.bonus = bonus;

  // Penalty for a hard mismatch in employment type (e.g. student wants internship, job is senior full-time)
  let total = skillScore + roleScore + seniority + loc + etScore + comp + bonus;
  if (prefs.employmentTypes.length === 1 && prefs.employmentTypes[0] === "internship" && et && et !== "internship") total -= 15;

  if (missing.length && missing.length <= 4) reasons.push(`Gaps: ${humanList(missing.slice(0, 3))}`);

  return {
    score: Math.round(clamp(total)),
    reasons,
    matchedSkills: matched,
    missingSkills: missing,
    breakdown,
  };
}

export function humanList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
