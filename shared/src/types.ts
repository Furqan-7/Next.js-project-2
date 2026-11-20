export const EXPERIENCE_LEVELS = ["fresher", "experienced"] as const;
export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number];

export const WORK_MODES = ["remote", "hybrid", "onsite"] as const;
export type WorkMode = (typeof WORK_MODES)[number];

export const EMPLOYMENT_TYPES = ["internship", "full_time", "freelance", "contract"] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export const COMPANY_SIZES = ["startup", "scaleup", "mnc"] as const;
export type CompanySize = (typeof COMPANY_SIZES)[number];

export const TARGET_ROLES = [
  "sde",
  "frontend",
  "backend",
  "fullstack",
  "ai_engineer",
  "ml_engineer",
  "data_engineer",
  "devops",
  "mobile",
  "designer",
  "product",
] as const;
export type TargetRole = (typeof TARGET_ROLES)[number];

export const TONES = ["formal", "casual", "founder"] as const;
export type Tone = (typeof TONES)[number];

export const STAGES = ["found", "emailed", "replied", "interview", "offer", "rejected"] as const;
export type Stage = (typeof STAGES)[number];

export const REPLY_CATEGORIES = [
  "interested",
  "rejected",
  "referral",
  "out_of_office",
  "asked_for_resume",
  "other",
] as const;
export type ReplyCategory = (typeof REPLY_CATEGORIES)[number];

export const CONTACT_ROLES = ["founder", "cto", "hiring_manager", "recruiter", "engineer", "other"] as const;
export type ContactRole = (typeof CONTACT_ROLES)[number];

export const EMAIL_STATUSES = ["unknown", "valid", "invalid", "risky", "catch_all"] as const;
export type EmailStatus = (typeof EMAIL_STATUSES)[number];

export const MESSAGE_STATUSES = [
  "draft",
  "pending_approval",
  "scheduled",
  "sent",
  "bounced",
  "failed",
  "cancelled",
] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export const PLANS = ["free", "pro", "college"] as const;
export type Plan = (typeof PLANS)[number];

export const JOB_SOURCES = [
  "greenhouse",
  "lever",
  "ashby",
  "workable",
  "remotive",
  "remoteok",
  "hn",
  "yc",
  "wellfound",
  "x",
  "linkedin",
  "manual",
  "extension",
] as const;
export type JobSource = (typeof JOB_SOURCES)[number];

export interface Project {
  name: string;
  description: string;
  technologies: string[];
  url?: string;
  highlights?: string[];
}

export interface ExperienceItem {
  company: string;
  title: string;
  start?: string;
  end?: string;
  description?: string;
  technologies?: string[];
}

export interface EducationItem {
  institution: string;
  degree?: string;
  field?: string;
  start?: string;
  end?: string;
  grade?: string;
}

export interface ParsedResume {
  name?: string;
  email?: string;
  phone?: string;
  headline?: string;
  summary?: string;
  skills: string[];
  projects: Project[];
  experience: ExperienceItem[];
  education: EducationItem[];
  links: { github?: string; linkedin?: string; portfolio?: string };
  yearsExperience: number;
}

export interface Preferences {
  workModes: WorkMode[];
  cities: string[];
  expectedComp?: { min?: number; max?: number; currency: string; period: "month" | "year" };
  companySizes: CompanySize[];
  industries: string[];
  employmentTypes: EmploymentType[];
}

export interface ProfileForMatching {
  skills: string[];
  targetRoles: TargetRole[];
  experienceLevel: ExperienceLevel;
  yearsExperience: number;
  preferences: Preferences;
  projects: Project[];
}

export interface JobForMatching {
  title: string;
  company: string;
  description: string;
  location?: string | null;
  remote?: boolean | null;
  workMode?: WorkMode | null;
  employmentType?: EmploymentType | null;
  salaryMin?: number | null;
  salaryMax?: number | null;
  currency?: string | null;
  tags?: string[];
  companySize?: CompanySize | null;
  industry?: string | null;
}

export interface MatchResult {
  score: number;
  reasons: string[];
  missingSkills: string[];
  matchedSkills: string[];
  breakdown: Record<string, number>;
}

export interface SequenceStep {
  dayOffset: number;
  kind: "initial" | "followup";
}

export const DEFAULT_SEQUENCE: SequenceStep[] = [
  { dayOffset: 0, kind: "initial" },
  { dayOffset: 3, kind: "followup" },
  { dayOffset: 7, kind: "followup" },
  { dayOffset: 14, kind: "followup" },
];
