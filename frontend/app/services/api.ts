/**
 * services/api.ts
 *
 * All backend calls go through here. The browser calls /backend/* on this site and Next.js
 * proxies it to the Express API (see next.config.ts), so the session cookie is first-party.
 */

/** Same-origin path that next.config.ts proxies to the API. */
export const API_BASE = "/backend";

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

/** Calls the Node API through Next's /api rewrite (same origin, so the session cookie is sent). */
export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    ...rest,
    headers: { ...(json !== undefined ? { "content-type": "application/json" } : {}), ...(rest.headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const text = await res.text();
  const data = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined" && !location.pathname.startsWith("/auth")) {
      window.location.href = new URL(`/auth/signin?next=${encodeURIComponent(location.pathname)}`, window.location.origin).toString();
    }
    throw new ApiError(res.status, (data as { error?: string })?.error ?? res.statusText, (data as { details?: unknown })?.details);
  }
  return data as T;
}

export const post = <T = unknown>(path: string, json?: unknown) => api<T>(path, { method: "POST", json: json ?? {} });
export const put = <T = unknown>(path: string, json: unknown) => api<T>(path, { method: "PUT", json });
export const patch = <T = unknown>(path: string, json: unknown) => api<T>(path, { method: "PATCH", json });
export const del = <T = unknown>(path: string) => api<T>(path, { method: "DELETE" });

export function errorMessage(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}
