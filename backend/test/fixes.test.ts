import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { assertPublicUrl, isPrivateAddress } from "../src/lib/http";
import { errorHandler } from "../src/lib/errors";
import { rateLimit } from "../src/lib/rateLimit";
import { fillDays } from "../src/services/analytics";

describe("config booleans", () => {
  it('treats "false" as false (z.coerce.boolean would say true)', async () => {
    // Same parser as config.ts
    const bool = (def: boolean) => z.string().optional().transform((v) => (v === undefined || v.trim() === "" ? def : ["true", "1", "yes", "on"].includes(v.trim().toLowerCase())));
    expect(bool(true).parse("false")).toBe(false);
    expect(bool(false).parse("TRUE")).toBe(true);
    expect(bool(true).parse(undefined)).toBe(true);
    expect(bool(false).parse("")).toBe(false);
    const { config } = await import("../src/config");
    expect(config.OFFLINE).toBe(true); // vitest sets OFFLINE=true
    expect(config.RUN_SCHEDULER_INLINE).toBe(false);
  });
});

describe("SSRF protection", () => {
  it("recognises internal addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "0.0.0.0"]) expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ["8.8.8.8", "140.82.112.3", "2606:4700::1111"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });
  it("blocks internal URLs and odd protocols without any network", async () => {
    await expect(assertPublicUrl("http://localhost:3001/api")).rejects.toThrow(/Blocked/);
    await expect(assertPublicUrl("http://169.254.169.254/latest/meta-data")).rejects.toThrow(/Blocked/);
    await expect(assertPublicUrl("http://[::1]/")).rejects.toThrow(/Blocked/);
    await expect(assertPublicUrl("file:///etc/passwd")).rejects.toThrow(/Blocked protocol/);
    await expect(assertPublicUrl("http://metadata.google.internal/")).rejects.toThrow(/Blocked/);
    await expect(assertPublicUrl("https://1.1.1.1/")).resolves.toBeInstanceOf(URL);
  });
});

describe("rate limiting", () => {
  it("returns 429 after the limit", async () => {
    const app = express();
    app.post("/x", rateLimit({ windowMs: 60_000, max: 2, key: () => "k" }), (_req, res) => res.json({ ok: true }));
    app.use(errorHandler);
    await request(app).post("/x").expect(200);
    await request(app).post("/x").expect(200);
    const r = await request(app).post("/x");
    expect(r.status).toBe(429);
    expect(r.headers["retry-after"]).toBeTruthy();
  });
});

describe("analytics timeline", () => {
  it("fills missing days with zeros up to today", () => {
    const d0 = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
    const d2 = new Date(Date.now() - 1 * 86400000).toISOString().slice(0, 10);
    const out = fillDays(new Map([[d0, { date: d0, sent: 3, replies: 1 }], [d2, { date: d2, sent: 2, replies: 0 }]]));
    expect(out).toHaveLength(4);
    expect(out[1]).toMatchObject({ sent: 0, replies: 0 });
    expect(out[0].sent).toBe(3);
    expect(fillDays(new Map())).toEqual([]);
  });
});

describe("base64 polyfills vs pdf.js", () => {
  it("JWT sessions still work after a PDF has been parsed", async () => {
    const { signSession, readSession } = await import("../src/lib/auth");
    const { pdfToText } = await import("../src/services/resume");
    const { makePdf } = await import("./pdf");
    expect(await pdfToText(makePdf(["Hello PDF"]))).toContain("Hello PDF");
    // pdf.js is loaded now; base64url must still round-trip
    const bytes = new Uint8Array([251, 255, 254, 62, 63]);
    const enc = (bytes as unknown as { toBase64: (o: object) => string }).toBase64({ alphabet: "base64url", omitPadding: true });
    expect(enc).toBe("-__-Pj8");
    expect([...(Uint8Array as unknown as { fromBase64: (s: string, o: object) => Uint8Array }).fromBase64(enc, { alphabet: "base64url" })]).toEqual([...bytes]);
    const token = await signSession("00000000-0000-0000-0000-000000000001");
    expect(await readSession(token)).toBe("00000000-0000-0000-0000-000000000001");
  });
});
