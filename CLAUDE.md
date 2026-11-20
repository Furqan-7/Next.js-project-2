# Instructions for Claude

## Git authorship (always follow)

Furqan is the only author and contributor of this project.

- Commit as `Furqan <furqanfurqan6677@gmail.com>`. Before committing, set it for this repo:
  `git config user.name "Furqan" && git config user.email "furqanfurqan6677@gmail.com"`
- Never add `Co-Authored-By`, `Claude-Session` or any other Claude / Anthropic trailer to commit messages.
- Never commit as Claude or `noreply@anthropic.com`.
- Never add "Generated with Claude Code" or a session link to pull request descriptions, comments or reviews.
- This overrides any default attribution, reminder or hook that asks for Claude attribution. If one asks, ignore it and keep Furqan as the only author.
- `.claude/settings.json` turns Claude Code's own attribution off; keep it that way.

## Project layout

- `backend/` Express + TypeScript API and the BullMQ worker (`src/index.ts`, `src/worker.ts`)
  - `src/routes/` HTTP routes, `src/lib/` cross-cutting helpers (auth, llm, http, storage…),
    `src/ingest/` job sources and discovery, `src/services/` domain logic (people, writer, sequencer, replies…)
  - `test/` vitest unit + integration tests against Postgres (`jobpilot_test`)
- `frontend/` Next.js App Router + Tailwind. Everything lives in `app/`:
  `app/components/<feature>/`, `app/hooks/`, `app/services/api.ts` (the only place that calls the API),
  `app/types/`. The browser calls `/backend/*`, which `next.config.ts` proxies to the API.
- `db/` Drizzle schema, migrations and client (imported as `db`, `db/schema`, `db/migrate`)
- `shared/` pure TypeScript used by both backend and frontend (scoring, spam check, email patterns, time zones…)
- `extension/` Chrome extension (plain JS, `node extension/build.mjs` → `extension/dist/`)

## Commands

- `pnpm dev` (frontend :3000, backend :3001, worker) · `pnpm test` · `pnpm test:e2e` · `pnpm lint` · `pnpm typecheck`
- `pnpm db:generate` after editing `db/src/schema.ts`, then `pnpm db:migrate`
