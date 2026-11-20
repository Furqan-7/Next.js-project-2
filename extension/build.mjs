// Packages the extension: node extension/build.mjs  →  extension/dist/chromium/
// The source folder itself is the Chromium build, so "Load unpacked" on extension/ works too.
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const src = dirname(fileURLToPath(import.meta.url));
const out = join(src, "dist", "chromium");
const FILES = ["manifest.json", "api.js", "extract.js", "icon.svg", "options.html", "options.js", "popup.css", "popup.html", "popup.js"];

rmSync(join(src, "dist"), { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const f of FILES) cpSync(join(src, f), join(out, f));
console.log(`extension built → ${out} (Load unpacked in chrome://extensions)`);
