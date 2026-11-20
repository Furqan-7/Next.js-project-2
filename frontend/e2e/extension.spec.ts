import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

// Runs the extension's real in-page extractor (extension/extract.js) against sample pages.
// No servers needed: each page is served from a route handler.
const fnSource = readFileSync(new URL("../../extension/extract.js", import.meta.url), "utf8").replace("export function", "function");

async function extract(page: Page, url: string, html: string) {
  await page.route("**/*", (route) => route.fulfill({ contentType: "text/html", body: html }));
  await page.goto(url);
  return page.evaluate(`${fnSource}\nextractPage()`) as Promise<Record<string, unknown> & { job?: Record<string, string>; person?: Record<string, string> }>;
}

test("extension: reads a Greenhouse-style job posting", async ({ page }) => {
  const r = await extract(page, "https://boards.greenhouse.io/acme/jobs/1", `<html><head><title>Frontend Engineer at Acme</title><meta property="og:site_name" content="Acme"></head><body><main><h1>Frontend Engineer</h1><p>React and TypeScript</p></main></body></html>`);
  expect(r.kind).toBe("job");
  expect(r.job).toMatchObject({ title: "Frontend Engineer", company: "Acme" });
});

test("extension: reads a LinkedIn profile", async ({ page }) => {
  const r = await extract(page, "https://www.linkedin.com/in/riya-kapoor/", `<html><body><h1>Riya Kapoor</h1><div class="text-body-medium">Co-founder & CEO at PayNest</div></body></html>`);
  expect(r.kind).toBe("profile");
  expect(r.person).toMatchObject({ name: "Riya Kapoor", title: "Co-founder & CEO", company: "PayNest" });
});

test("extension: falls back to a company site", async ({ page }) => {
  const r = await extract(page, "https://paynest.io/", `<html><head><title>PayNest: checkout</title></head><body><p>Hello</p></body></html>`);
  expect(r).toMatchObject({ kind: "company", companyWebsite: "https://paynest.io" });
});
