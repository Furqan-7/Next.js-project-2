import { expect, test, type Page } from "@playwright/test";

const SHOTS = process.env.E2E_SCREENSHOTS; // optional folder for screenshots

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

async function loginDemo(page: Page) {
  await page.goto("/auth/signin");
  await page.getByLabel("Email").fill("demo@jobpilot.dev");
  await page.getByLabel("Password").fill("demo12345");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard");
}

test("landing page explains the product", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Email the people who hire/ })).toBeVisible();
  await shot(page, "01-landing");
});

test("new user onboards from resume text to a scored feed", async ({ page }) => {
  const email = `e2e-${Date.now()}@example.com`;
  await page.goto("/auth/signup");
  await page.getByLabel("Full name").fill("Kiran Rao");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("supersecret1");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/onboarding");

  await page.getByText("Or paste resume text").click();
  await page.getByPlaceholder("Paste your resume…").fill(
    "Kiran Rao\nFrontend Developer\nkiran@example.com\n\nSKILLS\nTypeScript, React, Next.js, Tailwind CSS, Node.js, PostgreSQL\n\nPROJECTS\nPayLite | Next.js, Stripe\n• Checkout page builder for small shops\n",
  );
  await page.getByRole("button", { name: "Parse text" }).click();
  await expect(page.getByText("PayLite")).toBeVisible();
  await shot(page, "02-onboarding-resume");
  await page.getByRole("button", { name: "Continue" }).click(); // → links
  await page.getByRole("button", { name: "Continue" }).click(); // → experience
  await page.getByRole("button", { name: "frontend" }).click();
  await page.getByRole("button", { name: "Internship" }).click();
  await page.getByRole("button", { name: "Continue" }).click(); // → preferences
  await page.getByRole("button", { name: "remote" }).click();
  await shot(page, "03-onboarding-prefs");
  await page.getByRole("button", { name: "Continue" }).click(); // → voice
  await page.getByRole("button", { name: "Finish and see my matches" }).click();
  await page.waitForURL("**/dashboard");
  await expect(page.getByRole("heading", { name: /Good to see you, Kiran/ })).toBeVisible();
  await expect(page.getByText("Frontend Engineering Intern").first()).toBeVisible();
  await shot(page, "04-dashboard-new-user");
});

test("demo user drafts, edits and sends an email from a job", async ({ page }) => {
  await loginDemo(page);
  await shot(page, "05-dashboard");
  await page.getByRole("link", { name: "Jobs", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Jobs" })).toBeVisible();
  await shot(page, "06-jobs");
  await page.getByRole("link", { name: "Full-stack Engineer" }).first().click();
  await expect(page.getByRole("heading", { name: "Full-stack Engineer" })).toBeVisible();
  await expect(page.getByText("Sam Lee")).toBeVisible();
  await shot(page, "07-job-detail");

  await page.getByRole("button", { name: "Write" }).first().click();
  await page.getByRole("button", { name: "Draft email" }).click();
  const body = page.getByLabel("Email", { exact: true });
  await expect(body).toHaveValue(/Sam/);
  await expect(page.getByText(/Spam risk:/)).toBeVisible();
  await shot(page, "08-draft");
  await page.getByRole("button", { name: "Send now" }).click();
  await expect(page.getByText("Queued to send now")).toBeVisible();

  await page.getByRole("link", { name: "Outreach" }).click();
  await page.getByRole("tab", { name: /Scheduled|Sent/ }).first().click();
  await shot(page, "09-outreach");
});

test("company research card, tracker, inbox, analytics, deliverability, settings", async ({ page }) => {
  await loginDemo(page);
  await page.goto("/jobs");
  await page.getByRole("link", { name: "PayNest" }).first().click();
  await expect(page.getByRole("heading", { name: "PayNest" })).toBeVisible();
  await expect(page.getByText("Riya Kapoor")).toBeVisible();
  await shot(page, "10-company");

  // LinkedIn note: ≤300 chars, copied by the user
  await page.getByRole("button", { name: "Write" }).first().click();
  await page.getByRole("button", { name: "LinkedIn note" }).click();
  await expect(page.getByText(/\/ 300/)).toBeVisible();

  await page.goto("/tracker");
  await expect(page.getByRole("region", { name: "Emailed" }).or(page.getByLabel("Emailed"))).toBeVisible();
  await shot(page, "11-tracker");

  for (const [path, heading, name] of [
    ["/inbox", "Inbox", "12-inbox"],
    ["/analytics", "Analytics", "13-analytics"],
    ["/deliverability", "Deliverability", "14-deliverability"],
    ["/campaigns/new", "New campaign", "15-campaign-new"],
    ["/settings", "Settings", "16-settings"],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    await shot(page, name);
  }
});

test("public profile page renders without signing in", async ({ page }) => {
  await page.goto("/p/asha-verma");
  await expect(page.getByRole("heading", { name: "Asha Verma" })).toBeVisible();
  await expect(page.getByText("ShopSmart")).toBeVisible();
  await shot(page, "17-public-profile");
});

test("phone layout: no horizontal scroll, menu opens", async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await loginDemo(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.getByRole("button", { name: "Open menu" }).click();
  await expect(page.getByRole("link", { name: "Tracker" })).toBeVisible();
  await shot(page, "18-mobile-menu");
  await page.close();
});

test("tracker: moving a card to Interview builds the prep pack", async ({ page }) => {
  await loginDemo(page);
  const company = `E2E Corp ${Date.now()}`;
  const created = await page.request.post("/backend/crm/applications", { data: { company, roleTitle: "Frontend Intern", stage: "found" } });
  expect(created.status()).toBe(201);
  await page.goto("/tracker");
  const mover = page.getByRole("combobox", { name: `Move ${company}` });
  await expect(mover).toBeVisible();
  await mover.selectOption("interview");
  await expect(page.getByText("Interview prep pack is ready")).toBeVisible();
  await page.getByRole("region", { name: "Interview" }).getByRole("link", { name: new RegExp(company) }).click();
  await page.getByRole("tab", { name: "Interview prep" }).click();
  await expect(page.getByText("Likely questions")).toBeVisible();
  await expect(page.getByText("Negotiation")).toBeVisible();
  await shot(page, "19-prep-pack");
});

test("free plan: campaign builder explains bulk campaigns need Pro", async ({ page }) => {
  await loginDemo(page);
  await page.goto("/campaigns/new");
  await expect(page.getByText(/Bulk campaigns are a Pro feature/)).toBeVisible();
  await expect(page.getByRole("option", { name: /Autopilot.*\(Pro\)/ })).toBeDisabled();
});

test("deliverability: run SPF/DKIM/DMARC checks", async ({ page }) => {
  await loginDemo(page);
  await page.goto("/deliverability");
  await page.getByRole("button", { name: "Run checks" }).click();
  await expect(page.getByText("DNS records checked")).toBeVisible();
  await expect(page.getByText("Inbox health")).toBeVisible();
  await shot(page, "20-deliverability-checked");
});

test("uploading a PDF resume keeps you signed in (pdf.js base64 regression)", async ({ page }) => {
  const { makePdf } = await import("../../backend/test/pdf");
  await loginDemo(page);
  await page.goto("/settings");
  await page.locator('input[type="file"]').setInputFiles({ name: "resume.pdf", mimeType: "application/pdf", buffer: makePdf(["Asha Verma", "SKILLS", "TypeScript, Next.js, PostgreSQL, Redis"]) });
  await expect(page.getByText("Resume parsed")).toBeVisible();
  await page.goto("/jobs");
  await expect(page.getByRole("heading", { name: "Jobs" })).toBeVisible();
  const me = await page.request.get("/backend/auth/me");
  expect(me.status()).toBe(200);
});
