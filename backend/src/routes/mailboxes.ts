import { effectiveDailyLimit, PLAN_LIMITS } from "shared";
import { and, desc, eq, sql } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { me, readSession, SESSION_COOKIE } from "../lib/auth";
import { config } from "../config";
import { db, schema } from "db";
import { encrypt, randomToken } from "../lib/crypto";
import { badRequest, forbidden, notFound } from "../lib/errors";
import { logger } from "../lib/logger";
import { checkPlacementTests, runDeliverabilityCheck, startPlacementTest } from "../services/deliverability";
import { exchangeGoogleCode, exchangeMicrosoftCode, gmailWatch, googleAuthUrl, microsoftAuthUrl, outlookSubscribe } from "../services/mail/providers";
import { recomputeHealth } from "../services/replies";
import { sentTodayCount } from "../services/sequencer";

export const mailboxesRouter = Router();

function safeAccount(a: typeof schema.emailAccounts.$inferSelect) {
  const { accessToken: _a, refreshToken: _r, ...rest } = a;
  return rest;
}

async function ensureMailboxQuota(user: { id: string; plan: "free" | "pro" | "college" }) {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.emailAccounts).where(eq(schema.emailAccounts.userId, user.id));
  if (n >= PLAN_LIMITS[user.plan].mailboxes) throw forbidden(`Your plan allows ${PLAN_LIMITS[user.plan].mailboxes} mailbox(es)`);
}

mailboxesRouter.get("/", async (req, res) => {
  const user = me(req);
  const rows = await db.select().from(schema.emailAccounts).where(eq(schema.emailAccounts.userId, user.id)).orderBy(desc(schema.emailAccounts.createdAt));
  const items = [];
  for (const a of rows) {
    // Same limit the sender enforces: plan × mailbox × warm-up ramp × health
    const todayLimit = effectiveDailyLimit({ planLimit: PLAN_LIMITS[user.plan].dailySends, accountLimit: a.dailyLimit, warmupEnabled: a.warmupEnabled, warmupStartedAt: a.warmupStartedAt, healthScore: a.healthScore });
    const warmupDay = a.warmupEnabled && a.warmupStartedAt ? Math.floor((Date.now() - a.warmupStartedAt.getTime()) / 86400000) + 1 : null;
    items.push({ ...safeAccount(a), sentToday: await sentTodayCount(a.id), todayLimit, warmupDay });
  }
  res.json({ items, oauth: { google: Boolean(config.GOOGLE_CLIENT_ID), microsoft: Boolean(config.MICROSOFT_CLIENT_ID) } });
});

/** Start OAuth: the user's own Gmail/Outlook sends the email, never a shared server. */
mailboxesRouter.post("/oauth/:provider/start", async (req, res) => {
  const user = me(req);
  const provider = z.enum(["google", "microsoft"]).parse(req.params.provider);
  if (provider === "google" && !config.GOOGLE_CLIENT_ID) throw badRequest("Google OAuth isn't configured (set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)");
  if (provider === "microsoft" && !config.MICROSOFT_CLIENT_ID) throw badRequest("Microsoft OAuth isn't configured (set MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET)");
  await ensureMailboxQuota(user);
  const state = randomToken(24);
  await db.insert(schema.oauthStates).values({ state, userId: user.id, provider });
  res.json({ url: provider === "google" ? googleAuthUrl(state) : microsoftAuthUrl(state) });
});

/** Local development mailbox: captures emails instead of delivering them. */
mailboxesRouter.post("/dev", async (req, res) => {
  const user = me(req);
  if (config.NODE_ENV === "production") throw forbidden("Dev mailboxes are disabled in production");
  await ensureMailboxQuota(user);
  const { email } = z.object({ email: z.string().email().optional() }).parse(req.body ?? {});
  const [a] = await db.insert(schema.emailAccounts).values({ userId: user.id, provider: "dev", email: email ?? user.email, warmupEnabled: false, dailyLimit: 50 }).returning();
  res.status(201).json({ account: safeAccount(a) });
});

async function ownAccount(userId: string, id: string) {
  const [a] = await db.select().from(schema.emailAccounts).where(and(eq(schema.emailAccounts.id, id), eq(schema.emailAccounts.userId, userId)));
  if (!a) throw notFound("Mailbox not found");
  return a;
}

mailboxesRouter.patch("/:id", async (req, res) => {
  const body = z.object({ dailyLimit: z.number().int().min(1).max(500).optional(), warmupEnabled: z.boolean().optional(), status: z.enum(["active", "paused"]).optional() }).parse(req.body);
  const a = await ownAccount(me(req).id, req.params.id);
  const [u] = await db
    .update(schema.emailAccounts)
    .set({ ...body, ...(body.warmupEnabled && !a.warmupEnabled ? { warmupStartedAt: new Date() } : {}) })
    .where(eq(schema.emailAccounts.id, a.id))
    .returning();
  res.json({ account: safeAccount(u) });
});

mailboxesRouter.delete("/:id", async (req, res) => {
  const a = await ownAccount(me(req).id, req.params.id);
  await db.delete(schema.emailAccounts).where(eq(schema.emailAccounts.id, a.id));
  res.json({ ok: true });
});

mailboxesRouter.post("/:id/check", async (req, res) => {
  const a = await ownAccount(me(req).id, req.params.id);
  res.json(await runDeliverabilityCheck(a));
});

mailboxesRouter.get("/:id/health", async (req, res) => {
  const a = await ownAccount(me(req).id, req.params.id);
  const [last] = await db.select().from(schema.deliverabilityChecks).where(eq(schema.deliverabilityChecks.emailAccountId, a.id)).orderBy(desc(schema.deliverabilityChecks.createdAt)).limit(1);
  const tests = await db.select().from(schema.placementTests).where(eq(schema.placementTests.emailAccountId, a.id)).orderBy(desc(schema.placementTests.createdAt)).limit(20);
  const suppressions = await db.select().from(schema.suppressions).where(eq(schema.suppressions.userId, a.userId)).orderBy(desc(schema.suppressions.createdAt)).limit(100);
  res.json({ health: await recomputeHealth(a.id), lastCheck: last ?? null, placementTests: tests, suppressions });
});

mailboxesRouter.post("/:id/placement-test", async (req, res) => {
  const user = me(req);
  const a = await ownAccount(user.id, req.params.id);
  const { seedAccountId, seedEmail } = z.object({ seedAccountId: z.string().uuid().optional(), seedEmail: z.string().email().optional() }).parse(req.body ?? {});
  const seed = seedAccountId ? await ownAccount(user.id, seedAccountId) : null;
  const to = seed?.email ?? seedEmail;
  if (!to) throw badRequest("Pick one of your other connected mailboxes (or an address you own) as the seed inbox");
  res.status(201).json({ test: await startPlacementTest(a, to) });
});

mailboxesRouter.post("/:id/placement-check", async (req, res) => {
  const user = me(req);
  const a = await ownAccount(user.id, req.params.id);
  const { seedAccountId } = z.object({ seedAccountId: z.string().uuid().optional() }).parse(req.body ?? {});
  const seed = seedAccountId ? await ownAccount(user.id, seedAccountId) : null;
  res.json({ results: await checkPlacementTests(a, seed) });
});

/** Suppression list management (bounces are added automatically). */
mailboxesRouter.post("/suppressions", async (req, res) => {
  const { email } = z.object({ email: z.string().email() }).parse(req.body);
  await db.insert(schema.suppressions).values({ userId: me(req).id, email: email.toLowerCase(), reason: "manual" }).onConflictDoNothing();
  res.status(201).json({ ok: true });
});

// ---------------------------------------------------------------- OAuth callbacks (no auth header: browser redirect)
export async function oauthCallback(req: Request, res: Response) {
  const provider = req.params.provider as "google" | "microsoft";
  const { code, state, error } = req.query as Record<string, string | undefined>;
  const back = (q: string) => res.redirect(`${config.APP_URL}/settings?${q}`);
  if (error || !code || !state) return back(`mailbox_error=${encodeURIComponent(error ?? "missing code")}`);
  const [st] = await db.select().from(schema.oauthStates).where(eq(schema.oauthStates.state, state));
  if (!st || st.provider !== provider || Date.now() - st.createdAt.getTime() > 15 * 60000) return back("mailbox_error=expired");
  // The cookie must belong to the same user who started the flow
  const cookieUser = req.cookies?.[SESSION_COOKIE] ? await readSession(req.cookies[SESSION_COOKIE]) : null;
  if (cookieUser && cookieUser !== st.userId) return back("mailbox_error=wrong_user");
  await db.delete(schema.oauthStates).where(eq(schema.oauthStates.state, state));
  try {
    const r = provider === "google" ? await exchangeGoogleCode(code) : await exchangeMicrosoftCode(code);
    const [existing] = await db.select().from(schema.emailAccounts).where(and(eq(schema.emailAccounts.userId, st.userId), eq(schema.emailAccounts.email, r.email)));
    const values = {
      accessToken: encrypt(r.tokens.access_token),
      refreshToken: r.tokens.refresh_token ? encrypt(r.tokens.refresh_token) : existing?.refreshToken ?? null,
      tokenExpiresAt: new Date(Date.now() + r.tokens.expires_in * 1000),
      status: "active" as const,
      lastError: null,
    };
    const [account] = existing
      ? await db.update(schema.emailAccounts).set(values).where(eq(schema.emailAccounts.id, existing.id)).returning()
      : await db.insert(schema.emailAccounts).values({ ...values, userId: st.userId, provider: provider === "google" ? "gmail" : "outlook", email: r.email, syncCursor: (r as { historyId?: string }).historyId ?? null }).returning();
    try {
      if (account.provider === "gmail") await gmailWatch(account);
      else await outlookSubscribe(account);
    } catch (e) {
      logger.warn("reply tracking subscription failed", { error: String(e) });
    }
    await runDeliverabilityCheck(account).catch(() => undefined);
    return back("mailbox=connected");
  } catch (e) {
    logger.error("oauth callback failed", { error: String(e) });
    return back("mailbox_error=exchange_failed");
  }
}
