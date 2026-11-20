import type { Preferences, Project } from "shared";

export interface User {
  id: string;
  email: string;
  name: string;
  plan: "free" | "pro" | "college";
  orgId: string | null;
  orgRole: "admin" | "member" | null;
  publicSlug: string | null;
  phone: string | null;
  sendingPaused: boolean;
  onboardedAt: string | null;
  notificationPrefs: { push: boolean; whatsapp: boolean; email: boolean };
}

export interface Profile {
  userId: string;
  headline: string | null;
  summary: string | null;
  experienceLevel: "fresher" | "experienced";
  yearsExperience: number;
  targetRoles: string[];
  skills: string[];
  projects: Project[];
  experience: { company: string; title: string; start?: string; end?: string; description?: string }[];
  education: { institution: string; degree?: string; field?: string; end?: string }[];
  links: { github?: string; linkedin?: string; portfolio?: string };
  enrichment: Record<string, unknown>;
  preferences: Preferences;
  writingSample: string | null;
  college: string | null;
  timezone: string;
  publicVisible: boolean;
  resumeFileName: string | null;
  resumeUrl: string | null;
}

export interface Company {
  id: string;
  name: string;
  domain: string | null;
  website: string | null;
  description: string | null;
  product: string | null;
  techStack: string[];
  teamSize: number | null;
  size: "startup" | "scaleup" | "mnc" | null;
  industry: string | null;
  location: string | null;
  fundingStage: string | null;
  recentNews: { title: string; url?: string; date?: string }[];
  emailPattern: string | null;
  emailPatternConfidence: number;
  researchedAt: string | null;
}

export interface Match {
  score: number;
  reasons: string[];
  matchedSkills: string[];
  missingSkills: string[];
  status: "new" | "saved" | "dismissed" | "applied";
}

export interface Job {
  id: string;
  source: string;
  url: string;
  title: string;
  companyName: string;
  companyId: string | null;
  location: string | null;
  remote: boolean;
  workMode: string | null;
  employmentType: string | null;
  description: string;
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string | null;
  postedAt: string | null;
  sources: { source: string; url: string }[];
  scamScore: number;
  scamReasons: string[];
  isHiringPost: boolean;
  createdAt: string;
  match?: Match | null;
  company?: Company | null;
}

export interface Contact {
  id: string;
  companyId: string;
  name: string;
  title: string | null;
  role: string;
  email: string | null;
  emailConfidence: number;
  emailStatus: string;
  emailCandidates: { email: string; confidence: number; status?: string }[];
  linkedinUrl: string | null;
  twitterUrl: string | null;
  githubUrl: string | null;
  college: string | null;
  recentPosts: { title: string; url?: string; date?: string; source: string }[];
  source: string;
}

export interface Message {
  id: string;
  applicationId: string | null;
  campaignId: string | null;
  contactId: string | null;
  toEmail: string;
  step: number;
  subject: string;
  body: string;
  subjectVariants: string[];
  variant: string | null;
  tone: string;
  status: "draft" | "pending_approval" | "scheduled" | "sent" | "bounced" | "failed" | "cancelled";
  scheduledAt: string | null;
  sentAt: string | null;
  openedAt: string | null;
  openCount: number;
  repliedAt: string | null;
  spamScore: number;
  spamHits: string[];
  error: string | null;
  createdAt: string;
  contact?: Contact | null;
  company?: Company | null;
}

export interface Reply {
  id: string;
  messageId: string | null;
  applicationId: string | null;
  fromEmail: string;
  subject: string;
  body: string;
  receivedAt: string;
  category: string;
  confidence: number;
  suggestedReply: string | null;
  handled: boolean;
  original: { id: string; subject: string; body: string; sentAt: string | null } | null;
  contact: Contact | null;
  company: Company | null;
}

export interface Campaign {
  id: string;
  name: string;
  status: "draft" | "active" | "paused" | "completed";
  mode: "approval" | "autopilot";
  tone: string;
  filters: { query?: string; minScore?: number; remoteOnly?: boolean; companySizes?: string[]; sources?: string[]; jobIds?: string[] };
  sequence: { dayOffset: number; kind: string }[];
  sendWindow: { startHour: number; endHour: number; weekdaysOnly: boolean; preferredHour?: number };
  abTest: boolean;
  createdAt: string;
  stats?: { total: number; sent: number; pending: number; scheduled: number; replied: number; opened: number };
}

export interface Application {
  id: string;
  stage: string;
  source: string;
  roleTitle: string | null;
  createdAt: string;
  updatedAt: string;
  company: { id: string; name: string; domain: string | null };
  job: { id: string; title: string; url: string } | null;
  contact: { id: string; name: string; title: string | null } | null;
}

export interface EmailAccount {
  id: string;
  provider: "gmail" | "outlook" | "dev";
  email: string;
  dailyLimit: number;
  warmupEnabled: boolean;
  warmupStartedAt: string | null;
  healthScore: number;
  status: string;
  lastError: string | null;
  sentToday: number;
  todayLimit: number;
  warmupDay: number | null;
}

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  read: boolean;
  createdAt: string;
}

export interface RateRow {
  key: string;
  sent: number;
  opens: number;
  replies: number;
  positive: number;
  openRate: number;
  replyRate: number;
}
