import { planAllows } from "shared";
import { eq } from "drizzle-orm";
import * as webpush from "web-push";
import { config } from "../config";
import { db, schema } from "db";
import { httpFetch } from "../lib/http";
import { logger } from "../lib/logger";

let vapidReady = false;
function ensureVapid() {
  if (vapidReady || !config.VAPID_PUBLIC_KEY || !config.VAPID_PRIVATE_KEY) return vapidReady;
  webpush.setVapidDetails(config.VAPID_SUBJECT, config.VAPID_PUBLIC_KEY, config.VAPID_PRIVATE_KEY);
  vapidReady = true;
  return true;
}

export async function sendWhatsApp(to: string, body: string): Promise<boolean> {
  if (!config.TWILIO_ACCOUNT_SID || !config.TWILIO_AUTH_TOKEN || !config.TWILIO_WHATSAPP_FROM) return false;
  const auth = Buffer.from(`${config.TWILIO_ACCOUNT_SID}:${config.TWILIO_AUTH_TOKEN}`).toString("base64");
  const res = await httpFetch(`https://api.twilio.com/2010-04-01/Accounts/${config.TWILIO_ACCOUNT_SID}/Messages.json`, {
    method: "POST",
    headers: { authorization: `Basic ${auth}`, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ From: config.TWILIO_WHATSAPP_FROM, To: to.startsWith("whatsapp:") ? to : `whatsapp:${to}`, Body: body }),
  });
  return res.ok;
}

/** In-app notification, plus web push and WhatsApp when the user enabled them. */
export async function notify(userId: string, n: { type: string; title: string; body?: string; link?: string }) {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!user) return;
  const channels: string[] = ["in_app"];
  if (user.notificationPrefs.push && user.pushSubscriptions.length && ensureVapid()) {
    const payload = JSON.stringify({ title: n.title, body: n.body ?? "", url: n.link ?? "/" });
    const alive: unknown[] = [];
    for (const sub of user.pushSubscriptions) {
      try {
        await webpush.sendNotification(sub as webpush.PushSubscription, payload);
        alive.push(sub);
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status !== 404 && status !== 410) alive.push(sub); // drop expired subscriptions
      }
    }
    if (alive.length !== user.pushSubscriptions.length) await db.update(schema.users).set({ pushSubscriptions: alive }).where(eq(schema.users.id, userId));
    channels.push("push");
  }
  const important = ["reply", "interview"].includes(n.type);
  if (important && user.notificationPrefs.whatsapp && user.phone && planAllows(user.plan, "whatsappNotifications")) {
    try {
      if (await sendWhatsApp(user.phone, `${n.title}\n${n.body ?? ""}\n${config.APP_URL}${n.link ?? ""}`)) channels.push("whatsapp");
    } catch (e) {
      logger.warn("whatsapp send failed", { error: String(e) });
    }
  }
  await db.insert(schema.notifications).values({ userId, type: n.type, title: n.title, body: n.body ?? "", link: n.link, channels });
}
