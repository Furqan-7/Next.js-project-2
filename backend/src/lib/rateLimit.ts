import type { NextFunction, Request, Response } from "express";
import { HttpError } from "./errors";

/**
 * Small in-memory fixed-window limiter (per process). Good enough for auth endpoints on a single
 * API instance; put a shared store (Redis) behind it if you run several API replicas.
 */
export function rateLimit(opts: { windowMs: number; max: number; key: (req: Request) => string }) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    if (hits.size > 10_000) for (const [k, v] of hits) if (v.resetAt < now) hits.delete(k);
    const k = opts.key(req);
    const e = hits.get(k);
    if (!e || e.resetAt < now) {
      hits.set(k, { count: 1, resetAt: now + opts.windowMs });
      return next();
    }
    e.count++;
    if (e.count > opts.max) {
      res.setHeader("retry-after", Math.ceil((e.resetAt - now) / 1000));
      return next(new HttpError(429, "Too many attempts. Try again in a few minutes."));
    }
    next();
  };
}
