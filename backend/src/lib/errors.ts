import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { logger } from "./logger";

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

export const notFound = (what = "Not found") => new HttpError(404, what);
export const badRequest = (msg: string, details?: unknown) => new HttpError(400, msg, details);
export const forbidden = (msg = "Forbidden") => new HttpError(403, msg);
export const paymentRequired = (msg: string) => new HttpError(402, msg);

/** Wrap async handlers so thrown errors reach the error middleware (Express 5 does this too). */
export const ah =
  <T extends (req: Request, res: Response, next: NextFunction) => Promise<unknown>>(fn: T) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res, next).catch(next);

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: "Invalid input", details: err.issues });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  logger.error("unhandled error", { error: err instanceof Error ? err.stack : String(err) });
  return res.status(500).json({ error: "Internal server error" });
}
