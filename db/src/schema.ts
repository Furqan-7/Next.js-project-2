import { sql } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  CompanySize,
  EducationItem,
  ExperienceItem,
  Preferences,
  Project,
  SequenceStep,
} from "shared";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

// ---------- Organizations (college / placement cell plan) ----------
export const organizations = pgTable("organizations", {
  id: id(),
  name: text("name").notNull(),
  kind: text("kind").notNull().default("college"),
  seats: integer("seats").notNull().default(100),
  inviteCode: text("invite_code").notNull().unique(),
  createdAt: createdAt(),
});

// ---------- Users ----------
export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  plan: text("plan").$type<"free" | "pro" | "college">().notNull().default("free"),
  orgId: uuid("org_id").references(() => organizations.id, { onDelete: "set null" }),
  orgRole: text("org_role").$type<"admin" | "member">(),
  publicSlug: text("public_slug").unique(),
  phone: text("phone"),
  notificationPrefs: jsonb("notification_prefs").$type<{ push: boolean; whatsapp: boolean; email: boolean }>().notNull().default({ push: true, whatsapp: false, email: false }),
  pushSubscriptions: jsonb("push_subscriptions").$type<unknown[]>().notNull().default([]),
  sendingPaused: boolean("sending_paused").notNull().default(false),
  onboardedAt: timestamp("onboarded_at", { withTimezone: true }),
  createdAt: createdAt(),
});

// ---------- Profile ----------
export const profiles = pgTable("profiles", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  headline: text("headline"),
  summary: text("summary"),
  experienceLevel: text("experience_level").$type<"fresher" | "experienced">().notNull().default("fresher"),
  yearsExperience: real("years_experience").notNull().default(0),
  targetRoles: text("target_roles").array().notNull().default(sql`'{}'::text[]`),
  skills: text("skills").array().notNull().default(sql`'{}'::text[]`),
  projects: jsonb("projects").$type<Project[]>().notNull().default([]),
  experience: jsonb("experience").$type<ExperienceItem[]>().notNull().default([]),
  education: jsonb("education").$type<EducationItem[]>().notNull().default([]),
  links: jsonb("links").$type<{ github?: string; linkedin?: string; portfolio?: string }>().notNull().default({}),
  enrichment: jsonb("enrichment").$type<Record<string, unknown>>().notNull().default({}),
  preferences: jsonb("preferences").$type<Preferences>().notNull().default({ workModes: [], cities: [], companySizes: [], industries: [], employmentTypes: [] }),
  writingSample: text("writing_sample"),
  writingStyle: jsonb("writing_style").$type<Record<string, unknown>>(),
  resumeText: text("resume_text"),
  resumeFileName: text("resume_file_name"),
  resumeUrl: text("resume_url"),
  college: text("college"),
  timezone: text("timezone").notNull().default("UTC"),
  publicVisible: boolean("public_visible").notNull().default(false),
  updatedAt: updatedAt(),
});

// ---------- Companies ----------
export const companies = pgTable(
  "companies",
  {
    id: id(),
    name: text("name").notNull(),
    domain: text("domain"),
    website: text("website"),
    description: text("description"),
    product: text("product"),
    techStack: text("tech_stack").array().notNull().default(sql`'{}'::text[]`),
    teamSize: integer("team_size"),
    size: text("size").$type<CompanySize>(),
    industry: text("industry"),
    location: text("location"),
    timezone: text("timezone"),
    fundingStage: text("funding_stage"),
    recentNews: jsonb("recent_news").$type<{ title: string; url?: string; date?: string }[]>().notNull().default([]),
    emailPattern: text("email_pattern"),
    emailPatternConfidence: real("email_pattern_confidence").notNull().default(0),
    mxOk: boolean("mx_ok"),
    catchAll: boolean("catch_all"),
    atsType: text("ats_type"),
    atsToken: text("ats_token"),
    researchedAt: timestamp("researched_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("companies_domain_idx").on(t.domain), index("companies_name_idx").on(t.name)],
);

// ---------- Jobs ----------
export const jobs = pgTable(
  "jobs",
  {
    id: id(),
    source: text("source").notNull(),
    externalId: text("external_id"),
    url: text("url").notNull(),
    title: text("title").notNull(),
    companyName: text("company_name").notNull(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
    location: text("location"),
    remote: boolean("remote").notNull().default(false),
    workMode: text("work_mode"),
    employmentType: text("employment_type"),
    description: text("description").notNull().default(""),
    salaryMin: doublePrecision("salary_min"),
    salaryMax: doublePrecision("salary_max"),
    currency: text("currency"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    dedupeKey: text("dedupe_key").notNull(),
    sources: jsonb("sources").$type<{ source: string; url: string }[]>().notNull().default([]),
    scamScore: integer("scam_score").notNull().default(0),
    scamReasons: jsonb("scam_reasons").$type<string[]>().notNull().default([]),
    isHiringPost: boolean("is_hiring_post").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("jobs_dedupe_idx").on(t.dedupeKey), index("jobs_created_idx").on(t.createdAt)],
);

export const jobMatches = pgTable(
  "job_matches",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    jobId: uuid("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
    score: integer("score").notNull(),
    reasons: jsonb("reasons").$type<string[]>().notNull().default([]),
    matchedSkills: text("matched_skills").array().notNull().default(sql`'{}'::text[]`),
    missingSkills: text("missing_skills").array().notNull().default(sql`'{}'::text[]`),
    status: text("status").$type<"new" | "saved" | "dismissed" | "applied">().notNull().default("new"),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.jobId] }), index("job_matches_score_idx").on(t.userId, t.score)],
);

export const fundingEvents = pgTable(
  "funding_events",
  {
    id: id(),
    companyName: text("company_name").notNull(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
    amount: text("amount"),
    round: text("round"),
    title: text("title").notNull(),
    url: text("url").notNull(),
    announcedAt: timestamp("announced_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("funding_url_idx").on(t.url)],
);

// ---------- Contacts ----------
export const contacts = pgTable(
  "contacts",
  {
    id: id(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    title: text("title"),
    role: text("role").notNull().default("other"),
    email: text("email"),
    emailConfidence: integer("email_confidence").notNull().default(0),
    emailStatus: text("email_status").notNull().default("unknown"),
    emailCandidates: jsonb("email_candidates").$type<{ email: string; confidence: number; status?: string }[]>().notNull().default([]),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    linkedinUrl: text("linkedin_url"),
    twitterUrl: text("twitter_url"),
    githubUrl: text("github_url"),
    college: text("college"),
    timezone: text("timezone"),
    recentPosts: jsonb("recent_posts").$type<{ title: string; url?: string; date?: string; source: string }[]>().notNull().default([]),
    source: text("source").notNull().default("manual"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("contacts_company_idx").on(t.companyId), uniqueIndex("contacts_company_name_idx").on(t.companyId, t.name)],
);

// ---------- Email accounts ----------
export const emailAccounts = pgTable("email_accounts", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider").$type<"gmail" | "outlook" | "dev">().notNull(),
  email: text("email").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
  dailyLimit: integer("daily_limit").notNull().default(40),
  warmupEnabled: boolean("warmup_enabled").notNull().default(true),
  warmupStartedAt: timestamp("warmup_started_at", { withTimezone: true }).defaultNow(),
  healthScore: integer("health_score").notNull().default(100),
  status: text("status").$type<"active" | "paused" | "error">().notNull().default("active"),
  lastError: text("last_error"),
  syncCursor: text("sync_cursor"), // Gmail historyId / Graph subscription id
  subscriptionExpiresAt: timestamp("subscription_expires_at", { withTimezone: true }),
  createdAt: createdAt(),
});

// ---------- Campaigns ----------
export const campaigns = pgTable("campaigns", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  status: text("status").$type<"draft" | "active" | "paused" | "completed">().notNull().default("draft"),
  mode: text("mode").$type<"approval" | "autopilot">().notNull().default("approval"),
  tone: text("tone").notNull().default("casual"),
  filters: jsonb("filters").$type<{ query?: string; minScore?: number; roles?: string[]; companySizes?: string[]; sources?: string[]; remoteOnly?: boolean; jobIds?: string[] }>().notNull().default({}),
  sequence: jsonb("sequence").$type<SequenceStep[]>().notNull(),
  sendWindow: jsonb("send_window").$type<{ startHour: number; endHour: number; weekdaysOnly: boolean; preferredHour?: number }>().notNull(),
  abTest: boolean("ab_test").notNull().default(false),
  emailAccountId: uuid("email_account_id").references(() => emailAccounts.id, { onDelete: "set null" }),
  includeResume: boolean("include_resume").notNull().default(true),
  createdAt: createdAt(),
});

// ---------- Applications (CRM) ----------
export const applications = pgTable(
  "applications",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
    stage: text("stage").$type<"found" | "emailed" | "replied" | "interview" | "offer" | "rejected">().notNull().default("found"),
    source: text("source").$type<"auto" | "manual">().notNull().default("auto"),
    roleTitle: text("role_title"),
    appliedVia: text("applied_via"),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("applications_user_idx").on(t.userId, t.stage)],
);

export const applicationEvents = pgTable("application_events", {
  id: id(),
  applicationId: uuid("application_id").notNull().references(() => applications.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // stage_changed | note | email_sent | reply | reminder | interview_scheduled | manual_apply
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
});

export const reminders = pgTable("reminders", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  applicationId: uuid("application_id").references(() => applications.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
  done: boolean("done").notNull().default(false),
  notifiedAt: timestamp("notified_at", { withTimezone: true }),
  createdAt: createdAt(),
});

// ---------- Messages (outbound emails) ----------
export const messages = pgTable(
  "messages",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    applicationId: uuid("application_id").references(() => applications.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    emailAccountId: uuid("email_account_id").references(() => emailAccounts.id, { onDelete: "set null" }),
    toEmail: text("to_email").notNull(),
    step: integer("step").notNull().default(0),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    subjectVariants: jsonb("subject_variants").$type<string[]>().notNull().default([]),
    variant: text("variant"),
    tone: text("tone").notNull().default("casual"),
    templateKey: text("template_key").notNull().default("ai"),
    status: text("status").$type<"draft" | "pending_approval" | "scheduled" | "sent" | "bounced" | "failed" | "cancelled">().notNull().default("draft"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    providerMessageId: text("provider_message_id"),
    providerThreadId: text("provider_thread_id"),
    rfcMessageId: text("rfc_message_id"),
    trackingId: text("tracking_id").notNull().unique(),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    openCount: integer("open_count").notNull().default(0),
    clickedAt: timestamp("clicked_at", { withTimezone: true }),
    repliedAt: timestamp("replied_at", { withTimezone: true }),
    spamScore: integer("spam_score").notNull().default(0),
    spamHits: jsonb("spam_hits").$type<string[]>().notNull().default([]),
    attachResume: boolean("attach_resume").notNull().default(false),
    error: text("error"),
    createdAt: createdAt(),
  },
  (t) => [
    index("messages_due_idx").on(t.status, t.scheduledAt),
    index("messages_user_idx").on(t.userId, t.createdAt),
    index("messages_thread_idx").on(t.providerThreadId),
  ],
);

export const replies = pgTable(
  "replies",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    messageId: uuid("message_id").references(() => messages.id, { onDelete: "set null" }),
    applicationId: uuid("application_id").references(() => applications.id, { onDelete: "cascade" }),
    fromEmail: text("from_email").notNull(),
    subject: text("subject").notNull().default(""),
    body: text("body").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    category: text("category").notNull().default("other"),
    confidence: real("confidence").notNull().default(0),
    suggestedReply: text("suggested_reply"),
    providerMessageId: text("provider_message_id"),
    handled: boolean("handled").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("replies_provider_idx").on(t.providerMessageId)],
);

// ---------- Other generated content ----------
export const outreachDrafts = pgTable("outreach_drafts", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  applicationId: uuid("application_id").references(() => applications.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
  kind: text("kind").$type<"linkedin_note" | "linkedin_dm" | "cover_letter">().notNull(),
  content: text("content").notNull(),
  createdAt: createdAt(),
});

export const prepPacks = pgTable("prep_packs", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  applicationId: uuid("application_id").notNull().references(() => applications.id, { onDelete: "cascade" }),
  content: jsonb("content").$type<PrepPackContent>().notNull(),
  createdAt: createdAt(),
});

export interface PrepPackContent {
  companyBrief: string;
  likelyQuestions: { question: string; why: string; category: "technical" | "behavioral" | "company" }[];
  yourStories: { prompt: string; story: string; project?: string }[];
  questionsToAsk: string[];
  negotiation: string[];
  checklist: string[];
}

export const notifications = pgTable("notifications", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  link: text("link"),
  read: boolean("read").notNull().default(false),
  channels: text("channels").array().notNull().default(sql`'{}'::text[]`),
  createdAt: createdAt(),
});

export const suppressions = pgTable(
  "suppressions",
  {
    id: id(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    reason: text("reason").$type<"bounce" | "unsubscribe" | "complaint" | "manual">().notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("suppressions_email_idx").on(t.email, t.userId)],
);

export const deliverabilityChecks = pgTable("deliverability_checks", {
  id: id(),
  emailAccountId: uuid("email_account_id").notNull().references(() => emailAccounts.id, { onDelete: "cascade" }),
  domain: text("domain").notNull(),
  result: jsonb("result").$type<Record<string, unknown>>().notNull(),
  score: integer("score").notNull(),
  createdAt: createdAt(),
});

export const placementTests = pgTable("placement_tests", {
  id: id(),
  emailAccountId: uuid("email_account_id").notNull().references(() => emailAccounts.id, { onDelete: "cascade" }),
  seedEmail: text("seed_email").notNull(),
  token: text("token").notNull(),
  result: text("result").$type<"pending" | "inbox" | "spam" | "missing">().notNull().default("pending"),
  createdAt: createdAt(),
  checkedAt: timestamp("checked_at", { withTimezone: true }),
});

export const usageCounters = pgTable(
  "usage_counters",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    period: text("period").notNull(), // YYYY-MM-DD or YYYY-MM
    metric: text("metric").notNull(), // sends | ai_drafts | verifications
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.period, t.metric] })],
);

export const oauthStates = pgTable("oauth_states", {
  state: text("state").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  createdAt: createdAt(),
});
