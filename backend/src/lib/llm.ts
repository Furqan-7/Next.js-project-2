import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { aiEnabled, config } from "../config";
import { logger } from "./logger";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  client ??= new Anthropic({ apiKey: config.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 120_000 });
  return client;
}

export type Effort = "low" | "medium" | "high";

export interface StructuredRequest<S extends z.ZodType> {
  /** Name used in logs. */
  task: string;
  schema: S;
  system: string;
  /** Plain text prompt, or full content blocks (e.g. a PDF document + instructions). */
  prompt: string | Anthropic.Beta.BetaContentBlockParam[];
  effort?: Effort;
  maxTokens?: number;
  /** Deterministic fallback used when AI is disabled, refused, or errors. */
  fallback: () => z.infer<S> | Promise<z.infer<S>>;
}

export interface StructuredResult<T> {
  data: T;
  source: "ai" | "fallback";
}

/**
 * Ask Claude for JSON matching `schema`. Always returns something: if the API key is missing,
 * the request fails, or the model declines, the caller's deterministic fallback is used, so every
 * feature keeps working offline (and in tests).
 */
export async function aiStructured<S extends z.ZodType>(req: StructuredRequest<S>): Promise<StructuredResult<z.infer<S>>> {
  if (!aiEnabled()) return { data: await req.fallback(), source: "fallback" };
  try {
    const response = await getClient().beta.messages.parse({
      model: config.ANTHROPIC_MODEL,
      max_tokens: req.maxTokens ?? 16000,
      system: req.system,
      messages: [{ role: "user", content: req.prompt }],
      output_config: { effort: req.effort ?? "low", format: betaZodOutputFormat(req.schema) },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    if (response.stop_reason === "refusal") {
      logger.warn(`ai:${req.task} refused`, { category: response.stop_details?.category });
      return { data: await req.fallback(), source: "fallback" };
    }
    if (response.stop_reason === "max_tokens" || response.parsed_output == null) {
      logger.warn(`ai:${req.task} returned no parseable output`, { stop: response.stop_reason });
      return { data: await req.fallback(), source: "fallback" };
    }
    return { data: response.parsed_output as z.infer<S>, source: "ai" };
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) logger.warn(`ai:${req.task} rate limited`);
    else if (err instanceof Anthropic.AuthenticationError) logger.error("ai: invalid ANTHROPIC_API_KEY");
    else if (err instanceof Anthropic.APIError) logger.warn(`ai:${req.task} API error ${err.status}`, { message: err.message });
    else logger.warn(`ai:${req.task} failed`, { error: String(err) });
    return { data: await req.fallback(), source: "fallback" };
  }
}

/** Base64 PDF document block for resume parsing. */
export function pdfBlock(data: Buffer): Anthropic.Beta.BetaContentBlockParam {
  return { type: "document", source: { type: "base64", media_type: "application/pdf", data: data.toString("base64") } };
}
