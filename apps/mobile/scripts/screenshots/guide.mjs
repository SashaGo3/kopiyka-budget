#!/usr/bin/env node
/**
 * Pictures for the notification-automation guide (Settings → Automate with Shortcut, and the
 * site's /shortcut page): simulator captures of Apple's Shortcuts app with the thing to tap ringed.
 *
 *   node scripts/screenshots/guide.mjs [--lang=en,uk]
 *
 * Reads screenshots/raw/guide/<lang>/NN.png (full-resolution `simctl io screenshot` captures of the
 * iOS 27 "Kopiyka Guide" simulator; not committed, like the rest of raw/) and
 * screenshots/guide/<lang>.json — for each capture, the rings to draw, in points ([x, y, width,
 * height], as `idb ui describe-all` reports frames), or {rect, label} for a ring with a label under
 * it. Writes:
 *
 *   assets/guide/<lang>/NN.jpg      bundled with the app (600 px wide)
 *   ../../site/img/guide/<lang>/NN.webp   for the site (the same, as WebP)
 *
 * The labels are translations, from packages/i18n/locales/<lang>/automation.json
 * (`shortcut.guide.<key>`), because a ring on "Messages" has to say it stands for your bank.
 *
 * A capture a language cannot have is copied from English and labelled: "Describe a shortcut" (02)
 * needs Apple Intelligence, which has no Ukrainian, so raw/guide/uk/02.png is the English one with
 * `shortcut.guide.edit` under the ringed button.
 *
 * The simulator has no bank app and no Wallet, so the captures use Messages as the bank — the
 * label says so. The Dynamic Island the simulator draws while a location is in use is painted
 * out, so the status bar reads the same on every picture.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MOBILE = path.resolve(HERE, "../..");
const RAW = path.join(MOBILE, "screenshots", "raw", "guide");
const MARKS = path.join(MOBILE, "screenshots", "guide");
const APP_OUT = path.join(MOBILE, "assets", "guide");
const SITE_OUT = path.resolve(MOBILE, "../../site/img/guide");
const LOCALES = path.resolve(MOBILE, "../../packages/i18n/locales");

/** Points → pixels on the iPhone 17 Pro the captures come from. */
const SCALE = 3;
const WIDTH = 600;
const RING = "#FF9500";

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const langs = (arg("lang") ?? fs.readdirSync(MARKS).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).join(",")).split(",");

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function label(lang, key) {
  const file = path.join(LOCALES, lang, "automation.json");
  const fallback = path.join(LOCALES, "en", "automation.json");
  for (const f of [file, fallback]) {
    const v = JSON.parse(fs.readFileSync(f, "utf8")).shortcut?.guide?.[key];
    if (v) return typeof v === "string" ? v : v.message;
  }
  throw new Error(`no label shortcut.guide.${key}`);
}

/** Whether the capture has the Dynamic Island drawn into it: dark pixels at the top centre. */
function hasIsland(png) {
  const out = execFileSync("magick", [png, "-crop", "60x20+573+50", "-resize", "1x1!", "-format", "%[fx:mean]", "info:"]).toString();
  return Number(out) < 0.2;
}

function render(lang, name, marks, tmp) {
  const png = path.join(RAW, lang, `${name}.png`);
  const [w, h] = execFileSync("magick", ["identify", "-format", "%w %h", png]).toString().split(" ").map(Number);
  const parts = [];
  if (hasIsland(png)) {
    // The status bar's own colour, from just left of the island.
    const bg = execFileSync("magick", [png, "-crop", "1x1+420+60", "-format", "#%[hex:p{0,0}]", "info:"]).toString().slice(0, 7);
    parts.push(`<rect x="${w / 2 - 200}" y="30" width="400" height="120" fill="${bg}"/>`);
  }
  for (const m of marks) {
    const [x, y, mw, mh] = (m.rect ?? m).map((v) => v * SCALE);
    const pad = 4 * SCALE;
    parts.push(`<rect x="${x - pad}" y="${y - pad}" width="${mw + 2 * pad}" height="${mh + 2 * pad}" rx="${Math.min(14 * SCALE, (mh + 2 * pad) / 2)}" fill="none" stroke="${RING}" stroke-width="${3.5 * SCALE}"/>`);
    if (m.label) {
      const text = label(lang, m.label);
      const size = 15 * SCALE;
      const tw = text.length * size * 0.55 + 24 * SCALE;
      const lx = Math.min(Math.max(x + mw / 2 - tw / 2, 12 * SCALE), w - tw - 12 * SCALE);
      const ly = y + mh + pad + 10 * SCALE;
      parts.push(`<rect x="${lx}" y="${ly}" width="${tw}" height="${size * 2}" rx="${size}" fill="${RING}"/>`);
      parts.push(`<text x="${lx + tw / 2}" y="${ly + size * 1.36}" font-family="-apple-system, SF Pro Text, Helvetica Neue, sans-serif" font-size="${size}" font-weight="600" fill="#fff" text-anchor="middle">${esc(text)}</text>`);
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<image width="${w}" height="${h}" xlink:href="data:image/png;base64,${fs.readFileSync(png).toString("base64")}"/>
${parts.join("\n")}
</svg>`;
  const svgPath = path.join(tmp, `${lang}-${name}.svg`);
  const full = path.join(tmp, `${lang}-${name}.png`);
  fs.writeFileSync(svgPath, svg);
  execFileSync("rsvg-convert", ["--unlimited", "-o", full, svgPath]);

  const app = path.join(APP_OUT, lang, `${name}.jpg`);
  const site = path.join(SITE_OUT, lang, `${name}.webp`);
  fs.mkdirSync(path.dirname(app), { recursive: true });
  fs.mkdirSync(path.dirname(site), { recursive: true });
  execFileSync("magick", [full, "-resize", `${WIDTH}x`, "-strip", "-quality", "80", app]);
  execFileSync("magick", [full, "-resize", `${WIDTH}x`, "-strip", "-quality", "80", site]);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kp-guide-"));
for (const lang of langs) {
  const marks = JSON.parse(fs.readFileSync(path.join(MARKS, `${lang}.json`), "utf8"));
  const names = fs.readdirSync(path.join(RAW, lang)).filter((f) => /^\d\d\.png$/.test(f)).map((f) => f.slice(0, 2)).sort();
  for (const name of names) {
    if (!marks[name]) throw new Error(`${lang}/${name}.png has no marks`);
    render(lang, name, marks[name], tmp);
  }
  console.log(`${lang}: ${names.length} pictures`);
}
fs.rmSync(tmp, { recursive: true, force: true });
