import { eq, sql } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { hashPassword, me, requireAuth, SESSION_COOKIE, setSessionCookie, signSession, verifyPassword } from "../lib/auth";
import { db, schema } from "db";
import { badRequest, HttpError } from "../lib/errors";
import { rateLimit } from "../lib/rateLimit";

export const authRouter = Router();

const authLimit = rateLimit({
  windowMs: 15 * 60_000,
  max: process.env.NODE_ENV === "test" ? 1000 : 20,
  key: (req) => `${req.ip}|${String(req.body?.email ?? "").toLowerCase()}`,
});

const Signup = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email().max(200),
  password: z.string().min(8).max(200),
  inviteCode: z.string().optional(),
});

function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "me";
}

async function uniqueSlug(name: string) {
  const base = slugify(name);
  for (let i = 0; i < 50; i++) {
    const s = i ? `${base}-${i + 1}` : base;
    const [row] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.publicSlug, s));
    if (!row) return s;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export function publicUser(u: typeof schema.users.$inferSelect) {
  const { passwordHash: _ph, pushSubscriptions: _ps, ...rest } = u;
  return rest;
}

authRouter.post("/signup", authLimit, async (req, res) => {
  const body = Signup.parse(req.body);
  const email = body.email.toLowerCase();
  const [exists] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email));
  if (exists) throw badRequest("An account with this email already exists");
  let org: typeof schema.organizations.$inferSelect | undefined;
  if (body.inviteCode) {
    [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.inviteCode, body.inviteCode));
    if (!org) throw badRequest("Invalid invite code");
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.users).where(eq(schema.users.orgId, org.id));
    if (n >= org.seats) throw badRequest("This organization has no free seats");
  }
  const [user] = await db
    .insert(schema.users)
    .values({
      email,
      name: body.name,
      passwordHash: await hashPassword(body.password),
      publicSlug: await uniqueSlug(body.name),
      plan: org ? "college" : "free",
      orgId: org?.id ?? null,
      orgRole: org ? "member" : null,
    })
    .returning();
  await db.insert(schema.profiles).values({ userId: user.id, college: org?.name ?? null });
  const token = await signSession(user.id);
  setSessionCookie(res, token);
  res.status(201).json({ user: publicUser(user), token });
});

authRouter.post("/login", authLimit, async (req, res) => {
  const body = z.object({ email: z.string().email(), password: z.string() }).parse(req.body);
  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, body.email.toLowerCase()));
  if (!user || !(await verifyPassword(body.password, user.passwordHash))) throw new HttpError(401, "Wrong email or password");
  const token = await signSession(user.id);
  setSessionCookie(res, token);
  res.json({ user: publicUser(user), token });
});

authRouter.post("/logout", (_req, res) => {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.json({ ok: true });
});

authRouter.get("/me", requireAuth, async (req, res) => {
  const user = me(req);
  const [profile] = await db.select().from(schema.profiles).where(eq(schema.profiles.userId, user.id));
  const [org] = user.orgId ? await db.select().from(schema.organizations).where(eq(schema.organizations.id, user.orgId)) : [];
  res.json({ user: publicUser(user), profile, org: org ?? null });
});
