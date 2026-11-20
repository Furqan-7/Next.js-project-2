/**
 * Runs inside the page (via chrome.scripting.executeScript). Must be self-contained:
 * no imports, no closures. Reads only what the user can already see on the page.
 */
export function extractPage() {
  const q = (sel) => document.querySelector(sel);
  const text = (sel) => (q(sel)?.textContent || "").replace(/\s+/g, " ").trim();
  const meta = (name) => q(`meta[property="${name}"], meta[name="${name}"]`)?.getAttribute("content") || "";
  const url = location.href;
  const host = location.hostname;
  const out = { url, title: document.title, text: (document.body?.innerText || "").slice(0, 60000), kind: "auto" };

  if (/linkedin\.com$/.test(host) || host.endsWith(".linkedin.com")) {
    if (/\/in\//.test(location.pathname)) {
      const name = text("h1");
      const headline = text(".text-body-medium") || text("[data-generated-suggestion-target]");
      const company = text('[aria-label^="Current company"]') || text(".pv-text-details__right-panel span") || (headline.split(/ at | @ /i)[1] || "").trim();
      return { ...out, kind: "profile", person: { name, title: headline.split(/ at | @ /i)[0]?.trim(), company: company || undefined } };
    }
    if (/\/jobs\//.test(location.pathname)) {
      return {
        ...out,
        kind: "job",
        job: {
          title: text(".job-details-jobs-unified-top-card__job-title h1") || text("h1"),
          company: text(".job-details-jobs-unified-top-card__company-name a") || text(".job-details-jobs-unified-top-card__company-name"),
          location: text(".job-details-jobs-unified-top-card__primary-description-container span"),
          description: text("#job-details") || text(".jobs-description__content"),
        },
      };
    }
  }
  const h1 = text("h1");
  const siteName = meta("og:site_name");
  const looksLikeJob = /\/(jobs?|careers?|positions?|openings?)\b/i.test(location.pathname) || /greenhouse|lever\.co|ashbyhq|workable|wellfound|workatastartup/.test(host);
  if (looksLikeJob && h1) {
    let company = siteName;
    if (!company) {
      const m = document.title.match(/(?:at|@|-|\|)\s*([^|–-]+)$/);
      company = (m && m[1].trim()) || host.replace(/^www\.|^jobs\.|^careers\./, "").split(".")[0];
    }
    return { ...out, kind: "job", job: { title: h1, company, description: (q("main")?.innerText || out.text).slice(0, 30000) } };
  }
  const canonical = q('link[rel="canonical"]')?.getAttribute("href");
  return { ...out, kind: "company", companyWebsite: canonical ? new URL(canonical, url).origin : location.origin };
}
