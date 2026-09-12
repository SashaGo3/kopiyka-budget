#!/usr/bin/env node
/* global Buffer */
/**
 * Kopiyka App Store screenshot framer.
 *
 * Turns the raw simulator captures under `screenshots/raw/` into finished, App Store
 * ready marketing screenshots under `screenshots/appstore/`.
 *
 * No npm dependencies. Every slide is built as an SVG (background, headline, subtitle,
 * a drawn device bezel, the raw PNG embedded as a base64 <image>) and rasterised with
 * `rsvg-convert`; `magick` flattens the alpha channel away, because App Store Connect
 * rejects PNGs with an alpha channel.
 *
 *   node scripts/screenshots/frame.mjs [flags]
 *
 *   --raw=<dir>        raw capture root           (default screenshots/raw)
 *   --out=<dir>        output root                (default screenshots/appstore)
 *   --shots=<file>     shot list                  (default screenshots/shots.json)
 *   --only=<id,id>     render only these ids (iPhone, extras or watch)
 *   --contact-sheet    also write <out>/contact-sheet.png (the numbered ten)
 *   --contact-sheet=all  ...with the extras appended
 *   --no-bare          skip the transparent <out>/bare set (it is built by default)
 *   --keep-svg         leave the intermediate .svg files next to the PNGs (debugging)
 *   --help
 *
 * Output: <out>/iphone-6.9, <out>/iphone-6.5, <out>/iphone-6.5-1242 (the numbered App Store set), <out>/extras/…
 * (unnumbered spares) and <out>/watch (raw screens, which is what watchOS wants).
 *
 * It also writes a fourth, non-App-Store set: <out>/bare/iphone/<id>.png and
 * <out>/bare/watch/<id>.png — the capture inside Apple's bezel on a TRANSPARENT canvas, with
 * no headline, no subtitle and no slide background. These are for the promo website
 * (site/build.mjs reads them), where the page supplies its own words and its own background,
 * so a slide's baked-in headline would only be the same sentence printed twice. They are the
 * one output that keeps its alpha channel; every App Store file stays flattened, because App
 * Store Connect rejects a PNG that carries alpha. `--no-bare` skips them.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOTS_DIR = path.resolve(HERE, "../../screenshots");
const FRAMES_DIR = path.join(SHOTS_DIR, "frames");

/* ------------------------------------------------------------------ binaries */

function findBin(name) {
  const candidates = [`/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  try {
    return execFileSync("/usr/bin/which", [name], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}
const RSVG = findBin("rsvg-convert");
const MAGICK = findBin("magick");

/* ---------------------------------------------------------------------- args */

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  const header = fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0];
  console.log(header.replace(/^#!.*\n/, "").replace(/^\/\*\*?\n?/, "").replace(/^ ?\* ?/gm, ""));
  process.exit(0);
}
/** Accepts both `--only=a,b` and `--only a,b`; a bare `--contact-sheet` reads as true. */
const flag = (name, fallback) => {
  const i = args.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i < 0) return fallback;
  const hit = args[i];
  if (hit.includes("=")) return hit.slice(hit.indexOf("=") + 1);
  const next = args[i + 1];
  return next && !next.startsWith("--") ? next : true;
};
const RAW_DIR = path.resolve(String(flag("raw", path.join(SHOTS_DIR, "raw"))));
const OUT_DIR = path.resolve(String(flag("out", path.join(SHOTS_DIR, "appstore"))));
const SHOTS_FILE = path.resolve(String(flag("shots", path.join(SHOTS_DIR, "shots.json"))));
const ONLY = flag("only", null);
const ONLY_SET = ONLY && ONLY !== true ? new Set(String(ONLY).split(",").map((s) => s.trim()).filter(Boolean)) : null;
const CONTACT_SHEET = flag("contact-sheet", false); // true = the numbered set, "all" = + extras
const KEEP_SVG = flag("keep-svg", false) === true;
const BARE = flag("no-bare", false) !== true; // the transparent website set, on unless opted out

/* -------------------------------------------------------------------- design */

/** Canvas sizes App Store Connect accepts for iPhone. Both are rendered from scratch,
 *  so type is laid out in the target coordinate space rather than resampled. */
const IPHONE_SIZES = [
  { dir: "iphone-6.9", w: 1320, h: 2868, label: '6.9" (iPhone 17 Pro Max)' },
  { dir: "iphone-6.5", w: 1284, h: 2778, label: '6.5" (iPhone 14 Plus / 11 Pro Max)' },
  { dir: "iphone-6.5-1242", w: 1242, h: 2688, label: '6.5" legacy (iPhone 11 Pro Max / XS Max)' },
];

/** Sizes App Store Connect accepts for Apple Watch, newest first. */
const WATCH_SIZES = [
  { w: 422, h: 514, label: "Ultra 3 (49 mm)" },
  { w: 416, h: 496, label: "Series 10 / 11 (46 mm)" },
  { w: 410, h: 502, label: "Ultra 2 (49 mm)" },
  { w: 396, h: 484, label: "Series 7–9 (45 mm)" },
  { w: 368, h: 448, label: "Series 4–6 / SE (44 mm)" },
];

const FONT = "-apple-system, 'SF Pro Display', 'Helvetica Neue', Helvetica, Arial, sans-serif";

/**
 * Apple's product bezels, and the boxes measured out of their own alpha channels.
 * `body` is the opaque bounding box (what `magick -trim` reports) and is what the layout sizes
 * against; `screen` is the transparent hole the capture is composited into. Full derivation and
 * the licence note live in screenshots/frames/README.md — re-measure if a PNG is ever swapped.
 */
const PHONE_FRAME = {
  file: "iphone-17-pro-max-silver.png",
  canvas: [1470, 3000],
  body: { x: 21, y: 20, w: 1428, h: 2959 },
  // Matches frameit's offsets.json ("iPhone 17 Pro Max" -> "+75+66", width 1320) and the raws.
  // r is a circular fit to Apple's squircle: tight enough to leave no gap inside the hole,
  // loose enough that the overshoot always lands under opaque bezel.
  screen: { x: 75, y: 66, w: 1320, h: 2868, r: 185 },
};
const WATCH_FRAME = {
  file: "watch-ultra-3-natural-milanese.png",
  canvas: [600, 960],
  body: { x: 34, y: 17, w: 561, h: 920 },
  screen: { x: 89, y: 223, w: 422, h: 514 },
  // The case, without the band that runs off both ends — used for the shadow.
  case: { y: 135, h: 655 },
};

/** Bezel thickness as a fraction of the device's outer width (drawn fallback only). */
const PHONE_BEZEL = 0.0295;
/** Devices start on the same line on every slide, so a row of ten reads as one system whether
 *  the headline is one line or three. Computed per set as the lowest text block plus a gap,
 *  never above this floor (fraction of canvas height). */
const DEVICE_TOP = 0.268;

/** Outer device height as a multiple of its outer width, and the inverse. */
const phoneHeightFor = (w) => w * (PHONE_FRAME.body.h / PHONE_FRAME.body.w);
const phoneWidthFor = (h) => h * (PHONE_FRAME.body.w / PHONE_FRAME.body.h);

const BRAND = {
  offwhite: "#F4F4F1",
  warm: "#ECEAE3",
  graphite: "#2B2B2E",
  ink: "#141413",
  gold: "#C8A96A",
  bezel: "#1C1C1E",
  titanium: "#8E8E93",
};

/* ------------------------------------------------------------------ png size */

/** Whichever of the relative and absolute path is shorter — keeps warnings readable when
 *  --raw points somewhere outside the repo. */
function short(file) {
  const rel = path.relative(process.cwd(), file);
  return rel.length < file.length && !rel.startsWith("../../") ? rel : file;
}

/** Reads width/height straight out of the IHDR chunk — no image library needed. */
function readPngSize(file) {
  const fd = fs.openSync(file, "r");
  const head = Buffer.alloc(33);
  fs.readSync(fd, head, 0, 33, 0);
  fs.closeSync(fd);
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!head.subarray(0, 8).equals(sig)) throw new Error(`${file} is not a PNG`);
  if (head.subarray(12, 16).toString("ascii") !== "IHDR") throw new Error(`${file}: no IHDR chunk`);
  return { w: head.readUInt32BE(16), h: head.readUInt32BE(20) };
}

/* ------------------------------------------------------------------- metrics */

/* Helvetica AFM advance widths (1/1000 em). Helvetica Neue is what fontconfig actually
   serves; its advances are within ~2% of Helvetica's, which is well inside the slack we
   need for line-breaking decisions. */
const W_REG = { " ": 278, "!": 278, '"': 355, "#": 556, $: 556, "%": 889, "&": 667, "'": 191, "(": 333, ")": 333, "*": 389, "+": 584, ",": 278, "-": 333, ".": 278, "/": 278, ":": 278, ";": 278, "<": 584, "=": 584, ">": 584, "?": 556, "@": 1015, "[": 278, "\\": 278, "]": 278, "^": 469, _: 556, "`": 333, "{": 334, "|": 260, "}": 334, "~": 584, A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 500, K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611, a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222, k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278, u: 556, v: 500, w: 722, x: 500, y: 500, z: 500 };
const W_BOLD = { " ": 278, "!": 333, '"': 474, "#": 556, $: 556, "%": 889, "&": 722, "'": 238, "(": 333, ")": 333, "*": 389, "+": 584, ",": 278, "-": 333, ".": 278, "/": 278, ":": 333, ";": 333, "<": 584, "=": 584, ">": 584, "?": 611, "@": 975, "[": 333, "\\": 278, "]": 333, "^": 584, _: 556, "`": 333, "{": 389, "|": 280, "}": 389, "~": 584, A: 722, B: 722, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 556, K: 722, L: 611, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611, a: 556, b: 611, c: 556, d: 611, e: 556, f: 333, g: 611, h: 611, i: 278, j: 278, k: 556, l: 278, m: 889, n: 611, o: 611, p: 611, q: 611, r: 389, s: 556, t: 333, u: 611, v: 556, w: 778, x: 556, y: 556, z: 500 };
const W_EXTRA = { "—": 1000, "–": 556, "…": 1000, "€": 556, "’": 222, "‘": 222, "“": 333, "”": 333, "·": 278 };

function textWidth(str, size, bold, tracking = 0) {
  const table = bold ? W_BOLD : W_REG;
  let units = 0;
  for (const ch of str) units += table[ch] ?? W_EXTRA[ch] ?? (bold ? 611 : 556);
  return (units / 1000) * size + tracking * Math.max(0, [...str].length - 1);
}

/** Honours manual `\n` breaks, then greedily wraps anything still too wide. */
function wrapText(text, maxWidth, size, bold, tracking = 0) {
  const out = [];
  for (const para of String(text).split("\n")) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) {
      out.push("");
      continue;
    }
    let line = words[0];
    for (const word of words.slice(1)) {
      const next = `${line} ${word}`;
      if (textWidth(next, size, bold, tracking) <= maxWidth) line = next;
      else {
        out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out;
}

/**
 * Greedy wrap, unless it leaves a runt on the last line ("…on every / row.") — then
 * re-wrap at the narrowest column that still fits in the same number of lines, which
 * evens the lines out. Only kicks in for real runts, so normal ragged-right text keeps
 * its full measure instead of being squeezed into a timid narrow column.
 */
const RUNT = 0.25;

function balancedWrap(text, maxWidth, size, bold, tracking = 0) {
  const target = wrapText(text, maxWidth, size, bold, tracking);
  if (target.length < 2) return target;
  const last = target[target.length - 1];
  if (textWidth(last, size, bold, tracking) > maxWidth * RUNT) return target;
  let lo = maxWidth * 0.45;
  let hi = maxWidth;
  let best = target;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    const cand = wrapText(text, mid, size, bold, tracking);
    if (cand.length <= target.length) {
      best = cand;
      hi = mid;
    } else lo = mid;
  }
  return best;
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/* --------------------------------------------------------------------- color */

function luminance(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return 1;
  const n = parseInt(m[1], 16);
  const lin = (c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}
const isDarkBg = (hex) => luminance(hex) < 0.35;

function shade(hex, amount) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const mix = (c) => Math.round(amount > 0 ? c + (255 - c) * amount : c * (1 + amount));
  const out = (mix((n >> 16) & 255) << 16) | (mix((n >> 8) & 255) << 8) | mix(n & 255);
  return `#${out.toString(16).padStart(6, "0")}`;
}

/* ---------------------------------------------------------------- device art */

function dataUri(file) {
  return `data:image/png;base64,${fs.readFileSync(file).toString("base64")}`;
}

/** Loads a bezel PNG once; returns null (and warns once) if it is not on disk. */
const frameCache = new Map();
function loadFrame(meta, warnings) {
  if (frameCache.has(meta.file)) return frameCache.get(meta.file);
  const file = path.join(FRAMES_DIR, meta.file);
  let href = null;
  if (fs.existsSync(file)) {
    const { w, h } = readPngSize(file);
    if (w !== meta.canvas[0] || h !== meta.canvas[1]) {
      warnings.push(`${meta.file} is ${w}x${h}, expected ${meta.canvas[0]}x${meta.canvas[1]} — geometry in frame.mjs will be wrong; re-measure per frames/README.md`);
    }
    href = dataUri(file);
  } else {
    warnings.push(`${short(file)} is missing — falling back to the drawn bezel`);
  }
  frameCache.set(meta.file, href);
  return href;
}

/** Real bezel where we have one, drawn bezel where we do not. */
const phone = (args) => (args.frameHref ? phoneFramed(args) : phoneDrawn(args));
const watchDevice = (args) => (args.frameHref ? watchFramed(args) : watchDrawn(args));

/**
 * Apple's own iPhone bezel with the capture composited into its screen hole.
 * `w` is the width of the device body (the frame PNG's opaque bounding box).
 *
 * Draw order is screenshot first, bezel PNG on top: the frame's opaque pixels then cover any
 * overshoot, so only the four hole-box corners — which fall outside the device silhouette —
 * need the rounded clip. See screenshots/frames/README.md for how the boxes were measured.
 */
function phoneFramed({ uid, x, y, w, href, frameHref }) {
  const f = PHONE_FRAME;
  const k = w / f.body.w;
  const h = f.body.h * k;
  const fx = x - f.body.x * k;
  const fy = y - f.body.y * k;
  const sx = x + (f.screen.x - f.body.x) * k;
  const sy = y + (f.screen.y - f.body.y) * k;
  const sw = f.screen.w * k;
  const sh = f.screen.h * k;
  const sr = f.screen.r * k;
  const shadowR = (f.screen.r + (f.screen.x - f.body.x)) * k;

  return {
    h,
    svg: `
  <g>
    <g filter="url(#f-shadow)">
      <rect x="${(x + w * 0.035).toFixed(2)}" y="${(y + h * 0.022).toFixed(2)}" width="${(w - w * 0.07).toFixed(2)}" height="${h.toFixed(2)}" rx="${shadowR.toFixed(2)}" fill="#000" opacity="0.34"/>
    </g>
    <clipPath id="clip-${uid}"><rect x="${sx.toFixed(2)}" y="${sy.toFixed(2)}" width="${sw.toFixed(2)}" height="${sh.toFixed(2)}" rx="${sr.toFixed(2)}"/></clipPath>
    <g clip-path="url(#clip-${uid})">
      <rect x="${sx.toFixed(2)}" y="${sy.toFixed(2)}" width="${sw.toFixed(2)}" height="${sh.toFixed(2)}" fill="#000"/>
      <image x="${sx.toFixed(2)}" y="${sy.toFixed(2)}" width="${sw.toFixed(2)}" height="${sh.toFixed(2)}" preserveAspectRatio="xMidYMin slice" href="${href}" xlink:href="${href}"/>
    </g>
    <image x="${fx.toFixed(2)}" y="${fy.toFixed(2)}" width="${(f.canvas[0] * k).toFixed(2)}" height="${(f.canvas[1] * k).toFixed(2)}" href="${frameHref}" xlink:href="${frameHref}"/>
  </g>`,
  };
}

/**
 * Apple's own Apple Watch Ultra 3 bezel (natural titanium, Milanese Loop) with the capture in
 * its screen hole. The hole's box corners sit under opaque case, so no clip is needed; the band
 * runs off both ends of the asset, so it is faded out rather than cut.
 * `w` is the width of the watch body.
 */
function watchFramed({ uid, x, y, w, href, frameHref }) {
  const f = WATCH_FRAME;
  const k = w / f.body.w;
  const h = f.body.h * k;
  const fx = x - f.body.x * k;
  const fy = y - f.body.y * k;
  const fw = f.canvas[0] * k;
  const fh = f.canvas[1] * k;
  const sx = x + (f.screen.x - f.body.x) * k;
  const sy = y + (f.screen.y - f.body.y) * k;
  const sw = f.screen.w * k;
  const sh = f.screen.h * k;
  // Case body, for the shadow: the band is much narrower and should not cast one.
  const cy = y + (f.case.y - f.body.y) * k;
  const ch = f.case.h * k;

  return {
    h,
    svg: `
  <g>
    <g filter="url(#f-shadow)">
      <rect x="${(x + w * 0.05).toFixed(2)}" y="${(cy + ch * 0.04).toFixed(2)}" width="${(w - w * 0.1).toFixed(2)}" height="${ch.toFixed(2)}" rx="${(w * 0.24).toFixed(2)}" fill="#000" opacity="0.42"/>
    </g>
    <rect x="${sx.toFixed(2)}" y="${sy.toFixed(2)}" width="${sw.toFixed(2)}" height="${sh.toFixed(2)}" fill="#000"/>
    <image x="${sx.toFixed(2)}" y="${sy.toFixed(2)}" width="${sw.toFixed(2)}" height="${sh.toFixed(2)}" preserveAspectRatio="xMidYMid slice" href="${href}" xlink:href="${href}"/>
    <image x="${fx.toFixed(2)}" y="${fy.toFixed(2)}" width="${fw.toFixed(2)}" height="${fh.toFixed(2)}" mask="url(#m-band-${uid})" href="${frameHref}" xlink:href="${frameHref}"/>
  </g>`,
    defs: `
    <linearGradient id="g-band-${uid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#000"/>
      <stop offset="0.1" stop-color="#fff"/>
      <stop offset="0.9" stop-color="#fff"/>
      <stop offset="1" stop-color="#000"/>
    </linearGradient>
    <mask id="m-band-${uid}" maskUnits="userSpaceOnUse" x="${fx.toFixed(2)}" y="${fy.toFixed(2)}" width="${fw.toFixed(2)}" height="${fh.toFixed(2)}">
      <rect x="${fx.toFixed(2)}" y="${fy.toFixed(2)}" width="${fw.toFixed(2)}" height="${fh.toFixed(2)}" fill="url(#g-band-${uid})"/>
    </mask>`,
  };
}

/* ------------------------------------------------------------- bare devices */

/**
 * The device on its own: Apple's bezel at its native canvas size, the capture in the screen
 * hole, and nothing else — no headline, no subtitle, no background, no drop shadow. The canvas
 * stays transparent so whatever places the image supplies its own background.
 *
 * Geometry is the same as phoneFramed/watchFramed, only without the layout scaling: the bezel
 * is drawn 1:1 at its own size, so the capture lands in the hole with no resampling at all.
 * The phone's black screen backing takes the same rounded clip as the capture: with a slide
 * background behind it the square corners of the hole box were invisible, but on a transparent
 * canvas they stick out past the device silhouette as four black notches.
 * Needs a real bezel PNG; there is no drawn fallback, because a drawn bezel on a transparent
 * canvas would advertise a phone Apple does not make.
 */
function bareSvg(kind, { href, frameHref }) {
  const f = kind === "watch" ? WATCH_FRAME : PHONE_FRAME;
  const [W, H] = f.canvas;
  const s = f.screen;
  const img = (extra) =>
    `<image x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" preserveAspectRatio="xMidYMid slice"${extra} href="${href}" xlink:href="${href}"/>`;

  // The Milanese band runs off the top and bottom of the watch asset. Cut flat against a slide
  // background that is nowhere to be seen, that reads as a broken image, so it fades to
  // transparent instead — the same treatment watchFramed gives it.
  const bandMask = kind === "watch";

  const defs = [
    kind === "watch"
      ? ""
      : `<clipPath id="bare-screen"><rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="${s.r}" ry="${s.r}"/></clipPath>`,
    bandMask
      ? `<linearGradient id="bare-band" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#000"/>
      <stop offset="0.08" stop-color="#fff"/>
      <stop offset="0.92" stop-color="#fff"/>
      <stop offset="1" stop-color="#000"/>
    </linearGradient>
    <mask id="bare-band-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}">
      <rect x="0" y="0" width="${W}" height="${H}" fill="url(#bare-band)"/>
    </mask>`
      : "",
  ]
    .filter(Boolean)
    .join("\n    ");

  return {
    W,
    H,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    ${defs}
  </defs>
  <rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" fill="#000"${kind === "watch" ? "" : ' clip-path="url(#bare-screen)"'}/>
  ${img(kind === "watch" ? "" : ' clip-path="url(#bare-screen)"')}
  <image x="0" y="0" width="${W}" height="${H}"${bandMask ? ' mask="url(#bare-band-mask)"' : ""} href="${frameHref}" xlink:href="${frameHref}"/>
</svg>`,
  };
}

/**
 * Fallback when a bezel PNG is missing: a drawn iPhone — near-black bezel, titanium edge
 * highlight, Dynamic Island, side buttons, the capture clipped to the screen's rounded rect.
 * `w` is the full outer width of the device; the screen fills the rest.
 */
function phoneDrawn({ uid, x, y, w, href, imgW, imgH }) {
  const bezel = w * PHONE_BEZEL;
  const sw = w - 2 * bezel;
  const sh = sw * (imgH / imgW);
  const srx = sw * 0.047; // 62 px at a 1320 px wide screen
  const orx = srx + bezel;
  const h = sh + 2 * bezel;
  const sx = x + bezel;
  const sy = y + bezel;

  // Dynamic Island, in screen-relative units (125 x 36.67 pt on a 440 pt wide screen).
  const iw = sw * 0.284;
  const ih = sw * 0.0834;
  const ix = sx + (sw - iw) / 2;
  const iy = sy + sw * 0.0255;

  const btn = (bx, by, bh, bw) =>
    `<rect x="${bx.toFixed(2)}" y="${by.toFixed(2)}" width="${bw.toFixed(2)}" height="${bh.toFixed(2)}" rx="${(bw / 2).toFixed(2)}" fill="url(#g-btn-${uid})"/>`;
  const bw = w * 0.0115;

  return {
    h,
    svg: `
  <g>
    <g filter="url(#f-shadow)">
      <rect x="${(x + w * 0.03).toFixed(2)}" y="${(y + h * 0.022).toFixed(2)}" width="${(w - w * 0.06).toFixed(2)}" height="${h.toFixed(2)}" rx="${orx.toFixed(2)}" fill="#000" opacity="0.34"/>
    </g>
    ${btn(x - bw * 0.66, y + h * 0.198, h * 0.05, bw)}
    ${btn(x - bw * 0.66, y + h * 0.278, h * 0.076, bw)}
    ${btn(x - bw * 0.66, y + h * 0.374, h * 0.076, bw)}
    ${btn(x + w - bw * 0.34, y + h * 0.292, h * 0.124, bw)}
    <rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" rx="${orx.toFixed(2)}" fill="url(#g-frame-${uid})"/>
    <rect x="${(x + w * 0.0028).toFixed(2)}" y="${(y + w * 0.0028).toFixed(2)}" width="${(w - w * 0.0056).toFixed(2)}" height="${(h - w * 0.0056).toFixed(2)}" rx="${(orx - w * 0.0028).toFixed(2)}" fill="none" stroke="rgba(255,255,255,0.22)" stroke-width="${(w * 0.0034).toFixed(2)}"/>
    <rect x="${(x + bezel * 0.78).toFixed(2)}" y="${(y + bezel * 0.78).toFixed(2)}" width="${(w - bezel * 1.56).toFixed(2)}" height="${(h - bezel * 1.56).toFixed(2)}" rx="${(orx - bezel * 0.78).toFixed(2)}" fill="none" stroke="rgba(0,0,0,0.88)" stroke-width="${(bezel * 0.46).toFixed(2)}"/>
    <clipPath id="clip-${uid}"><rect x="${sx.toFixed(2)}" y="${sy.toFixed(2)}" width="${sw.toFixed(2)}" height="${sh.toFixed(2)}" rx="${srx.toFixed(2)}"/></clipPath>
    <g clip-path="url(#clip-${uid})">
      <rect x="${sx.toFixed(2)}" y="${sy.toFixed(2)}" width="${sw.toFixed(2)}" height="${sh.toFixed(2)}" fill="#000"/>
      <image x="${sx.toFixed(2)}" y="${sy.toFixed(2)}" width="${sw.toFixed(2)}" height="${sh.toFixed(2)}" preserveAspectRatio="xMidYMin slice" href="${href}" xlink:href="${href}"/>
      <rect x="${ix.toFixed(2)}" y="${iy.toFixed(2)}" width="${iw.toFixed(2)}" height="${ih.toFixed(2)}" rx="${(ih / 2).toFixed(2)}" fill="#060607"/>
      <circle cx="${(ix + iw - ih * 0.5).toFixed(2)}" cy="${(iy + ih / 2).toFixed(2)}" r="${(ih * 0.185).toFixed(2)}" fill="#16161C"/>
    </g>
    <rect x="${sx.toFixed(2)}" y="${sy.toFixed(2)}" width="${sw.toFixed(2)}" height="${sh.toFixed(2)}" rx="${srx.toFixed(2)}" fill="none" stroke="rgba(255,255,255,0.09)" stroke-width="${(w * 0.0022).toFixed(2)}"/>
  </g>`,
  };
}

/**
 * Fallback when the watch bezel PNG is missing: a drawn Apple Watch Ultra — flat titanium case,
 * orange action button, digital crown. `w` is the case width.
 */
function watchDrawn({ uid, x, y, w, href, imgW, imgH }) {
  const padX = w * 0.083;
  const sw = w - 2 * padX;
  const sh = sw * (imgH / imgW);
  const padY = w * 0.062;
  const h = sh + 2 * padY;
  const rx = w * 0.245;
  const srx = sw * 0.27;
  const sx = x + padX;
  const sy = y + padY;
  const bw = w * 0.038;

  return {
    h,
    svg: `
  <g>
    <g filter="url(#f-shadow)">
      <rect x="${(x + w * 0.04).toFixed(2)}" y="${(y + h * 0.03).toFixed(2)}" width="${(w - w * 0.08).toFixed(2)}" height="${h.toFixed(2)}" rx="${rx.toFixed(2)}" fill="#000" opacity="0.4"/>
    </g>
    <rect x="${(x - bw * 0.55).toFixed(2)}" y="${(y + h * 0.305).toFixed(2)}" width="${bw.toFixed(2)}" height="${(h * 0.105).toFixed(2)}" rx="${(bw * 0.42).toFixed(2)}" fill="#D2622A"/>
    <rect x="${(x + w - bw * 0.45).toFixed(2)}" y="${(y + h * 0.255).toFixed(2)}" width="${(bw * 1.25).toFixed(2)}" height="${(h * 0.145).toFixed(2)}" rx="${(bw * 0.42).toFixed(2)}" fill="url(#g-crown-${uid})"/>
    <rect x="${(x + w - bw * 0.3).toFixed(2)}" y="${(y + h * 0.5).toFixed(2)}" width="${(bw * 0.72).toFixed(2)}" height="${(h * 0.115).toFixed(2)}" rx="${(bw * 0.3).toFixed(2)}" fill="#6E6E73"/>
    <rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" rx="${rx.toFixed(2)}" fill="url(#g-case-${uid})"/>
    <rect x="${(x + w * 0.007).toFixed(2)}" y="${(y + w * 0.007).toFixed(2)}" width="${(w - w * 0.014).toFixed(2)}" height="${(h - w * 0.014).toFixed(2)}" rx="${(rx - w * 0.007).toFixed(2)}" fill="none" stroke="rgba(255,255,255,0.45)" stroke-width="${(w * 0.006).toFixed(2)}"/>
    <rect x="${(x + w * 0.055).toFixed(2)}" y="${(y + w * 0.055).toFixed(2)}" width="${(w - w * 0.11).toFixed(2)}" height="${(h - w * 0.11).toFixed(2)}" rx="${(rx - w * 0.055).toFixed(2)}" fill="#08080A"/>
    <rect x="${(x + w * 0.055).toFixed(2)}" y="${(y + w * 0.055).toFixed(2)}" width="${(w - w * 0.11).toFixed(2)}" height="${(h - w * 0.11).toFixed(2)}" rx="${(rx - w * 0.055).toFixed(2)}" fill="none" stroke="rgba(0,0,0,0.6)" stroke-width="${(w * 0.014).toFixed(2)}"/>
    <clipPath id="wclip-${uid}"><rect x="${sx.toFixed(2)}" y="${sy.toFixed(2)}" width="${sw.toFixed(2)}" height="${sh.toFixed(2)}" rx="${srx.toFixed(2)}"/></clipPath>
    <g clip-path="url(#wclip-${uid})">
      <rect x="${sx.toFixed(2)}" y="${sy.toFixed(2)}" width="${sw.toFixed(2)}" height="${sh.toFixed(2)}" fill="#000"/>
      <image x="${sx.toFixed(2)}" y="${sy.toFixed(2)}" width="${sw.toFixed(2)}" height="${sh.toFixed(2)}" preserveAspectRatio="xMidYMid slice" href="${href}" xlink:href="${href}"/>
    </g>
  </g>`,
  };
}

/* ---------------------------------------------------------------- slide text */

function textBlock({ shot, W, H, x, maxWidth, top, color, sub, accent, align = "start" }) {
  const titleSize = W * 0.0855;
  const titleTrack = -titleSize * 0.022;
  const titleLead = titleSize * 1.07;
  const subSize = W * 0.0394;
  const subLead = subSize * 1.36;

  const ruleW = W * 0.062;
  const ruleH = Math.max(3, W * 0.0046);
  const ruleGap = W * 0.038;

  const titleLines = balancedWrap(shot.title ?? "", maxWidth, titleSize, true, titleTrack);
  const subLines = shot.subtitle ? balancedWrap(shot.subtitle, maxWidth, subSize, false, 0) : [];

  const anchor = align === "middle" ? "middle" : "start";
  const tx = align === "middle" ? x + maxWidth / 2 : x;
  const rx = align === "middle" ? tx - ruleW / 2 : x;

  let parts = [
    `<rect x="${rx.toFixed(2)}" y="${top.toFixed(2)}" width="${ruleW.toFixed(2)}" height="${ruleH.toFixed(2)}" rx="${(ruleH / 2).toFixed(2)}" fill="${accent}"/>`,
  ];

  let y = top + ruleH + ruleGap + titleSize * 0.78;
  for (const line of titleLines) {
    parts.push(
      `<text x="${tx.toFixed(2)}" y="${y.toFixed(2)}" text-anchor="${anchor}" font-family="${FONT}" font-size="${titleSize.toFixed(2)}" font-weight="700" letter-spacing="${titleTrack.toFixed(2)}" fill="${color}">${esc(line)}</text>`,
    );
    y += titleLead;
  }
  y -= titleLead;
  let bottom = y + titleSize * 0.24;

  if (subLines.length) {
    // One clear beat between the headline's last baseline and the subtitle's first.
    let sy = y + titleSize * 0.62 + subSize * 0.92;
    for (const line of subLines) {
      parts.push(
        `<text x="${tx.toFixed(2)}" y="${sy.toFixed(2)}" text-anchor="${anchor}" font-family="${FONT}" font-size="${subSize.toFixed(2)}" font-weight="400" fill="${sub}">${esc(line)}</text>`,
      );
      sy += subLead;
    }
    bottom = sy - subLead + subSize * 0.3;
  }

  return { svg: parts.join("\n    "), bottom };
}

/** Where the devices start, shared by a whole set: below the tallest text block in it, and never
 *  above the DEVICE_TOP floor. Computed over the full list so --only renders identical slides. */
function deviceTopFor(list, W, H) {
  const mx = W * 0.085;
  let lowest = 0;
  for (const shot of list) {
    const t = textBlock({ shot, W, H, x: mx, maxWidth: W - 2 * mx, top: H * 0.062, color: "#000", sub: "#000", accent: "#000" });
    lowest = Math.max(lowest, t.bottom);
  }
  return Math.max(DEVICE_TOP * H, lowest + H * 0.038);
}

/* --------------------------------------------------------------- slide build */

function buildSlide({ shot, W, H, phoneImg, watchImg, deviceTop, frames }) {
  const uid = `${shot.id}-${W}`;
  const bg = shot.bg || (shot.theme === "dark" ? BRAND.ink : BRAND.offwhite);
  const dark = isDarkBg(bg);
  const fg = shot.fg || (dark ? BRAND.offwhite : BRAND.graphite);
  const sub = shot.sub || (dark ? shade(BRAND.offwhite, -0.38) : shade(BRAND.graphite, 0.36));
  const accent = shot.accent || BRAND.gold;

  const mx = W * 0.085;
  const topPad = H * 0.062;
  const maxTextW = W - 2 * mx;

  // Definitions a device needs to contribute (the watch band's fade mask), filled in below.
  const extraDefs = [];

  const defs = () => `
  <defs>${extraDefs.join("")}
    <linearGradient id="g-bg-${uid}" x1="0" y1="0" x2="0.35" y2="1">
      <stop offset="0" stop-color="${shade(bg, dark ? 0.055 : 0.04)}"/>
      <stop offset="0.55" stop-color="${bg}"/>
      <stop offset="1" stop-color="${shade(bg, dark ? -0.18 : -0.045)}"/>
    </linearGradient>
    <linearGradient id="g-frame-${uid}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#3A3A3E"/>
      <stop offset="0.08" stop-color="${BRAND.bezel}"/>
      <stop offset="0.9" stop-color="#101012"/>
      <stop offset="1" stop-color="#2F2F33"/>
    </linearGradient>
    <linearGradient id="g-btn-${uid}" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#4A4A4F"/>
      <stop offset="1" stop-color="#1E1E21"/>
    </linearGradient>
    <linearGradient id="g-case-${uid}" x1="0.05" y1="0" x2="0.95" y2="1">
      <stop offset="0" stop-color="#E3E3E7"/>
      <stop offset="0.34" stop-color="#BDBDC2"/>
      <stop offset="0.7" stop-color="#9B9BA0"/>
      <stop offset="1" stop-color="#6B6B70"/>
    </linearGradient>
    <linearGradient id="g-crown-${uid}" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#A5A5AA"/>
      <stop offset="1" stop-color="#6A6A6F"/>
    </linearGradient>
    <filter id="f-shadow" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="${(W * 0.021).toFixed(2)}"/>
    </filter>
  </defs>`;

  const body = [];
  body.push(`<rect width="${W}" height="${H}" fill="url(#g-bg-${uid})"/>`);

  const layout = shot.layout || "phone";

  if (layout === "phone-watch") {
    const text = textBlock({ shot, W, H, x: mx, maxWidth: maxTextW, top: topPad, color: fg, sub, accent });
    body.push(text.svg);

    // Devices bleed a little wider than the text column: phone left, watch just in front of
    // its right edge, so the watch's action button lands on the case side rather than the screen.
    const gx = W * 0.05;
    const avail = H - deviceTop - H * 0.05;

    const pw = Math.min(W * 0.57, phoneWidthFor(avail));
    const ph = phoneHeightFor(pw);
    const py = deviceTop; // same start line as every other slide
    const p = phone({ uid: `p-${uid}`, x: gx, y: py, w: pw, href: phoneImg.href, frameHref: frames.phone, imgW: phoneImg.w, imgH: phoneImg.h });

    const ww = W * 0.34;
    const probe = watchDevice({ uid: `w-${uid}`, x: 0, y: 0, w: ww, href: watchImg.href, frameHref: frames.watch, imgW: watchImg.w, imgH: watchImg.h });
    const wx = W - W * 0.035 - ww;
    const wy = py + ph * 0.62 - probe.h / 2;
    const wd = watchDevice({ uid: `w-${uid}`, x: wx, y: wy, w: ww, href: watchImg.href, frameHref: frames.watch, imgW: watchImg.w, imgH: watchImg.h });
    if (wd.defs) extraDefs.push(wd.defs);

    body.push(p.svg);
    body.push(wd.svg);
  } else {
    const text = textBlock({ shot, W, H, x: mx, maxWidth: maxTextW, top: topPad, color: fg, sub, accent });
    body.push(text.svg);

    const noteSize = W * 0.0318;
    const noteBand = shot.note ? noteSize * 3.2 : 0;

    let pw;
    if (layout === "phone-bottom") {
      // Anchored to the bottom edge and cropped by it — the classic App Store look.
      pw = W * 0.795;
    } else {
      const avail = H - deviceTop - H * 0.045 - noteBand;
      pw = Math.min(W * 0.735, phoneWidthFor(avail));
    }
    const px = (W - pw) / 2;
    const p = phone({ uid: `p-${uid}`, x: px, y: deviceTop, w: pw, href: phoneImg.href, frameHref: frames.phone, imgW: phoneImg.w, imgH: phoneImg.h });
    body.push(p.svg);

    if (shot.note) {
      const lines = balancedWrap(shot.note, W - 2 * mx * 0.72, noteSize, false, 0);
      let ny = H - H * 0.045 - (lines.length - 1) * noteSize * 1.36;
      for (const line of lines) {
        body.push(
          `<text x="${(W / 2).toFixed(2)}" y="${ny.toFixed(2)}" text-anchor="middle" font-family="${FONT}" font-size="${noteSize.toFixed(2)}" font-weight="500" fill="${sub}">${esc(line)}</text>`,
        );
        ny += noteSize * 1.36;
      }
    }
  }

  return {
    bg,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${defs()}
  ${body.join("\n  ")}
</svg>`,
  };
}

/* ------------------------------------------------------------------- raster */

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "kopiyka-frame-"));

function rasterize(svg, { W, H, out, bg, tag }) {
  const svgPath = KEEP_SVG ? out.replace(/\.png$/, ".svg") : path.join(TMP, `${tag}.svg`);
  fs.writeFileSync(svgPath, svg);
  const rawPng = path.join(TMP, `${tag}.png`);
  execFileSync(RSVG, ["-w", String(W), "-h", String(H), "-b", bg, "--format", "png", "-o", rawPng, svgPath], { stdio: "pipe" });
  // App Store Connect rejects PNGs that carry an alpha channel.
  execFileSync(MAGICK, [rawPng, "-background", bg, "-flatten", "-alpha", "off", "-colorspace", "sRGB", "-strip", out], { stdio: "pipe" });
  fs.rmSync(rawPng, { force: true });
  if (!KEEP_SVG) fs.rmSync(svgPath, { force: true });
}

/** The bare set is the one output that must KEEP its alpha, so it never goes near -flatten. */
function rasterizeAlpha(svg, { W, H, out, tag }) {
  const svgPath = KEEP_SVG ? out.replace(/\.png$/, ".svg") : path.join(TMP, `${tag}.svg`);
  fs.writeFileSync(svgPath, svg);
  const rawPng = path.join(TMP, `${tag}.png`);
  execFileSync(RSVG, ["-w", String(W), "-h", String(H), "--format", "png", "-o", rawPng, svgPath], { stdio: "pipe" });
  execFileSync(MAGICK, [rawPng, "-strip", "-define", "png:compression-level=9", out], { stdio: "pipe" });
  fs.rmSync(rawPng, { force: true });
  if (!KEEP_SVG) fs.rmSync(svgPath, { force: true });
}

function verify(file, W, H, { alpha = false } = {}) {
  const out = execFileSync(MAGICK, ["identify", "-format", "%w %h %[channels]", file], { encoding: "utf8" }).trim();
  const [w, h, channels] = out.split(/\s+/);
  const hasAlpha = /a$/.test(channels);
  const ok = Number(w) === W && Number(h) === H && hasAlpha === alpha;
  return { ok, detail: `${w}x${h} ${channels}` };
}

/* --------------------------------------------------------------------- main */

function main() {
  if (!RSVG) throw new Error("rsvg-convert not found (brew install librsvg)");
  if (!MAGICK) throw new Error("magick not found (brew install imagemagick)");
  if (!fs.existsSync(SHOTS_FILE)) throw new Error(`shot list not found: ${SHOTS_FILE}`);

  const shots = JSON.parse(fs.readFileSync(SHOTS_FILE, "utf8"));
  const watchShots = (shots.watch || []).filter((s) => !ONLY_SET || ONLY_SET.has(s.id));

  console.log(`raw   ${RAW_DIR}`);
  console.log(`out   ${OUT_DIR}`);
  console.log(`shots ${SHOTS_FILE}\n`);

  const warnings = [];
  const frames = { phone: loadFrame(PHONE_FRAME, warnings), watch: loadFrame(WATCH_FRAME, warnings) };
  const madeSixNine = [];
  const madeExtras = [];

  const watchCache = new Map();
  const loadWatch = (id) => {
    if (watchCache.has(id)) return watchCache.get(id);
    const file = path.join(RAW_DIR, "watch", `${id}.png`);
    if (!fs.existsSync(file)) {
      watchCache.set(id, null);
      return null;
    }
    const { w, h } = readPngSize(file);
    const entry = { href: dataUri(file), w, h, file };
    watchCache.set(id, entry);
    return entry;
  };

  /**
   * Renders one set of iPhone slides at both canvas sizes. `numbered` prefixes the App Store
   * order; extras keep their bare id and land under extras/ so they never join the upload set.
   */
  function renderSet(list, { subdir = "", numbered = true, collect = null }) {
    if (!list.length) return;
    const tops = new Map(IPHONE_SIZES.map((s) => [s.dir, deviceTopFor(list, s.w, s.h)]));
    for (const size of IPHONE_SIZES) fs.mkdirSync(path.join(OUT_DIR, subdir, size.dir), { recursive: true });

    for (const [i, shot] of list.entries()) {
      if (ONLY_SET && !ONLY_SET.has(shot.id)) continue;
      const name = numbered ? `${String(i + 1).padStart(2, "0")}-${shot.id}` : shot.id;
      const theme = shot.theme === "dark" ? "dark" : "light";
      const rawFile = path.join(RAW_DIR, "iphone", theme, `${shot.id}.png`);
      if (!fs.existsSync(rawFile)) {
        warnings.push(`skip ${name}: missing raw ${short(rawFile)}`);
        continue;
      }
      const { w: iw, h: ih } = readPngSize(rawFile);
      if (iw !== PHONE_FRAME.screen.w || ih !== PHONE_FRAME.screen.h) {
        warnings.push(`note ${name}: raw is ${iw}x${ih}, expected ${PHONE_FRAME.screen.w}x${PHONE_FRAME.screen.h} (framed anyway)`);
      }
      const phoneImg = { href: dataUri(rawFile), w: iw, h: ih };

      let watchImg = null;
      if (shot.layout === "phone-watch") {
        watchImg = loadWatch(shot.watch || shot.id);
        if (!watchImg) {
          warnings.push(`skip ${name}: missing raw watch shot "${shot.watch || shot.id}"`);
          continue;
        }
      }

      for (const size of IPHONE_SIZES) {
        const rel = path.join(subdir, size.dir, `${name}.png`);
        const out = path.join(OUT_DIR, rel);
        const { svg, bg } = buildSlide({ shot, W: size.w, H: size.h, phoneImg, watchImg, deviceTop: tops.get(size.dir), frames });
        rasterize(svg, { W: size.w, H: size.h, out, bg, tag: `${name}-${size.w}` });
        const v = verify(out, size.w, size.h);
        console.log(`${v.ok ? "ok  " : "BAD "} ${rel}  ${v.detail}`);
        if (!v.ok) warnings.push(`${out} is ${v.detail}`);
        if (collect && size.dir === "iphone-6.9") collect.push(out);
      }
    }
  }

  renderSet(shots.iphone || [], { collect: madeSixNine });
  if ((shots.extras || []).length) {
    console.log("");
    renderSet(shots.extras, { subdir: "extras", numbered: false, collect: madeExtras });
  }

  /* ------------------------------------------------------------- watch */
  if (watchShots.length) {
    const watchOut = path.join(OUT_DIR, "watch");
    fs.mkdirSync(watchOut, { recursive: true });
    console.log("");
    for (const [i, shot] of (shots.watch || []).entries()) {
      if (!watchShots.includes(shot)) continue;
      const nn = String(i + 1).padStart(2, "0");
      const rawFile = path.join(RAW_DIR, "watch", `${shot.id}.png`);
      if (!fs.existsSync(rawFile)) {
        warnings.push(`skip watch/${nn}-${shot.id}: missing raw ${short(rawFile)}`);
        continue;
      }
      const { w, h } = readPngSize(rawFile);
      const slot = WATCH_SIZES.find((s) => s.w === w && s.h === h);
      if (!slot) {
        const accepted = WATCH_SIZES.map((s) => `${s.w}x${s.h} ${s.label}`).join(", ");
        throw new Error(`watch/${shot.id}.png is ${w}x${h}, which App Store Connect does not accept. Accepted: ${accepted}`);
      }
      const out = path.join(watchOut, `${nn}-${shot.id}.png`);
      execFileSync(MAGICK, [rawFile, "-background", "black", "-flatten", "-alpha", "off", "-colorspace", "sRGB", "-strip", out], { stdio: "pipe" });
      const v = verify(out, w, h);
      console.log(`${v.ok ? "ok  " : "BAD "} watch/${nn}-${shot.id}.png  ${v.detail}  -> ${slot.w}x${slot.h} ${slot.label}`);
      if (!v.ok) warnings.push(`${out} is ${v.detail}`);
    }
  }

  /* -------------------------------------------------------- bare set */
  /**
   * The website set: one PNG per shot, device only, transparent everywhere else. Flat ids
   * rather than the App Store's numbering, because the page decides the order and the words.
   */
  function renderBare() {
    const phoneShots = [...(shots.iphone || []), ...(shots.extras || [])];
    const outPhone = path.join(OUT_DIR, "bare", "iphone");
    const outWatch = path.join(OUT_DIR, "bare", "watch");
    if (!frames.phone) {
      warnings.push("bare iPhone set skipped: no bezel PNG (there is no drawn fallback for it)");
    } else {
      fs.mkdirSync(outPhone, { recursive: true });
      console.log("");
      for (const shot of phoneShots) {
        if (ONLY_SET && !ONLY_SET.has(shot.id)) continue;
        const theme = shot.theme === "dark" ? "dark" : "light";
        const rawFile = path.join(RAW_DIR, "iphone", theme, `${shot.id}.png`);
        if (!fs.existsSync(rawFile)) {
          warnings.push(`skip bare/iphone/${shot.id}: missing raw ${short(rawFile)}`);
          continue;
        }
        const { W, H, svg } = bareSvg("phone", { href: dataUri(rawFile), frameHref: frames.phone });
        const out = path.join(outPhone, `${shot.id}.png`);
        rasterizeAlpha(svg, { W, H, out, tag: `bare-${shot.id}` });
        const v = verify(out, W, H, { alpha: true });
        console.log(`${v.ok ? "ok  " : "BAD "} bare/iphone/${shot.id}.png  ${v.detail}`);
        if (!v.ok) warnings.push(`${out} is ${v.detail}, expected ${W}x${H} with alpha`);
      }
    }

    if (!frames.watch) {
      warnings.push("bare watch set skipped: no bezel PNG (there is no drawn fallback for it)");
      return;
    }
    fs.mkdirSync(outWatch, { recursive: true });
    for (const shot of shots.watch || []) {
      if (ONLY_SET && !ONLY_SET.has(shot.id)) continue;
      const rawFile = path.join(RAW_DIR, "watch", `${shot.id}.png`);
      if (!fs.existsSync(rawFile)) {
        warnings.push(`skip bare/watch/${shot.id}: missing raw ${short(rawFile)}`);
        continue;
      }
      const { W, H, svg } = bareSvg("watch", { href: dataUri(rawFile), frameHref: frames.watch });
      const out = path.join(outWatch, `${shot.id}.png`);
      rasterizeAlpha(svg, { W, H, out, tag: `bare-watch-${shot.id}` });
      const v = verify(out, W, H, { alpha: true });
      console.log(`${v.ok ? "ok  " : "BAD "} bare/watch/${shot.id}.png  ${v.detail}`);
      if (!v.ok) warnings.push(`${out} is ${v.detail}, expected ${W}x${H} with alpha`);
    }
  }

  if (BARE) renderBare();

  /* ----------------------------------------------------- contact sheet */
  if (CONTACT_SHEET) {
    // The numbered ten only, unless --contact-sheet=all also pulls in the extras.
    const sheet = CONTACT_SHEET === "all" ? [...madeSixNine, ...madeExtras] : madeSixNine;
    if (!sheet.length) {
      warnings.push("contact sheet skipped: nothing rendered");
    } else {
      const out = path.join(OUT_DIR, "contact-sheet.png");
      execFileSync(
        MAGICK,
        [...sheet, "-resize", "x900", "-bordercolor", "#D8D6D0", "-border", "2", "-background", "#FFFFFF", "+append", "-bordercolor", "#FFFFFF", "-border", "24", "-alpha", "off", "-strip", out],
        { stdio: "pipe" },
      );
      const dims = execFileSync(MAGICK, ["identify", "-format", "%wx%h", out], { encoding: "utf8" });
      console.log(`\nok   contact-sheet.png  ${dims}  (${sheet.length} slides${CONTACT_SHEET === "all" ? ", extras included" : ""})`);
    }
  }

  if (warnings.length) {
    console.log("");
    for (const w of warnings) console.warn(`warn ${w}`);
  }
  fs.rmSync(TMP, { recursive: true, force: true });
}

try {
  main();
} catch (err) {
  fs.rmSync(TMP, { recursive: true, force: true });
  console.error(`\nframe.mjs: ${err.message}`);
  process.exit(1);
}
