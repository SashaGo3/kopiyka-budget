#!/usr/bin/env node
/**
 * Regenerates every app-icon asset from the one mark defined here: an extruded К, the face lit
 * from the top-left and the body running down-right. Run it after changing the geometry or the
 * palette below — nothing else in the repo draws this mark, and no asset is hand-edited.
 *
 *   node scripts/make-icons.mjs
 *
 * Needs `rsvg-convert` and `magick` on PATH (brew install librsvg imagemagick).
 *
 * Sizes follow each platform's own safe area, which is why the mark is drawn at a different scale
 * per target rather than resized from one PNG:
 *   * iOS (`assets/expo.icon`, Icon Composer): layer art on a transparent canvas, the background
 *     comes from the bundle's fill specializations. The system derives the tinted appearance from
 *     the layer's luminance, which is exactly what the two-tone extrusion gives it.
 *   * Android adaptive: the launcher may crop to a circle, so the foreground keeps to the 61%
 *     safe zone (66 of 108dp) and the background is a flat fill.
 *   * watchOS: the icon is masked to a circle, so the mark is fitted to that circle instead of to
 *     the canvas. iOS is the reference — the К comes out the size it is on the phone, only inset
 *     enough to keep the round mask off it.
 *   * Notification / monochrome / watch complication: a flat silhouette (the face alone). One
 *     colour cannot carry an extrusion — the body would merge into the face and read as a blob.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SIZE = 1024;
const C = SIZE / 2;

/** Off-white face, graphite body, near-black ground: the app's own palette, dark side out. */
const PALETTE = {
  light: { bg: "#141413", face: "#F4F4F1", side: "#4E4E52" },
  // The dark appearance dims both, so a screen full of icons does not glare.
  dark: { bg: "#0F0F0E", face: "#DCDCD6", side: "#3E3E44" },
  // Tinted art is grayscale; the system replaces the hue and keeps these two values apart.
  tinted: { bg: null, face: "#E8E8E8", side: "#7A7A7A" },
};

/** The mark at full size: 594 tall plus the cap and the extrusion makes 825 — 80% of the canvas. */
const MARK = { h: 594, w: 137, depth: 94 };
/** Union of face and extrusion, used to scale the mark into each platform's safe area. */
const markBox = ({ h, w, depth }) => ({ width: 0.64 * h + w + depth, height: h + w + depth });
const scaled = (factor) => ({ h: MARK.h * factor, w: MARK.w * factor, depth: MARK.depth * factor });
/** The scale at which the mark's taller side fills `fraction` of the canvas. */
const fit = (fraction) => (SIZE * fraction) / markBox(MARK).height;
/**
 * Half the mark's circumscribed circle: the farthest any stroke reaches from the centre. The
 * corners of the box above stick out past a round mask while the mark itself does not, so a
 * circular icon is fitted to this instead — the same coordinates `kay` draws, cap width included.
 */
const markRadius = ({ h, w, depth }) => {
  const caps = [];
  for (const t of [-depth / 2, depth / 2]) // the lit face, then the far end of the extrusion
    for (const x of [-0.3 * h, 0.34 * h]) // stem, arm tips
      for (const y of [-h / 2, h / 2]) caps.push(Math.hypot(x + t, y + t));
  return Math.max(...caps) + w / 2;
};
/** The scale at which the mark fills `fraction` of a round icon's diameter. */
const fitCircle = (fraction) => (SIZE * fraction) / (2 * markRadius(MARK));

/** One К: the stem, then the two arms meeting at mid-height. Round caps, like the app's type. */
function kay({ h, w }, colour, dx, dy) {
  const half = h / 2, sx = C - 0.3 * h + dx, ax = C + 0.34 * h + dx, cy = C + dy;
  return (
    `<g fill="none" stroke="${colour}" stroke-width="${w.toFixed(1)}" stroke-linecap="round" stroke-linejoin="round">` +
    `<path d="M ${sx.toFixed(1)},${(cy - half).toFixed(1)} V ${(cy + half).toFixed(1)}"/>` +
    `<path d="M ${ax.toFixed(1)},${(cy - half).toFixed(1)} L ${(sx + w * 0.1).toFixed(1)},${cy.toFixed(1)} L ${ax.toFixed(1)},${(cy + half).toFixed(1)}"/>` +
    `</g>`
  );
}

/**
 * The extruded mark. The body is a run of offset copies rather than a real solid: at this many
 * steps the seams close, and it stays a plain path so every renderer draws it identically.
 * Face and body are both shifted up-left by half the depth, so the pair is centred, not the face.
 */
function mark(geom, { face, side }, { flat = false, shadow = true } = {}) {
  const o = -geom.depth / 2;
  if (flat) return kay(geom, face, o, o);
  // 40 copies of a stroke this thick overlap many times over, so the body is seamless while the
  // file stays small enough for Icon Composer to open.
  const steps = 40;
  let body = "";
  for (let i = steps; i > 0; i--) {
    const t = i / steps;
    body += kay(geom, side, o + geom.depth * t, o + geom.depth * t);
  }
  const lit = shadow ? `<g filter="url(#lift)">${body}</g>` : body;
  return `${lit}${kay(geom, face, o, o)}`;
}

function svg(body, bg, { filters = true } = {}) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">` +
    (filters
      ? `<defs><filter id="lift" x="-40%" y="-40%" width="180%" height="180%">` +
        `<feDropShadow dx="8" dy="16" stdDeviation="20" flood-color="#000" flood-opacity="0.30"/>` +
        `</filter></defs>`
      : "") +
    (bg ? `<rect width="${SIZE}" height="${SIZE}" fill="${bg}"/>` : "") +
    body +
    `</svg>`
  );
}

/**
 * The flat mark on a canvas cropped to its own bounds. Asset-catalog template art is scaled to the
 * frame it is placed in, so the crop is what makes a complication glyph the size SwiftUI asks for.
 */
function silhouette(colour) {
  const { h, w } = MARK;
  const o = -MARK.depth / 2;
  const [width, height] = [(0.64 * h + w).toFixed(1), (h + w).toFixed(1)];
  const [x, y] = [(C + o - 0.3 * h - w / 2).toFixed(1), (C + o - h / 2 - w / 2).toFixed(1)];
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="${x} ${y} ${width} ${height}">${kay(MARK, colour, o, o)}</svg>`
  );
}

const out = (...p) => resolve(ROOT, ...p);
function png(source, file, width = SIZE) {
  const tmp = `${file}.tmp.svg`;
  writeFileSync(tmp, source);
  execFileSync("rsvg-convert", ["-w", String(width), "-h", String(width), "-o", file, tmp]);
  rmSync(tmp);
}

mkdirSync(out("assets/expo.icon/Assets"), { recursive: true });

// 1. The master, kept in the repo so the mark can be opened and edited as art.
writeFileSync(out("assets/images/kopiyka.svg"), svg(mark(MARK, PALETTE.light), PALETTE.light.bg));

// 2. iOS, Icon Composer: layer art per appearance on a transparent canvas. No SVG filter here —
//    Icon Composer draws plain paths, and the depth comes from the extrusion itself anyway.
for (const [name, tone] of [["kay", PALETTE.light], ["kay-dark", PALETTE.dark]]) {
  writeFileSync(out(`assets/expo.icon/Assets/${name}.svg`), svg(mark(MARK, tone, { shadow: false }), null, { filters: false }));
}
writeFileSync(
  out("assets/expo.icon/icon.json"),
  JSON.stringify(
    {
      "fill-specializations": [
        { value: { solid: srgb(PALETTE.light.bg) } },
        { appearance: "dark", value: { solid: srgb(PALETTE.dark.bg) } },
      ],
      groups: [
        {
          layers: [
            {
              "image-name-specializations": [
                { value: "kay.svg" },
                { appearance: "dark", value: "kay-dark.svg" },
              ],
              name: "kay",
              position: { scale: 1, "translation-in-points": [0, 0] },
            },
          ],
          shadow: { kind: "neutral", opacity: 0 },
          translucency: { enabled: false, value: 0 },
        },
      ],
      "supported-platforms": { circles: ["watchOS"], squares: "shared" },
    },
    null,
    2,
  ) + "\n",
);

// 3. Flat PNGs: `icon` is what Android and web fall back to, the other two are the iOS
//    appearances for builds that take plain images instead of the Icon Composer bundle.
png(svg(mark(MARK, PALETTE.light), PALETTE.light.bg), out("assets/images/icon.png"));
png(svg(mark(MARK, PALETTE.dark), PALETTE.dark.bg), out("assets/images/icon-dark.png"));
png(svg(mark(MARK, PALETTE.tinted), "#000000"), out("assets/images/icon-tinted.png"));

// 4. Android adaptive: foreground inside the 61% safe zone, background a flat fill.
const android = scaled(fit(0.61));
png(svg(mark(android, PALETTE.light), null), out("assets/images/android-icon-foreground.png"));
png(svg("", PALETTE.light.bg), out("assets/images/android-icon-background.png"));
png(svg(mark(android, { face: "#FFFFFF" }, { flat: true }), null), out("assets/images/android-icon-monochrome.png"));

// 5. Android notification: a small white silhouette, alpha only.
png(svg(mark(scaled(fit(0.7)), { face: "#FFFFFF" }, { flat: true }), null), out("assets/images/notification-icon.png"), 96);

// 6. Web.
png(svg(mark(MARK, PALETTE.light), PALETTE.light.bg), out("assets/images/favicon.png"), 48);

// 7. watchOS: the square is masked to a circle, so the mark is fitted to that circle rather than
//    to the canvas — 88% of its diameter leaves the ring of background a round icon wants while
//    the К stays the size it is on the phone. No drop shadow, because the iOS bundle has none
//    (`shadow.opacity` is 0 above) and the two icons sit next to each other on the same wrist.
const watch = svg(mark(scaled(fitCircle(0.88)), PALETTE.light, { shadow: false }), PALETTE.light.bg, { filters: false });
png(watch, out("targets/watch/icon.png"));
png(watch, out("targets/watch/Assets.xcassets/AppIcon.appiconset/App-Icon-1024x1024@1x.png"));

// 8. watch complication: one template glyph for every accessory family. A single tint cannot carry
//    the extrusion, so the complication shows the face alone — the same silhouette Android's
//    monochrome icon uses, cropped to the mark so SwiftUI's frame sizes the К itself.
mkdirSync(out("targets/watch-widget/Assets.xcassets/Kay.imageset"), { recursive: true });
writeFileSync(out("targets/watch-widget/Assets.xcassets/Kay.imageset/kay.svg"), silhouette("#000000"));

/** Icon Composer stores fills as extended-sRGB components. */
function srgb(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return `extended-srgb:${r.toFixed(5)},${g.toFixed(5)},${b.toFixed(5)},1.00000`;
}

console.log("icons written");
