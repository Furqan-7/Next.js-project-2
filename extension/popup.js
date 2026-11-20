import { call, getSettings } from "./api.js";
import { extractPage } from "./extract.js";

const $ = (id) => document.getElementById(id);
const show = (id, on) => $(id).classList.toggle("hidden", !on);

async function render() {
  const { token, name } = await getSettings();
  show("login", !token);
  show("capture", Boolean(token));
  $("who").textContent = name;
  if (token) await readPage();
}

let page = null;
async function readPage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractPage });
    page = result;
    const what = page.person ? `Profile: ${page.person.name}` : page.job ? `Job: ${page.job.title} at ${page.job.company}` : `Company site: ${new URL(page.url).hostname}`;
    $("pageInfo").textContent = what;
  } catch {
    $("pageInfo").textContent = "Can't read this page (browser pages and the Web Store are off-limits).";
    $("go").disabled = true;
  }
}

$("signin").addEventListener("click", async () => {
  $("loginError").textContent = "";
  try {
    const r = await call("/auth/login", { method: "POST", body: JSON.stringify({ email: $("email").value, password: $("password").value }) });
    await chrome.storage.local.set({ token: r.token, name: r.user.name });
    await render();
  } catch (e) {
    $("loginError").textContent = e.message;
  }
});

$("logout").addEventListener("click", async () => {
  await chrome.storage.local.remove(["token", "name"]);
  await render();
});

$("go").addEventListener("click", async () => {
  if (!page) return;
  $("go").disabled = true;
  $("status").textContent = "Finding people and verifying emails…";
  try {
    const r = await call("/extension/capture", { method: "POST", body: JSON.stringify(page) });
    show("result", true);
    $("result").style.display = "grid";
    $("companyCard").innerHTML = "";
    const c = document.createElement("div");
    c.innerHTML = `<strong></strong> <span class="badge"></span><div class="muted"></div>`;
    c.querySelector("strong").textContent = r.company.name;
    c.querySelector(".badge").textContent = r.jobId ? "job saved" : "company";
    c.querySelector(".muted").textContent = r.company.product || r.company.domain || "";
    $("companyCard").append(c);
    $("contactCard").textContent = r.target ? `${r.target.name}${r.target.title ? ` · ${r.target.title}` : ""}: ${r.target.email} (${r.target.emailStatus}, ${r.target.emailConfidence}%)` : "No verified contact yet. Open the company in JobPilot to find people.";
    $("subject").value = r.draft?.subject ?? "";
    $("body").value = r.draft?.body ?? "";
    $("open").href = r.appUrl;
    $("status").textContent = r.draft ? "Draft ready. Review it, then send from JobPilot or copy it." : "";
  } catch (e) {
    $("status").textContent = e.message;
  } finally {
    $("go").disabled = false;
  }
});

$("copy").addEventListener("click", async () => {
  await navigator.clipboard.writeText(`Subject: ${$("subject").value}\n\n${$("body").value}`);
  $("status").textContent = "Copied.";
});

void render();
