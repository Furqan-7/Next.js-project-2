import { describe, expect, it } from "vitest";
import { analyzeDmarc, analyzeSpf } from "../src/services/deliverability";
import {
  detectAts,
  parseAshby,
  parseFundingRss,
  parseFundingTitle,
  parseGreenhouse,
  parseHnComment,
  parseLever,
  parseRemoteOk,
  parseRemotive,
  parseSalary,
  parseWorkable,
  parseXPosts,
  parseYc,
} from "../src/ingest/sources";
import { heuristicStyle } from "../src/services/enrich";
import { buildMime, textToHtml } from "../src/services/mail/mime";
import { extractPeopleFromText, fromJobText } from "../src/services/people";
import { bouncedRecipient } from "../src/services/replies";
import { detectTechFromHtml, extractMeta } from "../src/services/research";
import { decrypt, encrypt } from "../src/lib/crypto";
import { stripHtml } from "../src/lib/http";

describe("job source parsers", () => {
  it("greenhouse", () => {
    const jobs = parseGreenhouse("acme", "Acme", {
      jobs: [{ id: 1, title: "Frontend Engineer", absolute_url: "https://boards.greenhouse.io/acme/jobs/1", location: { name: "Remote - US" }, content: "&lt;p&gt;We use React and TypeScript&lt;/p&gt;", updated_at: "2026-11-01T00:00:00Z" }],
    });
    expect(jobs[0]).toMatchObject({ source: "greenhouse", title: "Frontend Engineer", company: "Acme", remote: true });
    expect(jobs[0].description).toBe("We use React and TypeScript");
  });
  it("lever", () => {
    const jobs = parseLever("plaid", [{ id: "x", text: "Software Engineer Intern", hostedUrl: "https://jobs.lever.co/plaid/x", categories: { location: "San Francisco", commitment: "Intern" }, descriptionPlain: "Build APIs", lists: [{ text: "Requirements", content: "<li>Python</li>" }], createdAt: 1730000000000 }]);
    expect(jobs[0]).toMatchObject({ company: "Plaid", employmentType: "internship" });
    expect(jobs[0].description).toContain("Python");
  });
  it("ashby with compensation", () => {
    const jobs = parseAshby("linear", { jobs: [{ id: "1", title: "Product Engineer", isRemote: true, jobUrl: "https://jobs.ashbyhq.com/linear/1", employmentType: "FullTime", compensation: { compensationTierSummary: "$150K – $200K" } }] });
    expect(jobs[0]).toMatchObject({ remote: true, salaryMin: 150000, salaryMax: 200000, currency: "USD", employmentType: "full_time" });
  });
  it("workable", () => {
    const jobs = parseWorkable("acme", { name: "Acme Ltd", jobs: [{ title: "Backend Dev", shortcode: "AB12", city: "Berlin", country: "Germany", telecommuting: false, description: "<p>Go and Postgres</p>" }] });
    expect(jobs[0]).toMatchObject({ company: "Acme Ltd", location: "Berlin, Germany" });
  });
  it("remotive + remoteok", () => {
    expect(parseRemotive({ jobs: [{ id: 5, url: "u", title: "T", company_name: "C", job_type: "internship", salary: "$40k - $50k" }] })[0]).toMatchObject({ employmentType: "internship", salaryMin: 40000 });
    expect(parseRemoteOk([{ legal: "notice" }, { id: "9", position: "Dev", company: "Co", tags: ["react"] }])).toHaveLength(1);
  });
  it("HN who's hiring comment", () => {
    const j = parseHnComment({ id: 42, text: "Tallyhouse | Founding Engineer | REMOTE (US/EU) | $120k-$160k | https://tallyhouse.app<p>We use TypeScript.", created_at: "2026-11-01T00:00:00Z" }, 1);
    expect(j).toMatchObject({ company: "Tallyhouse", title: "Founding Engineer", remote: true, companyDomain: "tallyhouse.app", salaryMin: 120000 });
    expect(parseHnComment({ id: 1, text: "just a comment" }, 1)).toBeNull();
  });
  it("YC hiring list and X posts", () => {
    expect(parseYc([{ id: 1, name: "Foo", slug: "foo", website: "https://foo.com", isHiring: true, batch: "W26" }])[0]).toMatchObject({ isHiringPost: true, companyDomain: "foo.com" });
    const x = parseXPosts({ data: [{ id: "1", text: "We're hiring founding engineers at @Acme! Remote.", author_id: "u" }], includes: { users: [{ id: "u", name: "Jane", username: "jane", url: "https://acme.io" }] } });
    expect(x[0]).toMatchObject({ title: "Founding Engineers", company: "Acme", remote: true });
  });
  it("funding news", () => {
    expect(parseFundingTitle("PayNest raises $4M seed round to simplify checkout")).toMatchObject({ companyName: "PayNest", amount: "$4M", round: "Seed" });
    expect(parseFundingTitle("Exclusive: AI startup Lumen secures $12 million Series A")).toMatchObject({ companyName: "AI startup Lumen", round: "Series A" });
    const rss = `<?xml version="1.0"?><rss><channel><item><title>Acme raises $10M Series A</title><link>https://tc.com/a</link><pubDate>Mon, 02 Nov 2026 10:00:00 GMT</pubDate></item><item><title>Unrelated news</title><link>https://tc.com/b</link></item></channel></rss>`;
    expect(parseFundingRss(rss)).toHaveLength(1);
  });
  it("ATS detection and salary parsing", () => {
    expect(detectAts("https://boards.greenhouse.io/stripe/jobs/123")).toEqual({ type: "greenhouse", token: "stripe" });
    expect(detectAts("https://jobs.lever.co/netflix")).toEqual({ type: "lever", token: "netflix" });
    expect(detectAts("https://jobs.ashbyhq.com/Linear")).toEqual({ type: "ashby", token: "linear" });
    expect(detectAts("https://example.com/careers")).toBeNull();
    expect(parseSalary("₹6 LPA - ₹9 LPA")).toEqual({ min: 600000, max: 900000, currency: "INR" });
  });
});

describe("people + research helpers", () => {
  it("extracts people from team pages and job posts", () => {
    const people = extractPeopleFromText("Our team\nRiya Kapoor\nCo-founder & CEO\nDev Malhotra - CTO\nRandom text");
    expect(people.map((p) => p.name)).toEqual(["Riya Kapoor", "Dev Malhotra"]);
    expect(fromJobText("Questions? Reach out to Jane Doe (jane@acme.io)")[0]).toMatchObject({ name: "Jane Doe", email: "jane@acme.io" });
  });
  it("detects tech and meta from html", () => {
    const html = `<html><head><title>Acme</title><meta name="description" content="Payments for stores"></head><body><script src="/_next/static/x.js"></script><a href="https://github.com/acme">gh</a></body></html>`;
    expect(detectTechFromHtml(html)).toContain("Next.js");
    expect(extractMeta(html)).toMatchObject({ title: "Acme", description: "Payments for stores", github: "https://github.com/acme" });
  });
});

describe("mail", () => {
  it("builds valid MIME with threading headers and tracking pixel", () => {
    const raw = buildMime({ from: "a@x.com", fromName: "Asha Verma", to: "b@y.com", subject: "Héllo", text: "Hi\n\nhttps://asha.dev", html: textToHtml("Hi", "https://api/t/o/abc.gif"), messageId: "<1@x.com>", inReplyTo: "<0@x.com>", references: ["<0@x.com>"], headers: { "List-Unsubscribe": "<https://api/t/u/abc>" } });
    expect(raw).toContain("Subject: =?UTF-8?B?");
    expect(raw).toContain("In-Reply-To: <0@x.com>");
    expect(raw).toContain("List-Unsubscribe:");
    expect(raw).toContain("multipart/alternative");
    const html = Buffer.from(raw.split("text/html")[1].split("\r\n\r\n")[1].split("--")[0].replace(/\r\n/g, ""), "base64").toString();
    expect(html).toContain("t/o/abc.gif");
  });
  it("finds bounced recipients", () => {
    expect(bouncedRecipient("Final-Recipient: rfc822; jane@acme.io\nAction: failed")).toBe("jane@acme.io");
    expect(bouncedRecipient("Your message wasn't delivered to bob@acme.io because the address couldn't be found")).toBe("bob@acme.io");
  });
  it("analyzes SPF and DMARC", () => {
    expect(analyzeSpf(["v=spf1 include:_spf.google.com ~all"], "google").ok).toBe(true);
    expect(analyzeSpf(["v=spf1 ~all", "v=spf1 -all"], "google").issues).toContain("Multiple SPF records (only one is allowed)");
    expect(analyzeDmarc(["v=DMARC1; p=none; rua=mailto:x@y.com"])).toMatchObject({ ok: true, policy: "none" });
    expect(analyzeDmarc([]).ok).toBe(false);
  });
});

describe("misc", () => {
  it("encrypts tokens round-trip", () => {
    const enc = encrypt("ya29.secret");
    expect(enc).not.toContain("secret");
    expect(decrypt(enc)).toBe("ya29.secret");
  });
  it("strips html", () => {
    expect(stripHtml("<p>Hello&nbsp;<b>world</b></p><script>x</script>")).toBe("Hello world");
  });
  it("infers writing style without AI", () => {
    expect(heuristicStyle("Hey! Super excited about this. Thanks,\nAsha").formality).toBe("casual");
  });
});
