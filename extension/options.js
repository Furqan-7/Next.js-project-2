import { DEFAULT_WEB_URL, getSettings } from "./api.js";

const input = document.getElementById("webUrl");
const { webUrl } = await getSettings();
input.value = webUrl;

document.getElementById("save").addEventListener("click", async () => {
  const value = (input.value.trim() || DEFAULT_WEB_URL).replace(/\/+$/, "");
  // Changing the address signs you out of the old one
  await chrome.storage.local.set({ webUrl: value });
  await chrome.storage.local.remove(["token", "name"]);
  document.getElementById("saved").textContent = "Saved. Sign in again from the popup.";
});
