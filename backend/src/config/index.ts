import "dotenv/config";
import { z } from "zod";

/** "true"/"1"/"yes" → true, "false"/"0"/"no"/"" → false (z.coerce.boolean treats "false" as true). */
const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === "" ? def : ["true", "1", "yes", "on"].includes(v.trim().toLowerCase())));

const DEFAULT_JWT = "dev-secret-change-me-please-32chars";
const DEFAULT_ENC = "dev-encryption-key-change-me-32bytes!";

const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().default("postgres://postgres:postgres@localhost:5432/jobpilot"),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  JWT_SECRET: z.string().min(16).default(DEFAULT_JWT),
  ENCRYPTION_KEY: z.string().min(16).default(DEFAULT_ENC),
  APP_URL: z.string().default("http://localhost:3000"),
  API_URL: z.string().default("http://localhost:3001"),

  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-opus-5-5"),
  AI_DISABLED: bool(false),

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_PUBSUB_TOPIC: z.string().optional(), // projects/<id>/topics/<name>
  GOOGLE_PUBSUB_VERIFICATION_TOKEN: z.string().optional(),
  MICROSOFT_CLIENT_ID: z.string().optional(),
  MICROSOFT_CLIENT_SECRET: z.string().optional(),
  MICROSOFT_TENANT: z.string().default("common"),
  OUTLOOK_WEBHOOK_CLIENT_STATE: z.string().default("jobpilot-outlook"),

  GITHUB_TOKEN: z.string().optional(),
  X_BEARER_TOKEN: z.string().optional(),
  APOLLO_API_KEY: z.string().optional(),
  HUNTER_API_KEY: z.string().optional(),

  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default("mailto:admin@example.com"),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_WHATSAPP_FROM: z.string().optional(), // e.g. whatsapp:+14155238886

  CAL_COM_LINK: z.string().optional(),
  SMTP_VERIFY_FROM: z.string().default("verify@example.com"),
  SMTP_VERIFY_ENABLED: bool(true),
  DISCOVERY_COMPANIES: z.string().optional(), // comma list like greenhouse:stripe,lever:netflix
  OFFLINE: bool(false), // skip all outbound network calls (tests)
  RUN_SCHEDULER_INLINE: bool(false), // run ticks in the API process when no worker
});

export const config = Env.parse(process.env);

if (config.NODE_ENV === "production" && (config.JWT_SECRET === DEFAULT_JWT || config.ENCRYPTION_KEY === DEFAULT_ENC)) {
  throw new Error("Set JWT_SECRET and ENCRYPTION_KEY to your own random values before running in production");
}
export type Config = typeof config;

export const aiEnabled = () => Boolean(config.ANTHROPIC_API_KEY) && !config.AI_DISABLED && !config.OFFLINE;
