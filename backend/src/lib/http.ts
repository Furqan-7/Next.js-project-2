import { lookup } from "node:dns/promises";
import net from "node:net";
import { config } from "../config";

export class OfflineError extends Error {
  constructor(url: string) {
    super(`network disabled (OFFLINE=true): ${url}`);
  }
}

const UA = "JobPilotBot/0.1 (+job-search assistant; respects robots.txt)";

export class BlockedUrlError extends Error {}

/** True for loopback, private, link-local, CGNAT, multicast and other non-public addresses. */
export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith("::ffff:")) return isPrivateAddress(v6.slice(7));
  return v6 === "::1" || v6 === "::" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe8") || v6.startsWith("fe9") || v6.startsWith("fea") || v6.startsWith("feb") || v6.startsWith("ff");
}

/** Refuse non-http(s) URLs and hosts that resolve to internal addresses (SSRF protection). */
export async function assertPublicUrl(raw: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new BlockedUrlError(`Invalid URL: ${raw}`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new BlockedUrlError(`Blocked protocol: ${u.protocol}`);
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) throw new BlockedUrlError(`Blocked host: ${host}`);
  const addrs = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) throw new BlockedUrlError(`Blocked internal address for ${host}`);
  return u;
}

/**
 * fetch with timeout, a polite user agent, SSRF protection on every redirect hop, and an
 * OFFLINE kill-switch for tests.
 */
export async function httpFetch(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  if (config.OFFLINE) throw new OfflineError(url);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 15000);
  try {
    let current = url;
    for (let hop = 0; hop < 5; hop++) {
      await assertPublicUrl(current);
      const res = await fetch(current, {
        ...init,
        redirect: "manual",
        signal: ctrl.signal,
        headers: { "user-agent": UA, accept: "application/json, text/html;q=0.9, */*;q=0.8", ...(init.headers ?? {}) },
      });
      const location = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && location) {
        current = new URL(location, current).toString();
        continue;
      }
      return res;
    }
    throw new Error(`Too many redirects: ${url}`);
  } finally {
    clearTimeout(timer);
  }
}

export async function getJson<T = unknown>(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const res = await httpFetch(url, init);
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return (await res.json()) as T;
}

export async function getText(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<string> {
  const res = await httpFetch(url, init);
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return res.text();
}

export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

export function domainFromUrl(url?: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

/** Pause between requests to the same host. */
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
