import { eq } from "drizzle-orm";
import { config } from "../../config";
import { db, schema } from "db";
import { decrypt, encrypt } from "../../lib/crypto";
import { httpFetch } from "../../lib/http";
import { logger } from "../../lib/logger";
import { base64url, buildMime, type OutgoingEmail } from "./mime";

export type EmailAccount = typeof schema.emailAccounts.$inferSelect;

export interface SendResult {
  providerMessageId: string;
  threadId?: string;
}

export interface InboundMessage {
  providerMessageId: string;
  threadId?: string;
  from: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  receivedAt: Date;
  labels?: string[];
  isBounce: boolean;
}

export class ProviderError extends Error {
  constructor(message: string, public permanent = false) {
    super(message);
  }
}

// ---------------------------------------------------------------- OAuth
export const GOOGLE_SCOPES = ["https://www.googleapis.com/auth/gmail.send", "https://www.googleapis.com/auth/gmail.readonly", "openid", "email"];
export const MS_SCOPES = ["offline_access", "Mail.Send", "Mail.Read", "User.Read"];

export function googleAuthUrl(state: string) {
  const p = new URLSearchParams({
    client_id: config.GOOGLE_CLIENT_ID ?? "",
    redirect_uri: `${config.API_URL}/api/oauth/google/callback`,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    scope: GOOGLE_SCOPES.join(" "),
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

export function microsoftAuthUrl(state: string) {
  const p = new URLSearchParams({
    client_id: config.MICROSOFT_CLIENT_ID ?? "",
    redirect_uri: `${config.API_URL}/api/oauth/microsoft/callback`,
    response_type: "code",
    response_mode: "query",
    scope: MS_SCOPES.join(" "),
    state,
  });
  return `https://login.microsoftonline.com/${config.MICROSOFT_TENANT}/oauth2/v2.0/authorize?${p}`;
}

interface TokenResp { access_token: string; refresh_token?: string; expires_in: number; id_token?: string }

async function postForm(url: string, body: Record<string, string>): Promise<TokenResp> {
  const res = await httpFetch(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body) });
  const json = (await res.json()) as TokenResp & { error?: string; error_description?: string };
  if (!res.ok) throw new ProviderError(`OAuth token error: ${json.error_description ?? json.error ?? res.status}`, json.error === "invalid_grant");
  return json;
}

export async function exchangeGoogleCode(code: string) {
  const t = await postForm("https://oauth2.googleapis.com/token", {
    code,
    client_id: config.GOOGLE_CLIENT_ID ?? "",
    client_secret: config.GOOGLE_CLIENT_SECRET ?? "",
    redirect_uri: `${config.API_URL}/api/oauth/google/callback`,
    grant_type: "authorization_code",
  });
  const profile = (await (await httpFetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", { headers: { authorization: `Bearer ${t.access_token}` } })).json()) as { emailAddress: string; historyId: string };
  return { tokens: t, email: profile.emailAddress, historyId: profile.historyId };
}

export async function exchangeMicrosoftCode(code: string) {
  const t = await postForm(`https://login.microsoftonline.com/${config.MICROSOFT_TENANT}/oauth2/v2.0/token`, {
    code,
    client_id: config.MICROSOFT_CLIENT_ID ?? "",
    client_secret: config.MICROSOFT_CLIENT_SECRET ?? "",
    redirect_uri: `${config.API_URL}/api/oauth/microsoft/callback`,
    grant_type: "authorization_code",
    scope: MS_SCOPES.join(" "),
  });
  const me = (await (await httpFetch("https://graph.microsoft.com/v1.0/me", { headers: { authorization: `Bearer ${t.access_token}` } })).json()) as { mail?: string; userPrincipalName: string };
  return { tokens: t, email: me.mail ?? me.userPrincipalName };
}

/** Returns a valid access token, refreshing (and persisting) it when needed. */
export async function accessToken(account: EmailAccount): Promise<string> {
  if (account.provider === "dev") return "dev";
  if (account.accessToken && account.tokenExpiresAt && account.tokenExpiresAt.getTime() > Date.now() + 60_000) return decrypt(account.accessToken);
  if (!account.refreshToken) throw new ProviderError("Mailbox needs to be reconnected", true);
  const refresh = decrypt(account.refreshToken);
  const t =
    account.provider === "gmail"
      ? await postForm("https://oauth2.googleapis.com/token", { client_id: config.GOOGLE_CLIENT_ID ?? "", client_secret: config.GOOGLE_CLIENT_SECRET ?? "", refresh_token: refresh, grant_type: "refresh_token" })
      : await postForm(`https://login.microsoftonline.com/${config.MICROSOFT_TENANT}/oauth2/v2.0/token`, { client_id: config.MICROSOFT_CLIENT_ID ?? "", client_secret: config.MICROSOFT_CLIENT_SECRET ?? "", refresh_token: refresh, grant_type: "refresh_token", scope: MS_SCOPES.join(" ") });
  await db
    .update(schema.emailAccounts)
    .set({ accessToken: encrypt(t.access_token), refreshToken: t.refresh_token ? encrypt(t.refresh_token) : account.refreshToken, tokenExpiresAt: new Date(Date.now() + t.expires_in * 1000) })
    .where(eq(schema.emailAccounts.id, account.id));
  return t.access_token;
}

// ---------------------------------------------------------------- Dev provider (local + tests)
export const devOutbox: (OutgoingEmail & { accountId: string; providerMessageId: string; threadId: string })[] = [];

// ---------------------------------------------------------------- Send
export async function sendEmail(account: EmailAccount, email: OutgoingEmail, threadId?: string | null, replyToProviderMessageId?: string | null): Promise<SendResult> {
  if (account.provider === "dev") {
    const providerMessageId = `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const tid = threadId ?? `thread-${providerMessageId}`;
    devOutbox.push({ ...email, accountId: account.id, providerMessageId, threadId: tid });
    logger.info("dev mailbox: email captured (not delivered)", { to: email.to, subject: email.subject });
    return { providerMessageId, threadId: tid };
  }
  const token = await accessToken(account);
  if (account.provider === "gmail") {
    const res = await httpFetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ raw: base64url(buildMime(email)), ...(threadId ? { threadId } : {}) }),
    });
    const json = (await res.json()) as { id: string; threadId: string; error?: { message: string; code: number } };
    if (!res.ok) throw new ProviderError(`Gmail send failed: ${json.error?.message ?? res.status}`, res.status === 400 || res.status === 403);
    return { providerMessageId: json.id, threadId: json.threadId };
  }
  // Outlook follow-up: reply inside the original conversation so it threads for the recipient.
  if (replyToProviderMessageId) {
    const draftRes = await httpFetch(`https://graph.microsoft.com/v1.0/me/messages/${replyToProviderMessageId}/createReply`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: "{}",
    });
    const reply = (await draftRes.json()) as { id: string; conversationId: string };
    if (draftRes.ok) {
      const upd = await httpFetch(`https://graph.microsoft.com/v1.0/me/messages/${reply.id}`, {
        method: "PATCH",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ subject: email.subject, body: { contentType: "HTML", content: email.html ?? email.text } }),
      });
      if (upd.ok) {
        const sent = await httpFetch(`https://graph.microsoft.com/v1.0/me/messages/${reply.id}/send`, { method: "POST", headers: { authorization: `Bearer ${token}` } });
        if (!sent.ok) throw new ProviderError(`Outlook send failed: ${sent.status}`);
        return { providerMessageId: reply.id, threadId: reply.conversationId };
      }
    }
    // fall through to a fresh message if the original can't be replied to (e.g. deleted)
  }
  // Outlook / Microsoft Graph: create the message (so we learn its id + conversationId), then send it.
  const create = await httpFetch("https://graph.microsoft.com/v1.0/me/messages", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      subject: email.subject,
      body: { contentType: "HTML", content: email.html ?? email.text },
      toRecipients: [{ emailAddress: { address: email.to } }],
      internetMessageHeaders: Object.entries(email.headers ?? {})
        .filter(([k]) => k.toLowerCase().startsWith("x-"))
        .map(([name, value]) => ({ name, value })),
      ...(email.attachments?.length
        ? { attachments: email.attachments.map((a) => ({ "@odata.type": "#microsoft.graph.fileAttachment", name: a.filename, contentType: a.contentType, contentBytes: a.content.toString("base64") })) }
        : {}),
    }),
  });
  const draft = (await create.json()) as { id: string; conversationId: string; error?: { message: string } };
  if (!create.ok) throw new ProviderError(`Outlook draft failed: ${draft.error?.message ?? create.status}`);
  const send = await httpFetch(`https://graph.microsoft.com/v1.0/me/messages/${draft.id}/send`, { method: "POST", headers: { authorization: `Bearer ${token}` } });
  if (!send.ok) throw new ProviderError(`Outlook send failed: ${send.status}`);
  return { providerMessageId: draft.id, threadId: draft.conversationId };
}

// ---------------------------------------------------------------- Inbound (reply detection)
const BOUNCE_RE = /mailer-daemon|postmaster|delivery status notification|undeliverable|delivery has failed|returned mail|failure notice/i;

function header(headers: { name: string; value: string }[], name: string) {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function decodeGmailBody(payload: GmailPayload): string {
  const parts: GmailPayload[] = [payload, ...(payload.parts ?? []).flatMap((p) => [p, ...(p.parts ?? [])])];
  const plain = parts.find((p) => p.mimeType === "text/plain" && p.body?.data);
  const html = parts.find((p) => p.mimeType === "text/html" && p.body?.data);
  const pick = plain ?? html;
  if (!pick?.body?.data) return "";
  const text = Buffer.from(pick.body.data, "base64url").toString("utf8");
  return pick === html ? text.replace(/<[^>]+>/g, " ") : text;
}
interface GmailPayload { mimeType?: string; headers?: { name: string; value: string }[]; body?: { data?: string }; parts?: GmailPayload[] }

export async function gmailFetchMessage(token: string, id: string): Promise<InboundMessage> {
  const res = await httpFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`, { headers: { authorization: `Bearer ${token}` } });
  const m = (await res.json()) as { id: string; threadId: string; labelIds?: string[]; internalDate: string; payload: GmailPayload };
  const headers = m.payload.headers ?? [];
  const from = header(headers, "From");
  const subject = header(headers, "Subject");
  return {
    providerMessageId: m.id,
    threadId: m.threadId,
    from: from.match(/<([^>]+)>/)?.[1] ?? from,
    subject,
    body: decodeGmailBody(m.payload),
    inReplyTo: header(headers, "In-Reply-To") || undefined,
    receivedAt: new Date(Number(m.internalDate)),
    labels: m.labelIds,
    isBounce: BOUNCE_RE.test(`${from} ${subject}`),
  };
}

/** Gmail push (Pub/Sub) only tells us "something changed since historyId": list the new messages. */
export async function gmailNewMessagesSince(account: EmailAccount, historyId: string): Promise<{ messages: InboundMessage[]; latestHistoryId: string }> {
  const token = await accessToken(account);
  const res = await httpFetch(`https://gmail.googleapis.com/gmail/v1/users/me/history?startHistoryId=${historyId}&historyTypes=messageAdded&labelId=INBOX`, { headers: { authorization: `Bearer ${token}` } });
  if (res.status === 404) return { messages: [], latestHistoryId: historyId }; // history expired; next watch resets it
  const json = (await res.json()) as { history?: { messagesAdded?: { message: { id: string; labelIds?: string[] } }[] }[]; historyId: string };
  const ids = [...new Set((json.history ?? []).flatMap((h) => (h.messagesAdded ?? []).map((m) => m.message.id)))];
  const messages: InboundMessage[] = [];
  for (const id of ids) messages.push(await gmailFetchMessage(token, id));
  return { messages, latestHistoryId: json.historyId ?? historyId };
}

/** Ask Gmail to publish INBOX changes to our Pub/Sub topic (renew at least every 7 days). */
export async function gmailWatch(account: EmailAccount) {
  if (!config.GOOGLE_PUBSUB_TOPIC) return null;
  const token = await accessToken(account);
  const res = await httpFetch("https://gmail.googleapis.com/gmail/v1/users/me/watch", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ topicName: config.GOOGLE_PUBSUB_TOPIC, labelIds: ["INBOX"] }),
  });
  const json = (await res.json()) as { historyId: string; expiration: string };
  if (!res.ok) throw new ProviderError("Gmail watch failed");
  await db.update(schema.emailAccounts).set({ syncCursor: json.historyId, subscriptionExpiresAt: new Date(Number(json.expiration)) }).where(eq(schema.emailAccounts.id, account.id));
  return json;
}

/** Microsoft Graph change notifications for new Inbox messages (max ~3 days, renewed by the worker). */
export async function outlookSubscribe(account: EmailAccount) {
  const token = await accessToken(account);
  const res = await httpFetch("https://graph.microsoft.com/v1.0/subscriptions", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      changeType: "created",
      notificationUrl: `${config.API_URL}/api/webhooks/outlook`,
      resource: "me/mailFolders('Inbox')/messages",
      expirationDateTime: new Date(Date.now() + 2.5 * 86400000).toISOString(),
      clientState: config.OUTLOOK_WEBHOOK_CLIENT_STATE,
    }),
  });
  const json = (await res.json()) as { id: string; expirationDateTime: string };
  if (!res.ok) throw new ProviderError("Outlook subscription failed");
  await db.update(schema.emailAccounts).set({ syncCursor: json.id, subscriptionExpiresAt: new Date(json.expirationDateTime) }).where(eq(schema.emailAccounts.id, account.id));
  return json;
}

export async function outlookFetchMessage(account: EmailAccount, id: string): Promise<InboundMessage> {
  const token = await accessToken(account);
  const res = await httpFetch(`https://graph.microsoft.com/v1.0/me/messages/${id}?$select=id,conversationId,from,subject,body,receivedDateTime,internetMessageHeaders`, {
    headers: { authorization: `Bearer ${token}`, prefer: 'outlook.body-content-type="text"' },
  });
  const m = (await res.json()) as { id: string; conversationId: string; from?: { emailAddress: { address: string } }; subject: string; body: { content: string }; receivedDateTime: string; internetMessageHeaders?: { name: string; value: string }[] };
  const from = m.from?.emailAddress.address ?? "";
  return {
    providerMessageId: m.id,
    threadId: m.conversationId,
    from,
    subject: m.subject,
    body: m.body.content,
    inReplyTo: header(m.internetMessageHeaders ?? [], "In-Reply-To") || undefined,
    receivedAt: new Date(m.receivedDateTime),
    isBounce: BOUNCE_RE.test(`${from} ${m.subject}`),
  };
}

/** Inbox placement: was the test email (found by token in the subject) delivered to INBOX or SPAM? */
export async function gmailFindPlacement(account: EmailAccount, token: string): Promise<"inbox" | "spam" | "missing"> {
  const at = await accessToken(account);
  const q = encodeURIComponent(`subject:${token} in:anywhere newer_than:2d`);
  const res = await httpFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}&includeSpamTrash=true`, { headers: { authorization: `Bearer ${at}` } });
  const json = (await res.json()) as { messages?: { id: string }[] };
  if (!json.messages?.length) return "missing";
  const msg = await gmailFetchMessage(at, json.messages[0].id);
  return msg.labels?.includes("SPAM") ? "spam" : "inbox";
}
