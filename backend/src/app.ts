import "./lib/polyfills"; // must load before pdf.js (see file)
import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type Request, type Response } from "express";
import { requireAuth } from "./lib/auth";
import { config } from "./config";
import { pool } from "db";
import { errorHandler } from "./lib/errors";
import { authRouter } from "./routes/auth";
import { companiesRouter, contactsRouter } from "./routes/companies";
import { crmRouter } from "./routes/crm";
import { gmailWebhook, inboxRouter, openPixel, outlookWebhook, unsubscribe, unsubscribePage } from "./routes/inbox";
import { jobsRouter } from "./routes/jobs";
import { mailboxesRouter, oauthCallback } from "./routes/mailboxes";
import { analyticsRouter, billingRouter, extensionRouter, notificationsRouter, orgRouter, publicProfile, publicResume } from "./routes/misc";
import { campaignsRouter, outreachRouter, sendingRouter } from "./routes/outreach";
import { profileRouter } from "./routes/profile";

export function createApp() {
  const app = express();
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(
    cors({
      origin: (origin, cb) => {
        // the web app, plus the Chrome extension (chrome-extension://<id>)
        if (!origin || origin === config.APP_URL || origin.startsWith("chrome-extension://")) return cb(null, true);
        cb(null, false);
      },
      credentials: true,
    }),
  );
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: false, limit: "100kb" })); // one-click unsubscribe posts a form
  app.use(cookieParser());

  const api = express.Router();
  api.get("/health", async (_req: Request, res: Response) => {
    await pool.query("select 1");
    res.json({ ok: true, ai: Boolean(config.ANTHROPIC_API_KEY) && !config.AI_DISABLED });
  });

  // Public / webhook endpoints
  api.use("/auth", authRouter);
  api.get("/oauth/:provider/callback", oauthCallback);
  api.post("/webhooks/gmail", gmailWebhook);
  api.post("/webhooks/outlook", outlookWebhook);
  api.get("/t/o/:id", openPixel);
  api.get("/t/u/:id", unsubscribePage);
  api.post("/t/u/:id", unsubscribe); // RFC 8058 one-click
  api.get("/public/resume/:slug", publicResume);
  api.get("/public/:slug", publicProfile);

  // Authenticated
  api.use(requireAuth);
  api.use("/profile", profileRouter);
  api.use("/jobs", jobsRouter);
  api.use("/companies", companiesRouter);
  api.use("/contacts", contactsRouter);
  api.use("/outreach", outreachRouter);
  api.use("/campaigns", campaignsRouter);
  api.use("/sending", sendingRouter);
  api.use("/mailboxes", mailboxesRouter);
  api.use("/inbox", inboxRouter);
  api.use("/crm", crmRouter);
  api.use("/analytics", analyticsRouter);
  api.use("/notifications", notificationsRouter);
  api.use("/billing", billingRouter);
  api.use("/org", orgRouter);
  api.use("/extension", extensionRouter);

  app.use("/api", api);
  app.use((_req, res) => res.status(404).json({ error: "Not found" }));
  app.use(errorHandler);
  return app;
}
