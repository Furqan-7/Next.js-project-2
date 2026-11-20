CREATE TABLE "application_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"job_id" uuid,
	"contact_id" uuid,
	"campaign_id" uuid,
	"stage" text DEFAULT 'found' NOT NULL,
	"source" text DEFAULT 'auto' NOT NULL,
	"role_title" text,
	"applied_via" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"mode" text DEFAULT 'approval' NOT NULL,
	"tone" text DEFAULT 'casual' NOT NULL,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sequence" jsonb NOT NULL,
	"send_window" jsonb NOT NULL,
	"ab_test" boolean DEFAULT false NOT NULL,
	"email_account_id" uuid,
	"include_resume" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"domain" text,
	"website" text,
	"description" text,
	"product" text,
	"tech_stack" text[] DEFAULT '{}'::text[] NOT NULL,
	"team_size" integer,
	"size" text,
	"industry" text,
	"location" text,
	"timezone" text,
	"funding_stage" text,
	"recent_news" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"email_pattern" text,
	"email_pattern_confidence" real DEFAULT 0 NOT NULL,
	"mx_ok" boolean,
	"catch_all" boolean,
	"ats_type" text,
	"ats_token" text,
	"researched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"title" text,
	"role" text DEFAULT 'other' NOT NULL,
	"email" text,
	"email_confidence" integer DEFAULT 0 NOT NULL,
	"email_status" text DEFAULT 'unknown' NOT NULL,
	"email_candidates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"verified_at" timestamp with time zone,
	"linkedin_url" text,
	"twitter_url" text,
	"github_url" text,
	"college" text,
	"timezone" text,
	"recent_posts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deliverability_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email_account_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"result" jsonb NOT NULL,
	"score" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"email" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"token_expires_at" timestamp with time zone,
	"daily_limit" integer DEFAULT 40 NOT NULL,
	"warmup_enabled" boolean DEFAULT true NOT NULL,
	"warmup_started_at" timestamp with time zone DEFAULT now(),
	"health_score" integer DEFAULT 100 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_error" text,
	"sync_cursor" text,
	"subscription_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "funding_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_name" text NOT NULL,
	"company_id" uuid,
	"amount" text,
	"round" text,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"announced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_matches" (
	"user_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"score" integer NOT NULL,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"matched_skills" text[] DEFAULT '{}'::text[] NOT NULL,
	"missing_skills" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_matches_user_id_job_id_pk" PRIMARY KEY("user_id","job_id")
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"external_id" text,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"company_name" text NOT NULL,
	"company_id" uuid,
	"location" text,
	"remote" boolean DEFAULT false NOT NULL,
	"work_mode" text,
	"employment_type" text,
	"description" text DEFAULT '' NOT NULL,
	"salary_min" double precision,
	"salary_max" double precision,
	"currency" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"posted_at" timestamp with time zone,
	"dedupe_key" text NOT NULL,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"scam_score" integer DEFAULT 0 NOT NULL,
	"scam_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_hiring_post" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"application_id" uuid,
	"campaign_id" uuid,
	"contact_id" uuid,
	"email_account_id" uuid,
	"to_email" text NOT NULL,
	"step" integer DEFAULT 0 NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"subject_variants" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"variant" text,
	"tone" text DEFAULT 'casual' NOT NULL,
	"template_key" text DEFAULT 'ai' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"provider_message_id" text,
	"provider_thread_id" text,
	"rfc_message_id" text,
	"tracking_id" text NOT NULL,
	"opened_at" timestamp with time zone,
	"open_count" integer DEFAULT 0 NOT NULL,
	"clicked_at" timestamp with time zone,
	"replied_at" timestamp with time zone,
	"spam_score" integer DEFAULT 0 NOT NULL,
	"spam_hits" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"attach_resume" boolean DEFAULT false NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_tracking_id_unique" UNIQUE("tracking_id")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"link" text,
	"read" boolean DEFAULT false NOT NULL,
	"channels" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_states" (
	"state" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'college' NOT NULL,
	"seats" integer DEFAULT 100 NOT NULL,
	"invite_code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_invite_code_unique" UNIQUE("invite_code")
);
--> statement-breakpoint
CREATE TABLE "outreach_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"application_id" uuid,
	"contact_id" uuid,
	"kind" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "placement_tests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email_account_id" uuid NOT NULL,
	"seed_email" text NOT NULL,
	"token" text NOT NULL,
	"result" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"checked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "prep_packs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"content" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"headline" text,
	"summary" text,
	"experience_level" text DEFAULT 'fresher' NOT NULL,
	"years_experience" real DEFAULT 0 NOT NULL,
	"target_roles" text[] DEFAULT '{}'::text[] NOT NULL,
	"skills" text[] DEFAULT '{}'::text[] NOT NULL,
	"projects" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"experience" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"education" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"links" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enrichment" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"preferences" jsonb DEFAULT '{"workModes":[],"cities":[],"companySizes":[],"industries":[],"employmentTypes":[]}'::jsonb NOT NULL,
	"writing_sample" text,
	"writing_style" jsonb,
	"resume_text" text,
	"resume_file_name" text,
	"resume_url" text,
	"college" text,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"public_visible" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"application_id" uuid,
	"text" text NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "replies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"message_id" uuid,
	"application_id" uuid,
	"from_email" text NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"body" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"confidence" real DEFAULT 0 NOT NULL,
	"suggested_reply" text,
	"provider_message_id" text,
	"handled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppressions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"email" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_counters" (
	"user_id" uuid NOT NULL,
	"period" text NOT NULL,
	"metric" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "usage_counters_user_id_period_metric_pk" PRIMARY KEY("user_id","period","metric")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text NOT NULL,
	"plan" text DEFAULT 'free' NOT NULL,
	"org_id" uuid,
	"org_role" text,
	"public_slug" text,
	"phone" text,
	"notification_prefs" jsonb DEFAULT '{"push":true,"whatsapp":false,"email":false}'::jsonb NOT NULL,
	"push_subscriptions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sending_paused" boolean DEFAULT false NOT NULL,
	"onboarded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_public_slug_unique" UNIQUE("public_slug")
);
--> statement-breakpoint
ALTER TABLE "application_events" ADD CONSTRAINT "application_events_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_email_account_id_email_accounts_id_fk" FOREIGN KEY ("email_account_id") REFERENCES "public"."email_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverability_checks" ADD CONSTRAINT "deliverability_checks_email_account_id_email_accounts_id_fk" FOREIGN KEY ("email_account_id") REFERENCES "public"."email_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_accounts" ADD CONSTRAINT "email_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funding_events" ADD CONSTRAINT "funding_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_matches" ADD CONSTRAINT "job_matches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_matches" ADD CONSTRAINT "job_matches_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_email_account_id_email_accounts_id_fk" FOREIGN KEY ("email_account_id") REFERENCES "public"."email_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_drafts" ADD CONSTRAINT "outreach_drafts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_drafts" ADD CONSTRAINT "outreach_drafts_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_drafts" ADD CONSTRAINT "outreach_drafts_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "placement_tests" ADD CONSTRAINT "placement_tests_email_account_id_email_accounts_id_fk" FOREIGN KEY ("email_account_id") REFERENCES "public"."email_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prep_packs" ADD CONSTRAINT "prep_packs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prep_packs" ADD CONSTRAINT "prep_packs_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replies" ADD CONSTRAINT "replies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replies" ADD CONSTRAINT "replies_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replies" ADD CONSTRAINT "replies_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppressions" ADD CONSTRAINT "suppressions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_counters" ADD CONSTRAINT "usage_counters_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "applications_user_idx" ON "applications" USING btree ("user_id","stage");--> statement-breakpoint
CREATE UNIQUE INDEX "companies_domain_idx" ON "companies" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "companies_name_idx" ON "companies" USING btree ("name");--> statement-breakpoint
CREATE INDEX "contacts_company_idx" ON "contacts" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_company_name_idx" ON "contacts" USING btree ("company_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "funding_url_idx" ON "funding_events" USING btree ("url");--> statement-breakpoint
CREATE INDEX "job_matches_score_idx" ON "job_matches" USING btree ("user_id","score");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_dedupe_idx" ON "jobs" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "jobs_created_idx" ON "jobs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "messages_due_idx" ON "messages" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE INDEX "messages_user_idx" ON "messages" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_thread_idx" ON "messages" USING btree ("provider_thread_id");--> statement-breakpoint
CREATE UNIQUE INDEX "replies_provider_idx" ON "replies" USING btree ("provider_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "suppressions_email_idx" ON "suppressions" USING btree ("email","user_id");