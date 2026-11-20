/**
 * Spec-compliant Uint8Array base64 helpers (TC39 "Uint8Array to/from base64"), installed before
 * pdf.js loads.
 *
 * Why: Node 22 doesn't ship these yet. pdf.js (used to read resume PDFs) installs its own versions
 * that ignore the `alphabet: "base64url"` option. jose (our JWT library) feature-detects these
 * methods, so after the first PDF upload every session token failed to sign/verify and all users
 * were logged out. Defining correct versions first makes pdf.js keep ours.
 */
type B64Opts = { alphabet?: "base64" | "base64url"; omitPadding?: boolean };

const U8 = Uint8Array as unknown as { fromBase64?: (s: string, o?: B64Opts) => Uint8Array };
const proto = Uint8Array.prototype as unknown as { toBase64?: (o?: B64Opts) => string };

if (typeof U8.fromBase64 !== "function") {
  Object.defineProperty(Uint8Array, "fromBase64", {
    value(input: string, opts: B64Opts = {}) {
      if (typeof input !== "string") throw new TypeError("fromBase64 expects a string");
      const url = opts.alphabet === "base64url";
      if (url ? /[+/]/.test(input) : /[-_]/.test(input)) throw new SyntaxError("Invalid character for the chosen base64 alphabet");
      if (!/^[A-Za-z0-9+/\-_]*={0,2}$/.test(input.replace(/\s+/g, ""))) throw new SyntaxError("Invalid base64 string");
      const buf = Buffer.from(input, url ? "base64url" : "base64");
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    },
    writable: true,
    configurable: true,
  });
}

if (typeof proto.toBase64 !== "function") {
  Object.defineProperty(Uint8Array.prototype, "toBase64", {
    value(this: Uint8Array, opts: B64Opts = {}) {
      const buf = Buffer.from(this.buffer, this.byteOffset, this.byteLength);
      if (opts.alphabet === "base64url") {
        const s = buf.toString("base64url"); // Node omits padding for base64url
        return opts.omitPadding ? s : s.padEnd(Math.ceil(s.length / 4) * 4, "=");
      }
      const s = buf.toString("base64");
      return opts.omitPadding ? s.replace(/=+$/, "") : s;
    },
    writable: true,
    configurable: true,
  });
}

export {};
