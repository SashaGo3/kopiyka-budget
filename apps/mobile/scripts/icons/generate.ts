#!/usr/bin/env bun
/**
 * The alternate app icons, one per colour theme: the same extruded К as the primary icon
 * (assets/images/kopiyka.svg, itself drawn by scripts/make-icons.mjs), recoloured from the theme's
 * dark side. The geometry is read from that SVG rather than redrawn, so the alternates can never
 * drift from the real icon's shape.
 *
 *   bun scripts/icons/generate.ts        (from apps/mobile; or `bun run icons:themes`)
 *
 * Writes assets/icons/<id>.png (1024², what plugins/withAppIcons.js puts into the app as
 * AppIcon-<id>) and assets/icons/preview/<id>.png (180², for the in-app picker). The default theme
 * has no 1024 file: it is the primary icon, and choosing it resets to that; its preview is drawn
 * from kopiyka.svg unchanged. Theme ids name the icons
 * and are forever (packages/core/src/themes.ts), so a file here is never renamed either.
 *
 * Needs `rsvg-convert` on PATH (brew install librsvg) — the same as make-icons.mjs; `magick`, when
 * present, drops the alpha channel the rasteriser always writes, since an icon has no transparency.
 *
 * Colours: background = dark.bg; letter = dark.accent, or dark.text when the accent is under 3:1
 * against the background (WCAG contrast for graphics); extrusion = 35% of the way from the
 * background to the letter, the same "lit face over a darker body" the original draws in graphite.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DEFAULT_THEME, THEME_IDS, THEMES } from "../../../../packages/core/src/themes";

const ROOT = resolve(dirname(import.meta.path), "../..");
const SOURCE = join(ROOT, "assets/images/kopiyka.svg");
const OUT = join(ROOT, "assets/icons");
const PREVIEW = join(OUT, "preview");
const PREVIEW_SIZE = 180;

/** The three colours kopiyka.svg is drawn in; each is replaced wholesale. */
const ORIGINAL = { bg: "#141413", side: "#4E4E52", face: "#F4F4F1" };
const MIN_CONTRAST = 3;
const DEPTH = 0.35;

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const hex = (c: number[]) => "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase();
function luminance(h: string): number {
  const [r, g, b] = rgb(h).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
const mix = (a: string, b: string, t: number) => { const [x, y] = [rgb(a), rgb(b)]; return hex(x.map((v, i) => v + (y[i] - v) * t)); };

export function iconColours(id: (typeof THEME_IDS)[number]) {
  const { bg, accent, text } = THEMES[id].dark;
  const face = contrast(accent, bg) >= MIN_CONTRAST ? accent : text;
  return { bg, face, side: mix(bg, face, DEPTH) };
}

function have(cmd: string): boolean {
  return spawnSync("which", [cmd], { stdio: "ignore" }).status === 0;
}

if (import.meta.main) {
  if (!have("rsvg-convert")) { console.error("rsvg-convert not found — brew install librsvg"); process.exit(1); }
  const flatten = have("magick");
  const source = readFileSync(SOURCE, "utf8");
  for (const c of Object.values(ORIGINAL)) {
    if (!source.includes(c)) throw new Error(`${SOURCE} no longer draws in ${c}; update ORIGINAL in this script`);
  }
  mkdirSync(PREVIEW, { recursive: true });
  const tmp = join(OUT, ".tmp.svg");
  try {
    for (const id of THEME_IDS) {
      // The default theme is the primary icon: no alternate, but the picker still wants its picture.
      const primary = id === DEFAULT_THEME;
      const colours = primary ? ORIGINAL : iconColours(id);
      const svg = source
        .replaceAll(ORIGINAL.bg, colours.bg)
        .replaceAll(ORIGINAL.side, colours.side)
        .replaceAll(ORIGINAL.face, colours.face);
      writeFileSync(tmp, svg);
      const outputs: [string, number][] = [[join(PREVIEW, `${id}.png`), PREVIEW_SIZE]];
      if (!primary) outputs.unshift([join(OUT, `${id}.png`), 1024]);
      for (const [file, size] of outputs) {
        execFileSync("rsvg-convert", ["-w", String(size), "-h", String(size), "-o", file, tmp]);
        if (flatten) execFileSync("magick", [file, "-background", colours.bg, "-alpha", "remove", "-alpha", "off", file]);
      }
      const ratio = contrast(colours.face, colours.bg).toFixed(1);
      console.log(`${id.padEnd(11)} bg ${colours.bg}  letter ${colours.face} (${ratio}:1)  depth ${colours.side}`);
    }
  } finally {
    rmSync(tmp, { force: true });
  }
}
