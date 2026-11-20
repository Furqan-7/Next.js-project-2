# JobPilot: AI job-search automation

Upload a resume once. JobPilot finds jobs that fit, finds the founder / CTO / hiring manager, verifies their email, writes a personal cold email that ties your best project to their product, sends it from **your own** Gmail or Outlook at a good time in their time zone, follows up on day 3 / 7 / 14, sorts the replies, and tracks everything to the offer.

**Stack:** Node.js + TypeScript (Express 5, Drizzle ORM, PostgreSQL, BullMQ on Redis) for the API · Next.js 16 + TypeScript + Tailwind CSS 4 for the web app · Claude (Anthropic SDK) for AI · a Manifest V3 Chrome extension.

## Project structure

```
backend/                 Express + TypeScript API and background worker  (port 3001)
  src/index.ts           starts the API (applies migrations first)
  src/app.ts             Express app: middleware + routers
  src/worker.ts          BullMQ worker: sending, discovery, reminders, digests, reports
  src/routes/            HTTP routes (auth, profile, jobs, companies, outreach, inbox, crm, mailboxes…)
  src/ingest/            job sources (Greenhouse, Lever, Ashby, Workable, HN, YC, X, RSS…) + discovery
  src/services/          domain logic: people finder, writer, sequencer, replies, deliverability…
  src/lib/               auth, llm (Claude), http (SSRF-safe fetch), storage, rate limit, logger…
  src/config/            environment variables
  test/                  vitest unit + integration tests (real Postgres)
  Dockerfile
frontend/                Next.js App Router + Tailwind  (port 3000)
  app/                   pages: (app)/dashboard, jobs, outreach, campaigns, inbox, tracker, analytics…
  app/(app)/AppShell.tsx signed-in layout (sidebar, notifications, pause switch)
  app/components/        by feature: landing/, auth/, jobs/, outreach/, inbox/, analytics/ + ui.tsx
  app/hooks/             useApi
  app/services/api.ts    the only place that calls the API (via the /backend proxy)
  app/types/             API response types
  e2e/                   Playwright tests (app + extension)
  Dockerfile
db/                      Drizzle schema, migrations and client  (import from "db", "db/schema")
shared/                  pure TypeScript used by both sides: scoring, dedupe, scam & spam checks,
                         email patterns, time zones, warm-up, reply classification, insights
extension/               Chrome extension (popup, options, extractor) → node extension/build.mjs
docker-compose.yml       Postgres + Redis + API + worker + web
```

The browser only talks to the Next.js app. Requests to `/backend/*` are proxied to the Express API (`BACKEND_URL`, default `http://localhost:3001`), so the session cookie stays first-party.

## Quick start

Requirements: Node 20+, pnpm, PostgreSQL 16, Redis 7 (or `docker compose up -d`).

```bash
pnpm install
cp backend/.env.example backend/.env       # defaults work for local dev
docker compose up -d db redis               # Postgres + Redis (skip if you run them yourself)
pnpm db:migrate
pnpm db:seed                                # demo account: demo@jobpilot.dev / demo12345
pnpm dev                                    # frontend :3000, backend :3001, worker
```

Open http://localhost:3000. Without any API keys, everything works using rule-based fallbacks, and the **dev mailbox** (Settings → "Add dev mailbox") captures emails instead of sending them, so you can try the full flow safely. Add `ANTHROPIC_API_KEY` to switch every AI feature to Claude.

Without Redis you can still run sending and reminders inside the API: `RUN_SCHEDULER_INLINE=true pnpm --filter backend dev`.

Everything in Docker instead: `docker compose up --build`, then open http://localhost:3000.

## Tests

```bash
pnpm test                                   # shared (27) + backend (67)
pnpm --filter backend test                  # needs Postgres; uses database jobpilot_test
pnpm test:e2e                               # 13 Playwright tests (10 against a running, seeded stack + 3 extension)
pnpm lint                                   # ESLint (next/core-web-vitals + typescript)
```

The API suite runs the real HTTP app against a real Postgres. It covers signup, resume parsing, discovery dedupe, scam filtering, match ranking, contact email guessing, drafting, approval, sending with tracking, opens, free-plan limits, autopilot campaigns, follow-up scheduling, random gaps, daily limits, one-click pause, reply classification, stopping sequences, bounces, suppression, the kanban board, prep packs, analytics, public profiles, extension capture, the college plan, unsubscribe and webhooks. Outbound network calls are switched off in tests (`OFFLINE=true`). Regression tests cover real PDF parsing, SSRF blocking, auth rate limits, one-click unsubscribe, resume attachments and follow-up timing.

## Feature map

| # | Feature | Where |
|---|---------|-------|
| 1 | Resume PDF → skills, projects, experience, education (Claude reads the PDF; text parser fallback) | `backend/src/services/resume.ts`, `shared/src/resumeParser.ts` |
| 1 | GitHub (repos, languages, topics), portfolio, LinkedIn link | `backend/src/services/enrich.ts` |
| 1 | Fresher/experienced, years, target roles, work mode, cities, stipend/CTC, company size, industries, employment type | onboarding: `frontend/app/onboarding`, `backend/src/routes/profile.ts` |
| 1 | Writing-style sample → style profile used by the writer | `enrich.ts` (`analyzeWritingStyle`), `writer.ts` |
| 2 | Greenhouse, Lever, Ashby, Workable, Remotive, RemoteOK, HN "Who's Hiring", YC hiring companies, X hiring posts | `backend/src/ingest/sources.ts` |
| 2 | Funding news (TechCrunch, Crunchbase News, Inc42 RSS) → "newly funded" flags | `sources.ts` (`parseFundingRss`), dashboard |
| 2 | Cross-platform dedupe, 0–100 match score with reasons, daily feed, scam detection | `shared/src/dedupe.ts`, `shared/src/scoring.ts`, `shared/src/scam.ts`, `backend/src/ingest/index.ts` |
| 3 | People finder: website team pages, GitHub org members, job posts, optional Apollo / Hunter | `backend/src/services/people.ts` |
| 3 | Email pattern detection (from commit emails / known addresses), candidates, MX + SMTP verification, confidence | `shared/src/emailPatterns.ts`, `backend/src/services/emailVerify.ts` |
| 3 | Recent posts (GitHub, blog RSS, X), company research card (product, stack, news, size) | `people.ts` (`fetchRecentPosts`), `research.ts` |
| 4 | Personalised emails, best-project matching, 3 tones, 3–5 subjects, A/B, spam checker, tailored resume link, LinkedIn notes/DMs, cover letters | `backend/src/services/writer.ts`, `shared/src/templates.ts`, `shared/src/spam.ts`, `/p/[slug]?for=<job>` |
| 5 | Gmail / Outlook OAuth sending, recipient-time-zone scheduling, day 3/7/14 follow-ups that stop on reply, daily limits, random gaps, approval vs autopilot, bulk campaigns, one-click pause | `backend/src/services/mail/providers.ts`, `backend/src/services/sequencer.ts`, `shared/src/timezone.ts`, `shared/src/sending.ts` |
| 6 | SPF / DKIM / DMARC checks + setup guides, warm-up ramp, bounce handling + suppression list, inbox placement tests, health score | `backend/src/services/deliverability.ts`, `replies.ts`, `frontend/app/(app)/deliverability` |
| 7 | Gmail Pub/Sub and Outlook Graph webhooks, reply classification, suggested replies, Cal.com / Google Calendar links, push + WhatsApp notifications | `backend/src/routes/inbox.ts`, `backend/src/services/replies.ts`, `notify.ts` |
| 8 | Kanban (Found → Emailed → Replied → Interview → Offer → Rejected), notes, reminders, timeline, manual applications | `backend/src/routes/crm.ts`, `frontend/app/(app)/tracker` |
| 9 | Interview prep pack (company brief, likely questions, STAR stories from your projects, questions to ask), stipend/salary negotiation tips | `backend/src/services/prep.ts` |
| 10 | Open / reply rates per template, subject, role, company size, contact role, tone, step; A/B significance; weekly report; AI suggestions | `backend/src/services/analytics.ts`, `shared/src/insights.ts`, `frontend/app/(app)/analytics` |
| 11 | Chrome extension, alumni referral finder, public profile page, Free / Pro limits, College plan with admin dashboard and invite codes | `extension/`, `people.ts` (`referralCandidates`), `/p/[slug]`, `shared/src/plans.ts`, `backend/src/routes/misc.ts` |

## What needs your own setup (honest limits)

- **Real sending** needs a Google Cloud OAuth client (Gmail API) and/or an Azure app registration (Microsoft Graph). Set redirect URIs to `$API_URL/api/oauth/google/callback` and `$API_URL/api/oauth/microsoft/callback`. Gmail apps that send email need Google's OAuth verification before public launch.
- **Gmail reply tracking** needs a Pub/Sub topic with `gmail-api-push@system.gserviceaccount.com` as publisher, plus a push subscription to `$API_URL/api/webhooks/gmail?token=<GOOGLE_PUBSUB_VERIFICATION_TOKEN>`. Outlook uses Graph change notifications (renewed by the worker), so `API_URL` must be publicly reachable over HTTPS.
- **LinkedIn and Wellfound** have no public APIs and forbid scraping, so JobPilot doesn't scrape them. Jobs and people from those sites come in through the Chrome extension (it reads the page you're looking at) or manual entry. LinkedIn messages are generated for you to copy and send yourself. **X** posts use the official API (`X_BEARER_TOKEN`). **YC** uses the community yc-oss "hiring companies" dataset; their actual roles come in through their ATS boards.
- **SMTP mailbox checks** need outbound port 25, which many cloud hosts block. When blocked, addresses show "unknown" with the pattern-based confidence instead of a false "valid".
- **Billing**: `POST /api/billing/plan` switches plans directly outside production. Wire Stripe Checkout + webhooks before charging money.
- **Mock interviews**: the prep pack produces the question list. Plugging in a mock-interview product (e.g. DevPrep) is left as an integration point.
- **WhatsApp** alerts use Twilio's WhatsApp API (sandbox or an approved sender).

## Sending safety defaults

Every email goes from the user's own mailbox, never a shared server. Other defaults:

- Plan caps: Free 15/day, Pro 80/day, College 60/day.
- Per-mailbox caps and a warm-up ramp: 5/day, growing about 20% a day.
- Automatic throttling when inbox health drops.
- Random 1.5–7 minute gaps between sends.
- Weekday sends around 10 AM in the recipient's time zone.
- Verified addresses only; bounced and unsubscribed recipients are suppressed.
- One person per company per campaign.
- `List-Unsubscribe` + one-click (RFC 8058) headers on every email. The link asks for confirmation, so corporate link scanners can't unsubscribe people by accident.
- Approval mode by default.

## Security notes

- Every server-side fetch of a user-supplied URL (portfolio, company site, careers page) is checked against private, loopback and link-local addresses on every redirect hop (SSRF protection).
- Login and signup are rate-limited (20 per 15 minutes per IP + email; in-memory, so use a shared store if you run several API replicas).
- OAuth tokens are encrypted at rest (AES-256-GCM). The API refuses to start in production with the default `JWT_SECRET` / `ENCRYPTION_KEY`.
- Companies and contacts are shared across accounts so research isn't repeated; only the person who added a contact can edit it.

## Useful scripts

| Command | What it does |
|---|---|
| `pnpm dev` | backend + worker + frontend with reload |
| `pnpm build` | Type-check shared and db, bundle the backend (`backend/dist`), build the frontend |
| `pnpm typecheck` · `pnpm lint` | TypeScript across all packages · ESLint on the frontend |
| `pnpm db:generate` | Generate a migration in `db/migrations` after editing `db/src/schema.ts` |
| `pnpm db:migrate` / `pnpm db:seed` | Apply migrations / load demo data |
| `node backend/dist/index.js` · `node backend/dist/worker.js` | Production API and worker |
| `pnpm build:extension` | Package the extension into `extension/dist/chromium` |

Load the extension: open `chrome://extensions`, enable Developer mode, click **Load unpacked**, and pick the `extension/` folder (or `extension/dist/chromium`). Set the app address in the extension's options if it isn't `http://localhost:3000`.
