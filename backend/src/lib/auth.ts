import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";
import { jwtVerify, SignJWT } from "jose";
import { config } from "../config";
import { db, schema } from "db";
import { HttpError } from "./errors";

const secret = new TextEncoder().encode(config.JWT_SECRET);
export const SESSION_COOKIE = "jp_session";

export type SessionUser = typeof schema.users.$inferSelect;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

export const hashPassword = (pw: string) => bcrypt.hash(pw, 10);
export const verifyPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);

export async function signSession(userId: string): Promise<string> {
  return new SignJWT({ sub: userId }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("30d").sign(secret);
}

export async function readSession(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

export function setSessionCookie(res: Response, token: string) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.NODE_ENV === "production",
    maxAge: 30 * 86400 * 1000,
    path: "/",
  });
}

function tokenFrom(req: Request): string | null {
  const h = req.headers.authorization;
  if (h?.startsWith("Bearer ")) return h.slice(7);
  return (req.cookies?.[SESSION_COOKIE] as string | undefined) ?? null;
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const token = tokenFrom(req);
  const userId = token ? await readSession(token) : null;
  if (!userId) return next(new HttpError(401, "Not signed in"));
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!user) return next(new HttpError(401, "Not signed in"));
  req.user = user;
  next();
}

export function requireOrgAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.user?.orgId || req.user.orgRole !== "admin") return next(new HttpError(403, "Organization admins only"));
  next();
}

/** Narrow `req.user` for handlers mounted after requireAuth. */
export function me(req: Request): SessionUser {
  if (!req.user) throw new HttpError(401, "Not signed in");
  return req.user;
}
