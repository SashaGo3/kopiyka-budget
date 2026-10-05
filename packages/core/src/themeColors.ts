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
export const TEXT_MIN = { label: 12, secondary: 7.5, tertiary: 5, coloured: 5 } as const;
/**
 * Body text on a dark side stops a step short of the light side's floor: pushed to 12:1 on a lifted
 * dark card it becomes pure white, which glares (halation) rather than reading better.
 */
export const LABEL_MIN_DARK = 10.5;
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
  const text = (fg: string, min: number) => legible(fg, [bg, card], min, dark);
  // The accent is text (links, ticks, header buttons) and a fill under `onAccent`: taken towards
  // legible only as far as the button text on it allows (GitHub's dark side is white on green).
  const accentText = text(s.accent, TEXT_MIN.coloured);
  const tint = contrast(s.onAccent, accentText) >= ON_ACCENT_MIN ? accentText : s.accent;
  const fill = native ? "@tertiarySystemFill" : withAlpha(s.text, dark ? 0.16 : 0.09);
  return {
    label: text(s.text, dark ? LABEL_MIN_DARK : TEXT_MIN.label),
    secondary: text(s.muted, TEXT_MIN.secondary),
    tertiary: text(mixHex(s.muted, s.bg, 0.35), TEXT_MIN.tertiary),
    bg: native ? s.bg : bg,
    bgGrouped: native ? s.bg : bg,
    card: native ? s.card : card,
    fill,
    fill2: native ? "@secondarySystemFill" : withAlpha(s.text, dark ? 0.24 : 0.14),
    separator: native ? "@separator" : border,
    tint,
    onTint: s.onAccent,
    red: text(s.red, TEXT_MIN.coloured),
    green: text(s.green, TEXT_MIN.coloured),
    orange: text(s.orange, TEXT_MIN.coloured),
    redSoft: withAlpha(s.red, dark ? 0.22 : 0.16),
    greenSoft: withAlpha(s.green, dark ? 0.22 : 0.16),
    orangeSoft: withAlpha(s.orange, dark ? 0.24 : 0.18),
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
  const fill = (s: ThemeSide) => own(s) ?? (role === "muted" ? s.muted : s[role]);
  const glyph = (s: ThemeSide) => (!own(s) && role === "accent" ? s.onAccent : glyphOn(fill(s), s));
  return { fill: [fill(theme.light), fill(theme.dark)], glyph: [glyph(theme.light), glyph(theme.dark)] };
}
