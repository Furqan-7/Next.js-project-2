// Shared by the popup and options page.
// Settings live in chrome.storage.local: { webUrl, token, name }. The web app proxies the API at
// /backend, so one address works for both.

export const DEFAULT_WEB_URL = "http://localhost:3000";

export async function getSettings() {
  const { webUrl = DEFAULT_WEB_URL, token = null, name = "" } = await chrome.storage.local.get(["webUrl", "token", "name"]);
  const web = webUrl.replace(/\/+$/, "");
  return { webUrl: web, apiUrl: `${web}/backend`, token, name };
}

export async function call(path, init = {}) {
  const { apiUrl, token } = await getSettings();
  const res = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
