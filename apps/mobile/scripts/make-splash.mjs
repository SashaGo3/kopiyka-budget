#!/usr/bin/env node
/**
 * Regenerates the launch screen's silhouette of the Transactions screen: the shapes the first
 * screen is made of — header, pills, totals, days of rows, the floating buttons and the tab bar —
 * with no text in them, in the default theme's colours, light and dark. Run it after the
 * Transactions layout changes; no asset here is hand-edited.
 *
 *   node scripts/make-splash.mjs
 *
 * Needs `rsvg-convert` on PATH (brew install librsvg).
 *
 * A launch screen is one static layout for every device, so the silhouette is cut into pieces that
 * are each anchored the way the real thing is (plugins/withSilhouetteLaunchScreen.js lays them out):
 *
 *   iPhone  `SplashTop` under the status bar and `SplashBottom` (floating buttons, tab bar) at the
 *           bottom, each scaled to the screen's width.
 *   iPad    the tab bar centred at the top with the large title at the left edge and Select at the
 *           right, the content in its centred 780 pt column (constants/layout.ts), and the floating
 *           buttons stacked in the bottom-right corner — all at their real size, so portrait and
 *           landscape both line up.
 *
 * Each image set exists for one idiom only (`iphone` or `ipad`); on the other device it resolves to
 * nothing and its view stays empty, which is how one storyboard carries both layouts.
 *
 * Only the default theme: the launch screen is drawn by iOS before any code runs, so it cannot know
 * which theme was chosen. Shapes are translucent fills over transparency, so the background colour
 * shows through exactly as the app's own fills do over its page and cards.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "assets/splash");

/** Every image, its size in points and the idiom it is for. The plugin reads this list. */
export const IMAGES = {
  SplashTop: { w: 402, h: 720, idiom: "iphone" },
  SplashBottom: { w: 402, h: 180, idiom: "iphone" },
  SplashPadTabs: { w: 477, h: 44, idiom: "ipad" },
  SplashPadTitle: { w: 210, h: 34, idiom: "ipad" },
  SplashPadSelect: { w: 64, h: 44, idiom: "ipad" },
  SplashPadColumn: { w: 780, h: 1400, idiom: "ipad" },
  SplashPadButtons: { w: 200, h: 180, idiom: "ipad" },
};

// Graphite (packages/core/src/themes.ts) and the iOS system fills it draws with.
const SIDES = {
  light: { card: "#FFFFFF", fill: ["#767680", 0.12], accent: ["#2B2B2E", 0.28], separator: ["#3C3C43", 0.18] },
  dark: { card: "#1F1F1E", fill: ["#767680", 0.24], accent: ["#F4F4F1", 0.16], separator: ["#545458", 0.4] },
};

const rect = (x, y, w, h, r, [color, opacity]) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${color}" fill-opacity="${opacity}"/>`;

/**
 * The content of the list from the period pills down, `w` wide (16 pt gutters inside it), starting
 * at `y`: the pills, the Income/Expenses pair, then days of rows as `TransactionList` draws them.
 */
function content(s, w, y, days, accountsPill = 160) {
  const card = [s.card, 1];
  const out = [];
  out.push(rect(16, y, 146, 36, 18, card)); // period pill
  out.push(rect(w - 16 - accountsPill, y, accountsPill, 36, 18, card)); // accounts pill
  const statY = y + 46;
  const statW = (w - 32 - 12) / 2;
  for (const x of [16, 16 + statW + 12]) {
    out.push(rect(x, statY, statW, 70, 14, card));
    out.push(rect(x + 12, statY + 14, 70, 11, 5, s.fill));
    out.push(rect(x + 12, statY + 35, 112, 24, 6, s.fill));
  }
  y = statY + 88;
  for (const [rows, heading] of days) {
    out.push(rect(24, y + 10, heading, 18, 6, s.fill));
    const cardY = y + 40;
    out.push(rect(16, cardY, w - 32, rows * 62, 14, card));
    for (let i = 0; i < rows; i++) {
      const r = cardY + i * 62;
      if (i > 0) out.push(rect(74, r, w - 16 - 74, 0.5, 0, s.separator));
      out.push(rect(28, r + 14, 34, 34, 10, s.fill)); // icon
      out.push(rect(74, r + 16, 120 + ((i * 37) % 60), 15, 6, s.fill)); // title
      out.push(rect(74, r + 38, 70 + ((i * 23) % 40), 11, 5, s.fill)); // account
      const chevron = w - 16 - 12 - 7;
      out.push(rect(chevron, r + 25, 7, 12, 3, s.fill));
      const right = chevron - 12;
      out.push(rect(right - 40, r + 14, 40, 11, 5, s.fill)); // time
      const amount = 78 + ((i * 9) % 24);
      out.push(rect(right - amount, r + 31, amount, 22, 8, s.fill)); // amount pill
    }
    out.push(rect(24, cardY + rows * 62 + 10, 110, 12, 5, s.fill)); // sum
    y = cardY + rows * 62 + 30;
  }
  return out;
}

const draw = {
  /** iPhone, y = 0 is the safe area's top: Select, the large title, then the list. */
  SplashTop: (s, { w }) => [
    rect(w - 16 - 64, 6, 64, 44, 22, [s.card, 1]),
    rect(18, 76, 210, 34, 8, s.fill),
    ...content(s, w, 128, [[2, 74], [3, 110]]),
  ],
  /** iPhone, y = h is the bottom of the screen: BottomBar 96 pt up, the iOS 26 tab bar 23 pt up. */
  SplashBottom: (s, { w, h }) => {
    const card = [s.card, 1];
    const out = [];
    const barY = h - 96 - 56;
    out.push(rect(16, barY, 56, 56, 28, card)); // filter
    out.push(rect(82, barY, 56, 56, 28, card)); // sort
    out.push(rect(148, barY, 204, 56, 28, s.accent)); // Log
    const tabY = h - 23 - 66;
    const tabsW = w - 24 - 24 - 66 - 8;
    out.push(rect(24, tabY, tabsW, 66, 33, card));
    for (let i = 0; i < 4; i++) {
      const cx = 24 + 8 + ((tabsW - 16) / 4) * (i + 0.5);
      out.push(rect(cx - 13, tabY + 11, 26, 26, 7, s.fill));
      out.push(rect(cx - 26, tabY + 44, 52, 9, 4, s.fill));
    }
    out.push(rect(w - 24 - 66, tabY, 66, 66, 33, card)); // search
    return out;
  },
  /** iPad's tab bar sits at the top, centred: four tabs as pills of their own, then search. */
  SplashPadTabs: (s, { w, h }) => {
    const out = [rect(0, 0, w, h, h / 2, [s.card, 1])];
    out.push(rect(6, 5, 110, h - 10, (h - 10) / 2, s.fill)); // the selected tab
    for (const [x, tw] of [[136, 64], [222, 62], [302, 68]]) out.push(rect(x, 15, tw, 14, 6, s.fill));
    out.push(rect(w - 38, 13, 18, 18, 9, s.fill)); // search
    return out;
  },
  SplashPadTitle: (s, { w, h }) => [rect(0, 0, w, h, 8, s.fill)],
  SplashPadSelect: (s, { w, h }) => [rect(0, 0, w, h, h / 2, [s.card, 1])],
  /** The centred column from the period pills down; tall enough to fill a portrait 13-inch iPad. */
  SplashPadColumn: (s, { w }) => content(s, w, 0, [[3, 74], [6, 110], [5, 96]], 120),
  /** Filter, sort and Log stacked at the right edge, Log at the bottom (`BottomBar` on iPad). */
  SplashPadButtons: (s, { w }) => [
    rect(0, 0, w, 52, 26, [s.card, 1]),
    rect(0, 62, w, 52, 26, [s.card, 1]),
    rect(0, 124, w, 56, 28, s.accent),
  ],
};

const svg = (w, h, shapes) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${shapes.join("")}</svg>`;

function imageset(name, size) {
  const dir = resolve(OUT, `${name}.imageset`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const images = [];
  // An iPhone renders at 2× or 3×, an iPad at 2× only.
  const scales = size.idiom === "ipad" ? [2] : [2, 3];
  for (const [side, s] of Object.entries(SIDES)) {
    const tmp = resolve(dir, `${side}.svg`);
    writeFileSync(tmp, svg(size.w, size.h, draw[name](s, size)));
    for (const scale of scales) {
      const file = `${name}-${side}@${scale}x.png`;
      execFileSync("rsvg-convert", ["-w", String(size.w * scale), "-h", String(size.h * scale), "-o", resolve(dir, file), tmp]);
      images.push({ idiom: size.idiom, filename: file, scale: `${scale}x`, ...(side === "dark" ? { appearances: [{ appearance: "luminosity", value: "dark" }] } : {}) });
    }
    rmSync(tmp);
  }
  writeFileSync(resolve(dir, "Contents.json"), JSON.stringify({ images, info: { version: 1, author: "make-splash" } }, null, 2) + "\n");
  console.log(`${name}: ${size.w}×${size.h} pt (${size.idiom})`);
}

for (const [name, size] of Object.entries(IMAGES)) imageset(name, size);
