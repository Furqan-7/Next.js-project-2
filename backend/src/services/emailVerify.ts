import { promises as dns } from "node:dns";
import net from "node:net";
import { config } from "../config";

export type VerifyStatus = "valid" | "invalid" | "risky" | "catch_all" | "unknown";

export interface VerifyResult {
  email: string;
  status: VerifyStatus;
  hasMx: boolean;
  mx?: string;
  smtpCode?: number;
  reason: string;
}

const DISPOSABLE = new Set(["mailinator.com", "guerrillamail.com", "10minutemail.com", "tempmail.com", "yopmail.com", "trashmail.com"]);
const ROLE_LOCALS = new Set(["info", "hello", "contact", "admin", "support", "jobs", "careers", "hr", "team", "sales", "office"]);
const FREE_PROVIDERS = new Set(["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com"]);

export function syntaxOk(email: string): boolean {
  return /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email) && !email.includes("..");
}

const mxCache = new Map<string, { exchange: string; priority: number }[]>();
export async function lookupMx(domain: string): Promise<{ exchange: string; priority: number }[]> {
  if (mxCache.has(domain)) return mxCache.get(domain)!;
  if (config.OFFLINE) return [];
  try {
    const mx = (await dns.resolveMx(domain)).sort((a, b) => a.priority - b.priority);
    mxCache.set(domain, mx);
    return mx;
  } catch {
    mxCache.set(domain, []);
    return [];
  }
}

/**
 * Minimal SMTP conversation: EHLO, MAIL FROM, RCPT TO, QUIT. Never sends DATA, so no email is delivered.
 * Many cloud hosts block outbound port 25; in that case we report "unknown" rather than guessing.
 */
export function smtpProbe(mxHost: string, rcpts: string[], timeoutMs = 10000): Promise<{ codes: number[]; error?: string }> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: mxHost, port: 25 });
    const codes: number[] = [];
    const steps = [`EHLO ${config.SMTP_VERIFY_FROM.split("@")[1] ?? "example.com"}`, `MAIL FROM:<${config.SMTP_VERIFY_FROM}>`, ...rcpts.map((r) => `RCPT TO:<${r}>`), "QUIT"];
    let step = -1;
    let buffer = "";
    const done = (error?: string) => {
      socket.destroy();
      resolve({ codes, error });
    };
    socket.setTimeout(timeoutMs, () => done("timeout"));
    socket.on("error", (e) => done(e.message));
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      // wait for a complete reply (last line has "NNN " not "NNN-")
      const lines = buffer.split("\r\n").filter(Boolean);
      const last = lines[lines.length - 1];
      if (!last || !/^\d{3} /.test(last)) return;
      buffer = "";
      const code = Number(last.slice(0, 3));
      if (step >= 2) codes.push(code); // RCPT responses (and QUIT)
      if (code >= 400 && step < 2) return done(`smtp ${code}`);
      step++;
      if (step < steps.length) socket.write(`${steps[step]}\r\n`);
      else done();
    });
  });
}

function randomLocal() {
  return `zz-noexist-${Math.random().toString(36).slice(2, 10)}`;
}

export async function verifyEmail(email: string, opts: { smtp?: boolean } = {}): Promise<VerifyResult> {
  const lower = email.toLowerCase().trim();
  if (!syntaxOk(lower)) return { email: lower, status: "invalid", hasMx: false, reason: "Bad syntax" };
  const [local, domain] = lower.split("@");
  if (DISPOSABLE.has(domain)) return { email: lower, status: "invalid", hasMx: false, reason: "Disposable domain" };
  const mx = await lookupMx(domain);
  if (!mx.length) return { email: lower, status: config.OFFLINE ? "unknown" : "invalid", hasMx: false, reason: config.OFFLINE ? "Offline: MX not checked" : "Domain has no MX records" };
  const roleBased = ROLE_LOCALS.has(local);
  if (opts.smtp === false || !config.SMTP_VERIFY_ENABLED || FREE_PROVIDERS.has(domain)) {
    return { email: lower, status: roleBased ? "risky" : "unknown", hasMx: true, mx: mx[0].exchange, reason: FREE_PROVIDERS.has(domain) ? "Free provider; mailbox checks are blocked" : "MX ok; SMTP check skipped" };
  }
  // Probe the real address and a random one to detect catch-all domains.
  const probe = await smtpProbe(mx[0].exchange, [lower, `${randomLocal()}@${domain}`]);
  if (probe.error || probe.codes.length < 2) {
    return { email: lower, status: roleBased ? "risky" : "unknown", hasMx: true, mx: mx[0].exchange, reason: `SMTP check unavailable (${probe.error ?? "no response"})` };
  }
  const [real, fake] = probe.codes;
  if (real >= 500) return { email: lower, status: "invalid", hasMx: true, mx: mx[0].exchange, smtpCode: real, reason: "Mailbox rejected" };
  if (real >= 200 && real < 300 && fake >= 200 && fake < 300) return { email: lower, status: "catch_all", hasMx: true, mx: mx[0].exchange, smtpCode: real, reason: "Domain accepts all addresses" };
  if (real >= 200 && real < 300) return { email: lower, status: roleBased ? "risky" : "valid", hasMx: true, mx: mx[0].exchange, smtpCode: real, reason: roleBased ? "Role address (shared inbox)" : "Mailbox exists" };
  return { email: lower, status: "risky", hasMx: true, mx: mx[0].exchange, smtpCode: real, reason: `Temporary response ${real}` };
}
