import { randomBytes } from "node:crypto";

export interface OutgoingEmail {
  from: string;
  fromName?: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
  messageId?: string;
  inReplyTo?: string | null;
  references?: string[];
  headers?: Record<string, string>;
  attachments?: { filename: string; contentType: string; content: Buffer }[];
}

const encodeWord = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`);
const wrap76 = (b64: string) => b64.replace(/.{1,76}/g, "$&\r\n").trimEnd();

export function newMessageId(domain: string) {
  return `<${Date.now().toString(36)}.${randomBytes(8).toString("hex")}@${domain}>`;
}

export function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Plain text → simple HTML (links clickable, paragraphs kept), with an optional 1×1 open-tracking pixel. */
export function textToHtml(text: string, pixelUrl?: string) {
  const body = escapeHtml(text)
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 12px">${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
  const pixel = pixelUrl ? `<img src="${pixelUrl}" width="1" height="1" alt="" style="display:none">` : "";
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#111">${body}${pixel}</div>`;
}

/** Build an RFC 5322 message (multipart/alternative, optional attachments). */
export function buildMime(m: OutgoingEmail): string {
  const alt = `alt_${randomBytes(8).toString("hex")}`;
  const mixed = `mix_${randomBytes(8).toString("hex")}`;
  const headers: string[] = [
    `From: ${m.fromName ? `${encodeWord(m.fromName)} <${m.from}>` : m.from}`,
    `To: ${m.to}`,
    `Subject: ${encodeWord(m.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `MIME-Version: 1.0`,
  ];
  if (m.messageId) headers.push(`Message-ID: ${m.messageId}`);
  if (m.inReplyTo) headers.push(`In-Reply-To: ${m.inReplyTo}`);
  if (m.references?.length) headers.push(`References: ${m.references.join(" ")}`);
  for (const [k, v] of Object.entries(m.headers ?? {})) headers.push(`${k}: ${v}`);

  const altPart = [
    `--${alt}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    `Content-Transfer-Encoding: base64`,
    ``,
    wrap76(Buffer.from(m.text, "utf8").toString("base64")),
    `--${alt}`,
    `Content-Type: text/html; charset="UTF-8"`,
    `Content-Transfer-Encoding: base64`,
    ``,
    wrap76(Buffer.from(m.html ?? textToHtml(m.text), "utf8").toString("base64")),
    `--${alt}--`,
  ].join("\r\n");

  if (!m.attachments?.length) {
    return [...headers, `Content-Type: multipart/alternative; boundary="${alt}"`, ``, altPart, ``].join("\r\n");
  }
  const parts = [`--${mixed}`, `Content-Type: multipart/alternative; boundary="${alt}"`, ``, altPart];
  for (const a of m.attachments) {
    parts.push(
      `--${mixed}`,
      `Content-Type: ${a.contentType}; name="${a.filename}"`,
      `Content-Disposition: attachment; filename="${a.filename}"`,
      `Content-Transfer-Encoding: base64`,
      ``,
      wrap76(a.content.toString("base64")),
    );
  }
  parts.push(`--${mixed}--`);
  return [...headers, `Content-Type: multipart/mixed; boundary="${mixed}"`, ``, parts.join("\r\n"), ``].join("\r\n");
}

export const base64url = (s: string | Buffer) => Buffer.from(s).toString("base64url");
