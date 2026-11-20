import { and, desc, eq, inArray } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { me } from "../lib/auth";
import { config } from "../config";
import { db, schema } from "db";
import { randomToken } from "../lib/crypto";
import { readResume } from "../lib/storage";
import { badRequest, forbidden, notFound } from "../lib/errors";
import { logger } from "../lib/logger";
import { gmailNewMessagesSince, outlookFetchMessage } from "../services/mail/providers";
import { ingestInbound } from "../services/replies";
import { advanceStage, logEvent } from "../services/sequencer";

export const inboxRouter = Router();

inboxRouter.get("/", async (req, res) => {
  const { category } = z.object({ category: z.string().optional() }).parse(req.query);
  const rows = await db
    .select({ reply: schema.replies, message: schema.messages, contact: schema.contacts, company: schema.companies })
    .from(schema.replies)
    .leftJoin(schema.messages, eq(schema.replies.messageId, schema.messages.id))
    .leftJoin(schema.contacts, eq(schema.messages.contactId, schema.contacts.id))
    .leftJoin(schema.companies, eq(schema.contacts.companyId, schema.companies.id))
    .where(and(eq(schema.replies.userId, me(req).id), category ? eq(schema.replies.category, category) : undefined))
    .orderBy(desc(schema.replies.receivedAt))
    .limit(200);
  res.json({ items: rows.map((r) => ({ ...r.reply, original: r.message ? { id: r.message.id, subject: r.message.subject, body: r.message.body, sentAt: r.message.sentAt } : null, contact: r.contact, company: r.company })) });
});

inboxRouter.post("/:id/handled", async (req, res) => {
  const [r] = await db.update(schema.replies).set({ handled: true }).where(and(eq(schema.replies.id, req.params.id), eq(schema.replies.userId, me(req).id))).returning();
  if (!r) throw notFound("Reply not found");
  res.json({ reply: r });
});

/** Send (or schedule) a response in the same thread, usually starting from the suggested draft. */
inboxRouter.post("/:id/respond", async (req, res) => {
  const user = me(req);
  const body = z.object({ body: z.string().min(1), sendNow: z.boolean().default(true), attachResume: z.boolean().optional() }).parse(req.body);
  const [reply] = await db.select().from(schema.replies).where(and(eq(schema.replies.id, req.params.id), eq(schema.replies.userId, user.id)));
  if (!reply?.messageId) throw notFound("Reply not found");
  const [orig] = await db.select().from(schema.messages).where(eq(schema.messages.id, reply.messageId));
  const [m] = await db
    .insert(schema.messages)
    .values({
      userId: user.id,
      applicationId: orig.applicationId,
      contactId: orig.contactId,
      emailAccountId: orig.emailAccountId,
      toEmail: reply.fromEmail,
      step: orig.step + 1,
      subject: reply.subject.toLowerCase().startsWith("re:") ? reply.subject : `Re: ${reply.subject}`,
      body: body.body,
      tone: orig.tone,
      templateKey: "manual:response",
      status: "scheduled",
      scheduledAt: new Date(),
      providerThreadId: orig.providerThreadId,
      trackingId: randomToken(12),
      attachResume: body.attachResume ?? (reply.category === "asked_for_resume" && (await readResume(user.id)) !== null),
    })
    .returning();
  await db.update(schema.replies).set({ handled: true }).where(eq(schema.replies.id, reply.id));
  res.status(201).json({ message: m });
});

/** Mark that a meeting was booked (via Cal.com / Google Calendar link), moving the card to Interview. */
inboxRouter.post("/:id/interview", async (req, res) => {
  const { at, link } = z.object({ at: z.string().datetime().optional(), link: z.string().optional() }).parse(req.body ?? {});
  const [reply] = await db.select().from(schema.replies).where(and(eq(schema.replies.id, req.params.id), eq(schema.replies.userId, me(req).id)));
  if (!reply?.applicationId) throw notFound("Reply not found");
  await advanceStage(reply.applicationId, "interview", "meeting booked");
  await logEvent(reply.applicationId, "interview_scheduled", { at, link });
  if (at) await db.insert(schema.reminders).values({ userId: reply.userId, applicationId: reply.applicationId, text: "Interview", dueAt: new Date(at) });
  res.json({ ok: true });
});

/** Booking helpers: Cal.com link (if configured) and a Google Calendar "add event" template link. */
inboxRouter.get("/:id/booking-links", async (req, res) => {
  const [reply] = await db.select().from(schema.replies).where(and(eq(schema.replies.id, req.params.id), eq(schema.replies.userId, me(req).id)));
  if (!reply) throw notFound("Reply not found");
  const start = new Date(Date.now() + 2 * 86400000);
  start.setUTCMinutes(0, 0, 0);
  const end = new Date(start.getTime() + 30 * 60000);
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const gcal = `https://calendar.google.com/calendar/render?${new URLSearchParams({ action: "TEMPLATE", text: `Call: ${reply.subject.replace(/^re:\s*/i, "")}`, dates: `${fmt(start)}/${fmt(end)}`, add: reply.fromEmail, details: "Booked from JobPilot" })}`;
  res.json({ calCom: config.CAL_COM_LINK ?? null, googleCalendar: gcal });
});

/** Dev/testing: simulate an inbound reply without a real mailbox. */
inboxRouter.post("/simulate", async (req, res) => {
  if (config.NODE_ENV === "production") throw forbidden("Not available in production");
  const user = me(req);
  const body = z.object({ messageId: z.string().uuid(), body: z.string().min(1), subject: z.string().optional(), bounce: z.boolean().optional() }).parse(req.body);
  const [msg] = await db.select().from(schema.messages).where(and(eq(schema.messages.id, body.messageId), eq(schema.messages.userId, user.id)));
  if (!msg?.emailAccountId) throw badRequest("Message hasn't been sent from a mailbox");
  const [account] = await db.select().from(schema.emailAccounts).where(eq(schema.emailAccounts.id, msg.emailAccountId));
  const result = await ingestInbound(account, {
    providerMessageId: `sim-${randomToken(8)}`,
    threadId: msg.providerThreadId ?? undefined,
    from: body.bounce ? "mailer-daemon@googlemail.com" : msg.toEmail,
    subject: body.subject ?? (body.bounce ? "Delivery Status Notification (Failure)" : `Re: ${msg.subject}`),
    body: body.bounce ? `Final-Recipient: rfc822; ${msg.toEmail}\n${body.body}` : body.body,
    receivedAt: new Date(),
    isBounce: Boolean(body.bounce),
  });
  res.json(result);
});

// ---------------------------------------------------------------- Webhooks (no session auth)

/** Gmail → Pub/Sub push subscription. Body: { message: { data: base64({emailAddress, historyId}) } } */
export async function gmailWebhook(req: Request, res: Response) {
  if (config.GOOGLE_PUBSUB_VERIFICATION_TOKEN && req.query.token !== config.GOOGLE_PUBSUB_VERIFICATION_TOKEN) return res.status(403).end();
  try {
    const data = JSON.parse(Buffer.from(req.body?.message?.data ?? "", "base64").toString("utf8")) as { emailAddress: string; historyId: number };
    const accounts = await db.select().from(schema.emailAccounts).where(and(eq(schema.emailAccounts.email, data.emailAddress), eq(schema.emailAccounts.provider, "gmail")));
    for (const account of accounts) {
      if (!account.syncCursor) {
        await db.update(schema.emailAccounts).set({ syncCursor: String(data.historyId) }).where(eq(schema.emailAccounts.id, account.id));
        continue;
      }
      const { messages, latestHistoryId } = await gmailNewMessagesSince(account, account.syncCursor);
      for (const m of messages) await ingestInbound(account, m);
      await db.update(schema.emailAccounts).set({ syncCursor: latestHistoryId }).where(eq(schema.emailAccounts.id, account.id));
    }
  } catch (e) {
    logger.warn("gmail webhook error", { error: String(e) });
  }
  res.status(204).end(); // always ack so Pub/Sub doesn't retry forever
}

/** Microsoft Graph change notifications. Handles the validation handshake too. */
export async function outlookWebhook(req: Request, res: Response) {
  if (typeof req.query.validationToken === "string") return res.type("text/plain").send(req.query.validationToken);
  const notes = (req.body?.value ?? []) as { subscriptionId: string; clientState?: string; resourceData?: { id: string } }[];
  res.status(202).end();
  for (const n of notes) {
    if (n.clientState !== config.OUTLOOK_WEBHOOK_CLIENT_STATE || !n.resourceData?.id) continue;
    try {
      const [account] = await db.select().from(schema.emailAccounts).where(eq(schema.emailAccounts.syncCursor, n.subscriptionId));
      if (!account) continue;
      await ingestInbound(account, await outlookFetchMessage(account, n.resourceData.id));
    } catch (e) {
      logger.warn("outlook webhook error", { error: String(e) });
    }
  }
}

const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

export async function openPixel(req: Request, res: Response) {
  const id = String(req.params.id).replace(/\.gif$/, "");
  const [m] = await db.select().from(schema.messages).where(eq(schema.messages.trackingId, id));
  // Ignore opens in the first 10 seconds after sending: those are usually our own client prefetching.
  if (m && (!m.sentAt || Date.now() - m.sentAt.getTime() > 10_000)) {
    await db.update(schema.messages).set({ openedAt: m.openedAt ?? new Date(), openCount: m.openCount + 1 }).where(eq(schema.messages.id, m.id));
  }
  res.set({ "content-type": "image/gif", "cache-control": "no-store, max-age=0" }).send(PIXEL);
}

/** GET only shows a confirmation button: link scanners in corporate mail prefetch GET URLs. */
export function unsubscribePage(req: Request, res: Response) {
  const id = String(req.params.id).replace(/[^A-Za-z0-9_-]/g, "");
  res
    .type("html")
    .send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:system-ui,sans-serif;max-width:28rem;margin:4rem auto;padding:0 1rem"><p>Don't want more emails from this sender?</p><form method="post" action="/api/t/u/${id}"><button style="padding:.6rem 1rem;border-radius:8px;border:1px solid #ccc;cursor:pointer">Unsubscribe</button></form></body>`);
}

/** RFC 8058 one-click unsubscribe (POST from the mail client or the confirmation page). */
export async function unsubscribe(req: Request, res: Response) {
  const [m] = await db.select().from(schema.messages).where(eq(schema.messages.trackingId, String(req.params.id)));
  if (m) {
    await db.insert(schema.suppressions).values({ userId: m.userId, email: m.toEmail.toLowerCase(), reason: "unsubscribe" }).onConflictDoNothing();
    if (m.applicationId) {
      await db
        .update(schema.messages)
        .set({ status: "cancelled", error: "unsubscribed" })
        .where(and(eq(schema.messages.applicationId, m.applicationId), inArray(schema.messages.status, ["scheduled", "pending_approval", "draft"])));
    }
  }
  res.type("html").send("<p style='font-family:sans-serif'>You won't receive further emails from this sender. Sorry for the interruption.</p>");
}
