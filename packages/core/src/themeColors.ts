/**
 * Every colour the app draws its chrome in, derived from a theme's palette (themes.ts) as plain data:
 * per role, a light and a dark value. The app (apps/mobile/src/constants/theme.ts) hands the whole
 * table to native once, by name, so a theme switch is a lookup that changes rather than a screen that
 * re-mounts; and because it is pure data it is tested here, contrast floors included.
 *
 * A value is "#RRGGBB", "#RRGGBBAA", or "@name" for one of UIKit's own semantic colours (the default
 * theme keeps iOS's fills and separators — see `SYSTEM_FALLBACK` for what stands in for them off iOS).
 */
import { DEFAULT_THEME, THEMES, THEME_IDS, type ExtraHue, type Theme, type ThemeId, type ThemeSide } from "./themes";

export type ColorRole =
  | "label" | "secondary" | "tertiary"
  | "bg" | "bgGrouped" | "card" | "fill" | "fill2" | "separator"
  | "tint" | "onTint"
  | "red" | "green" | "orange" | "redSoft" | "greenSoft" | "orangeSoft"
  | "ramp0" | "ramp1" | "ramp2" | "ramp3";

/** [light, dark]. */
export type ColorPair = readonly [string, string];

/** What an "@name" value is drawn as where UIKit's semantic colours do not exist. */
export const SYSTEM_FALLBACK: Record<string, ColorPair> = {
  tertiarySystemFill: ["#7676801F", "#7676803D"],
  secondarySystemFill: ["#78788029", "#78788052"],
  separator: ["#3C3C434A", "#54545899"],
};

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** `a` moved `amount` of the way towards `b`, as an opaque hex colour. */
export function mixHex(a: string, b: string, amount: number): string {
  const [x, y] = [rgb(a), rgb(b)];
  return `#${x.map((v, i) => Math.round(v + ((y[i] ?? v) - v) * amount).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

/** `hex` at `a` (0–1), as #RRGGBBAA. */
export function withAlpha(hex: string, a: number): string {
  return `${hex.slice(0, 7)}${Math.round(a * 255).toString(16).padStart(2, "0")}`.toUpperCase();
}

/** WCAG relative luminance of an opaque hex colour. */
export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two opaque hex colours, 1–21. */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/**
 * APCA lightness contrast (Lc, APCA-W3 0.0.98G), the perceptual model behind the WCAG 3 draft: how
 * readable `text` is on `bg`, as a magnitude 0–~106 whichever is lighter. WCAG 2's ratio misjudges
 * both ends — it calls dim text on a dark page fine and asks for near-black text on a light one — so
 * a theme held to it looked harsh in light and faded in dark. Readability guidance (apcacontrast.com):
 * Lc 90 body text, 75 the floor for it, 60 for other content text, 45 for large text and icons; and
 * no more than needed, since past ~Lc 90 light-on-dark text starts to glare.
 */
export function apca(text: string, bg: string): number {
  const y = (hex: string) => { const [r, g, b] = rgb(hex).map((v) => (v / 255) ** 2.4) as [number, number, number]; return 0.2126729 * r + 0.7151522 * g + 0.072175 * b; };
  const clamp = (v: number) => (v > 0.022 ? v : v + (0.022 - v) ** 1.414);
  const t = clamp(y(text)), b = clamp(y(bg));
  if (Math.abs(b - t) < 0.0005) return 0;
  const s = b > t ? (b ** 0.56 - t ** 0.57) * 1.14 : (t ** 0.62 - b ** 0.65) * 1.14;
  return s < 0.1 ? 0 : (s - 0.027) * 100;
}

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toGamma = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

/** OKLCH (lightness 0–1, chroma, hue in radians) of an opaque hex colour. */
export function oklch(hex: string): { l: number; c: number; h: number } {
  const [r, g, b] = rgb(hex).map((v) => toLinear(v / 255)) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { l: L, c: Math.hypot(A, B), h: Math.atan2(B, A) };
}

/**
 * The colour at OKLCH `l`, `c`, `h` as hex. Where sRGB cannot show that much chroma at that
 * lightness, chroma is given up — never lightness or hue — until it can: a red lifted for a dark page
 * becomes the most saturated red that light, not a pink.
 */
export function fromOklch(l: number, c: number, h: number): string {
  for (let chroma = c; ; chroma = Math.max(0, chroma - 0.002)) {
    const A = chroma * Math.cos(h), B = chroma * Math.sin(h);
    const x = (l + 0.3963377774 * A + 0.2158037573 * B) ** 3;
    const y = (l - 0.1055613458 * A - 0.0638541728 * B) ** 3;
    const z = (l - 0.0894841775 * A - 1.291485548 * B) ** 3;
    const out = [4.0767416621 * x - 3.3077115913 * y + 0.2309699292 * z, -1.2684380046 * x + 2.6097574011 * y - 0.3413193965 * z, -0.0041960863 * x - 0.7034186147 * y + 1.707614701 * z];
    if (chroma === 0 || out.every((v) => v >= -0.0005 && v <= 1.0005)) {
      return `#${out.map((v) => Math.round(toGamma(Math.min(1, Math.max(0, v))) * 255).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
    }
  }
}

/**
 * How saturated a status or icon colour must be, as OKLCH chroma. Several editor palettes draw their
 * red, green and orange muted — Nord's red is a dusty rose (C 0.11), Rosé Pine's and Catppuccin's are
 * pastels — so an expense, an income and a coloured icon square all read washed out beside Graphite's
 * and GitHub's (C 0.2+). Below this, chroma is raised at the same lightness and hue; greys (under
 * `GREY_CHROMA`) are left grey.
 */
export const MIN_CHROMA = 0.16;
const GREY_CHROMA = 0.03;

/** `hex` with at least `MIN_CHROMA` (as far as sRGB allows at its lightness), hue and lightness kept. */
export function vivid(hex: string, min = MIN_CHROMA): string {
  const o = oklch(hex);
  return o.c >= min || o.c < GREY_CHROMA ? hex : fromOklch(o.l, min, o.h);
}

/**
 * `fg` moved until its APCA contrast reaches `lo` against every background and stays under `hi` on
 * the last one (the card, where nearly all text sits — the page and the card are ~9 Lc apart on a
 * light side, more than a band is wide): lighter (dark side) or darker (light side) when it is too
 * faint, back towards the page's lightness when it is too strong. Only OKLCH lightness moves; hue
 * and chroma stay, so a red stays red. Mixing with white instead took a dark side's red to pink and
 * its green to mint. A colour already in the band is left exactly as it was.
 */
export function inBand(fg: string, backgrounds: string[], lo: number, hi: number, dark: boolean): string {
  const weakest = (c: string) => Math.min(...backgrounds.map((b) => apca(c, b)));
  const strongest = (c: string) => apca(c, backgrounds[backgrounds.length - 1]!);
  const o = oklch(fg);
  const at = (to: number, step: number) => fromOklch(o.l + (to - o.l) * (step / 100), o.c, o.h);
  if (weakest(fg) < lo) {
    for (let step = 1; step <= 100; step++) { const c = at(dark ? 1 : 0, step); if (weakest(c) >= lo) return c; }
    return dark ? "#FFFFFF" : "#000000";
  }
  if (strongest(fg) > hi) {
    const page = oklch(backgrounds[0]!).l;
    for (let step = 1; step <= 100; step++) { const c = at(page, step); if (strongest(c) <= hi) return weakest(c) >= lo ? c : at(page, step - 1); }
  }
  return fg;
}

/**
 * `fg`, taken towards black (on a light side) or white (on a dark one) just far enough to reach `min`
 * against every background it is drawn on. Keeps the theme's hue — Tokyo Night's blue text stays
 * blue, only deeper — and leaves a colour that already passes exactly as it was.
 */
export function legible(fg: string, backgrounds: string[], min: number, dark: boolean): string {
  const worst = (c: string) => Math.min(...backgrounds.map((b) => contrast(c, b)));
  if (worst(fg) >= min) return fg;
  const towards = dark ? "#FFFFFF" : "#000000";
  for (let step = 1; step <= 40; step++) {
    const c = mixHex(fg, towards, step / 40);
    if (worst(c) >= min) return c;
  }
  return towards;
}

/** `from` moved towards `to` in small steps until it stands `min` apart from `against`. */
function apart(from: string, to: string, against: string, min: number): string {
  if (contrast(from, against) >= min) return from;
  for (let step = 1; step <= 40; step++) {
    const c = mixHex(from, to, step / 40);
    if (contrast(c, against) >= min) return c;
  }
  return to;
}

/**
 * The floors text is held to, against both `bg` and `card`. Several editor palettes were drawn for a
 * code editor on a big monitor — Tokyo Night's light body text is 4.5:1, Catppuccin's and Rosé Pine's
 * about 6.6:1 — and their coloured text lower still. On a phone, at 13–15 pt, in daylight, that reads
 * as washed out. So body text is held near black (or white), secondary text well above AA, captions
 * and placeholders above AA, and the accent and status colours — links, amounts, an overspent red —
 * above AA too. Each is only deepened within its own hue, so a theme still looks like itself; a colour
 * that already passes is left exactly as it was.
 */
export const TEXT_MIN = { label: 15, secondary: 8.5, tertiary: 6, coloured: 6 } as const;
/** Kept for callers of the WCAG floors; text roles are now held to `TEXT_LC` (APCA) instead. */
export const LABEL_MIN_DARK = 13.5;
/**
 * Every text role's band in APCA Lc, against both `bg` and `card`, the same on a light side and a
 * dark one. Held to WCAG 2 ratios instead, light sides came out harsh — secondary text at Lc 90, as
 * dark as body text, so nothing stood back — and dark sides faded (captions at Lc 50). Body text:
 * Lc 90+, 94–98 on a dark side (capped where it would glare); secondary 72–80; captions and
 * placeholders 57–65; coloured text — links, amounts, an overspent red — 60–80, from 50 on a dark
 * side. Coloured text is mostly semibold numbers, and a saturated colour on a dark page looks
 * brighter than APCA's lightness-only model says: held to 70 there, a red had to turn pink
 * (#FF453A → #FFB2AE) to get in. The floor holds on the page and the card, the ceiling on the card.
 */
export const TEXT_LC = {
  label: { lo: 90, hi: 110, loDark: 94, hiDark: 98 },
  secondary: { lo: 72, hi: 80 },
  tertiary: { lo: 57, hi: 65 },
  coloured: { lo: 60, hi: 80, loDark: 50, hiDark: 80 },
} as const;
/**
 * An icon's glyph on its coloured square (`toneColors`). The palettes' pastels — Catppuccin's,
 * Nord's, Rosé Pine's light sides — put a white glyph on a square barely darker than it (2.2:1), which
 * reads as a smudge rather than an icon. The square is deepened within its own hue until it holds.
 */
export const ICON_MIN = 4.5;
/** The same, in APCA Lc: a glyph is a small bold shape, read like large text. */
export const ICON_LC = 60;
/** What text on the accent (a filled button) must keep: the accent is not moved past this. */
export const ON_ACCENT_MIN = 4.5;
/**
 * Surfaces. A card has to read as a card on the page, and a hairline as a line: several palettes put
 * them a shade apart (Rosé Pine's dark border is 1.1:1 on its card), which is what made screens look
 * flat and grey. The page is taken a step further from the card where it is too close, and the
 * separator a step further from both.
 */
export const SURFACE_MIN = { card: 1.12, separator: 1.45 } as const;

/** One side of a theme with its surfaces pulled apart where the palette left them too close. */
function surfaces(s: ThemeSide, dark: boolean): { bg: string; card: string; border: string } {
  // Light: the card is the lighter one, so the page darkens; dark: the card is lifted towards the text.
  const bg = dark ? s.bg : apart(s.bg, s.text, s.card, SURFACE_MIN.card);
  const card = dark ? apart(s.card, s.text, s.bg, SURFACE_MIN.card) : s.card;
  const border = apart(s.border, s.text, card, SURFACE_MIN.separator);
  return { bg, card, border };
}

function side(theme: Theme, s: ThemeSide, dark: boolean): Record<ColorRole, string> {
  const native = theme.id === DEFAULT_THEME;
  const { bg, card, border } = surfaces(s, dark);
  // Measured against the surfaces as drawn: the default theme keeps the palette's own.
  const grounds = native ? [s.bg, s.card] : [bg, card];
  const band = (fg: string, b: { lo: number; hi: number; loDark?: number; hiDark?: number }) =>
    inBand(fg, grounds, dark ? b.loDark ?? b.lo : b.lo, dark ? b.hiDark ?? b.hi : b.hi, dark);
  // The accent is text (links, ticks, header buttons) and a fill under `onAccent`: moved into the
  // coloured band only as far as the button text on it allows (GitHub's dark side is white on green).
  const accentText = band(s.accent, TEXT_LC.coloured);
  const tint = contrast(s.onAccent, accentText) >= ON_ACCENT_MIN ? accentText : s.accent;
  const fill = native ? "@tertiarySystemFill" : withAlpha(s.text, dark ? 0.16 : 0.09);
  return {
    label: band(s.text, TEXT_LC.label),
    secondary: band(s.muted, TEXT_LC.secondary),
    tertiary: band(mixHex(s.muted, s.bg, 0.35), TEXT_LC.tertiary),
    bg: native ? s.bg : bg,
    bgGrouped: native ? s.bg : bg,
    card: native ? s.card : card,
    fill,
    fill2: native ? "@secondarySystemFill" : withAlpha(s.text, dark ? 0.24 : 0.14),
    separator: native ? "@separator" : border,
    tint,
    onTint: s.onAccent,
    red: band(vivid(s.red), TEXT_LC.coloured),
    green: band(vivid(s.green), TEXT_LC.coloured),
    orange: band(vivid(s.orange), TEXT_LC.coloured),
    redSoft: withAlpha(vivid(s.red), dark ? 0.22 : 0.16),
    greenSoft: withAlpha(vivid(s.green), dark ? 0.22 : 0.16),
    orangeSoft: withAlpha(vivid(s.orange), dark ? 0.24 : 0.18),
    // The importance ramp: one hue at three steps, the lighter ones mixed towards the card they sit on.
    ramp3: s.accent,
    ramp2: mixHex(s.accent, card, 0.35),
    ramp1: mixHex(s.accent, card, 0.68),
    ramp0: fill,
  };
}

const cache = new Map<ThemeId, Record<ColorRole, ColorPair>>();

/** Every role of `theme`, light and dark. */
export function themeColors(theme: Theme): Record<ColorRole, ColorPair> {
  let out = cache.get(theme.id);
  if (!out) {
    const l = side(theme, theme.light, false);
    const d = side(theme, theme.dark, true);
    out = Object.fromEntries((Object.keys(l) as ColorRole[]).map((k) => [k, [l[k], d[k]] as const])) as Record<ColorRole, ColorPair>;
    cache.set(theme.id, out);
  }
  return out;
}

/** `themeColors` for every theme, keyed by id. */
export function allThemeColors(): Record<ThemeId, Record<ColorRole, ColorPair>> {
  return Object.fromEntries(THEME_IDS.map((id) => [id, themeColors(THEMES[id])])) as Record<ThemeId, Record<ColorRole, ColorPair>>;
}

/**
 * Icon colours for UI chrome — the filled squares on Settings, automation and data rows, insight
 * kinds, the travel blue. Call sites name them in iOS's own system hexes ("#FF9F0A", "#5E5CE6", …),
 * which is exactly right in the default Graphite theme and clashes in every other one. So the hex is
 * read as a *role* — red/pink, orange/yellow/brown, green/mint, grey, or anything blue-to-purple
 * (the theme's accent) — and drawn in the theme's own colour for that role. A theme that names finer
 * hues (`ThemeSide.hues`) has those drawn in its own instead. Default theme: the hex as given.
 *
 * Only for chrome. Category, tag and account colours are the user's data and are drawn as chosen.
 */
type HueRole = "red" | "orange" | "green" | "accent" | "muted";

function hsl(hex: string): { h: number; s: number } | null {
  const [r, g, b] = rgb(hex).map((v) => v / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (d === 0) return { h: 0, s: 0 };
  const h = (max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
  return { h, s };
}

function hueRole(hex: string): HueRole {
  const c = hsl(hex)!;
  if (c.s < 0.2) return "muted"; // #8E8E93 and other greys (#A2845E brown is ~0.27 and stays orange)
  if (c.h >= 330 || c.h < 15) return "red"; // red, pink (#FF375F, #FF2D55)
  if (c.h < 70) return "orange"; // orange, yellow, brown
  if (c.h < 180) return "green"; // green, mint
  return "accent"; // teal, cyan, blue, indigo, purple
}

function extraHue(hex: string): ExtraHue | null {
  const c = hsl(hex)!;
  if (c.s < 0.2) return null;
  if (c.h >= 320 && c.h < 355) return "pink";
  if (c.h >= 40 && c.h < 70) return "yellow";
  if (c.h >= 160 && c.h < 200) return "teal";
  if (c.h >= 200 && c.h < 235) return "blue";
  if (c.h >= 235 && c.h < 320) return "purple";
  return null;
}

/** White or the page background on `fill`, whichever reads better: dark themes' greens and oranges are pale. */
const glyphOn = (fill: string, s: ThemeSide) => (contrast("#FFFFFF", fill) >= contrast(s.bg, fill) ? "#FFFFFF" : s.bg);

export const isHexColor = (v: string) => /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(v);

/** `hex` as `theme` draws it: the fill of an icon square and the glyph on top of it, light and dark. */
export function toneColors(theme: Theme, hex: string): { fill: ColorPair; glyph: ColorPair } {
  if (theme.id === DEFAULT_THEME || !isHexColor(hex)) return { fill: [hex, hex], glyph: ["#FFFFFF", "#FFFFFF"] };
  const role = hueRole(hex);
  const extra = extraHue(hex);
  const own = (s: ThemeSide) => (extra ? s.hues?.[extra] : undefined);
  // Muted stays the palette's grey; every coloured square is held to MIN_CHROMA, like the status colours.
  const base = (s: ThemeSide) => { const c = own(s) ?? (role === "muted" ? s.muted : s[role]); return role === "muted" && !own(s) ? c : vivid(c); };
  const glyph = (s: ThemeSide) => (!own(s) && role === "accent" ? s.onAccent : glyphOn(base(s), s));
  // The square moves away from its glyph — deeper under a light glyph, paler under a dark one — just
  // far enough to reach ICON_MIN; one that already does is drawn exactly as the palette has it.
  const fill = (s: ThemeSide) => {
    const g = glyph(s);
    const from = base(s);
    if (apca(g, from) >= ICON_LC) return from;
    const to = luminance(g) > 0.5 ? "#000000" : "#FFFFFF";
    for (let step = 1; step <= 80; step++) { const c = mixHex(from, to, step / 80); if (apca(g, c) >= ICON_LC) return c; }
    return to;
  };
  return { fill: [fill(theme.light), fill(theme.dark)], glyph: [glyph(theme.light), glyph(theme.dark)] };
}
