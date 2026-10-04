import { DynamicColorIOS, Platform, PlatformColor, type ColorValue, type ViewStyle } from "react-native";
import { DEFAULT_THEME, THEMES, themeOf, type ExtraHue, type Theme, type ThemeId, type ThemeSide } from "@kopiyka/core";
import { t } from "@/i18n";

/**
 * Colours come from the current theme (packages/core/src/themes.ts). A theme is a palette with a
 * light and a dark side; every colour here is a DynamicColorIOS of the two, so the phone's appearance
 * is still followed natively.
 *
 * The names (`C`, `Brand`, `ValueRamp`) are read through getters, so a call site reads the theme that
 * is current *when it reads*. Screens do not repaint in place: a change of theme re-mounts every
 * screen's content (`ThemeKeyed`, src/lib/theme.ts) while the navigators around them stay. What
 * follows is the one rule: never capture a colour at module scope. Styles go through `themed`, which
 * rebuilds them for the theme that is current. The few things drawn outside a screen — by a
 * `_layout` — are not re-mounted, so they compute their colours in a function that takes the theme
 * id (the React Compiler memoises on arguments) and call `useTheme()`.
 */
let current: Theme = THEMES[DEFAULT_THEME];

/** The theme every colour is read from now. */
export function currentTheme(): Theme { return current; }
/** Set by src/lib/theme.ts, which owns the stored choice; anything else calls `setTheme` there. */
export function applyThemePalette(id: string | null | undefined): void { current = themeOf(id); }

const dyn = (light: string, dark: string): ColorValue => (Platform.OS === "ios" ? DynamicColorIOS({ light, dark }) : light);
const sys = (name: string, fallback: string): ColorValue => (Platform.OS === "ios" ? PlatformColor(name) : fallback);

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
/** `a` moved `amount` of the way towards `b`, as an opaque hex colour. */
export function mixHex(a: string, b: string, amount: number): string {
  const [x, y] = [rgb(a), rgb(b)];
  return `#${x.map((v, i) => Math.round(v + ((y[i] ?? v) - v) * amount).toString(16).padStart(2, "0")).join("")}`;
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
  for (let step = 1; step <= 20; step++) {
    const c = mixHex(fg, towards, step / 20);
    if (worst(c) >= min) return c;
  }
  return towards;
}
/**
 * The floors text is held to, against both `bg` and `card`. Several editor palettes were drawn for a
 * code editor on a big monitor — Tokyo Night's light body text is 4.5:1, Catppuccin's and Rosé Pine's
 * about 6.6:1 — and their coloured text lower still: Nord's red, Catppuccin's orange and iOS's own
 * green on white are 2–2.5:1. On a phone, at 13–15 pt, that reads as soft, slightly blurred text.
 *
 * So every colour drawn as text has a floor: body text near black (or white), secondary text well
 * above AA, the tertiary grey (placeholders, captions) at AA itself, and the accent and the status
 * colours — links, amounts, the red of an overspent budget — at AA as well. Each is only darkened (or
 * lightened) within its own hue, so a theme still looks like itself; one that already passes is left
 * exactly as it was. Fills, separators and the soft washes behind text keep the palette's own colours.
 */
const TEXT_MIN = { label: 12, secondary: 7, tertiary: 4.5, coloured: 4.5 };
/** What text on the accent (a filled button) must keep: the accent is not moved past this. */
const ON_ACCENT_MIN = 4.5;

/** `hex` at `alpha` (0–1), as #RRGGBBAA. */
const alpha = (hex: string, a: number) => `${hex.slice(0, 7)}${Math.round(a * 255).toString(16).padStart(2, "0")}`;

interface Palette { C: Record<keyof typeof C, ColorValue>; ramp: Record<0 | 1 | 2 | 3, ColorValue> }

function build(theme: Theme): Palette {
  const { light: l, dark: d } = theme;
  const both = (f: (s: ThemeSide) => string) => dyn(f(l), f(d));
  // The default theme is the graphite the app shipped with, which leans on iOS's own semantic colours
  // for fills and separators; keeping them means Graphite stays the app people already know. Its text
  // colours, though, come from its palette like every other theme's, held to the same floors: iOS's
  // secondary label and its green, orange and red on white fall short of them.
  const native = theme.id === DEFAULT_THEME;
  const text = (side: ThemeSide, fg: string, min: number, dark: boolean) => legible(fg, [side.bg, side.card], min, dark);
  const role = (min: number, pick: (s: ThemeSide) => string) => dyn(text(l, pick(l), min, false), text(d, pick(d), min, true));
  // The accent is text (links, ticks, the header buttons) and a fill under `onAccent`. It is taken
  // towards legible as far as the button text on it still allows — GitHub's dark side, white on
  // green, would lose its button text if its green were lightened all the way.
  const accent = (s: ThemeSide, dark: boolean) => {
    const c = text(s, s.accent, TEXT_MIN.coloured, dark);
    return contrast(s.onAccent, c) >= ON_ACCENT_MIN ? c : s.accent;
  };
  const fill = native ? sys("tertiarySystemFill", "#eee") : dyn(alpha(l.text, 0.07), alpha(d.text, 0.13));
  return {
    C: {
      label: role(TEXT_MIN.label, (s) => s.text),
      secondary: role(TEXT_MIN.secondary, (s) => s.muted),
      tertiary: role(TEXT_MIN.tertiary, (s) => mixHex(s.muted, s.bg, 0.4)),
      bg: both((s) => s.bg),
      bgGrouped: both((s) => s.bg),
      card: both((s) => s.card),
      fill,
      fill2: native ? sys("secondarySystemFill", "#e5e5ea") : dyn(alpha(l.text, 0.11), alpha(d.text, 0.2)),
      separator: native ? sys("separator", "#ccc") : both((s) => s.border),
      tint: dyn(accent(l, false), accent(d, true)),
      onTint: both((s) => s.onAccent),
      red: role(TEXT_MIN.coloured, (s) => s.red),
      green: role(TEXT_MIN.coloured, (s) => s.green),
      orange: role(TEXT_MIN.coloured, (s) => s.orange),
      redSoft: native ? "rgba(255,59,48,0.14)" : dyn(alpha(l.red, 0.14), alpha(d.red, 0.18)),
      greenSoft: native ? "rgba(52,199,89,0.14)" : dyn(alpha(l.green, 0.14), alpha(d.green, 0.18)),
      orangeSoft: native ? "rgba(255,149,0,0.16)" : dyn(alpha(l.orange, 0.16), alpha(d.orange, 0.2)),
    },
    ramp: {
      3: both((s) => s.accent),
      2: both((s) => mixHex(s.accent, s.card, 0.35)),
      1: both((s) => mixHex(s.accent, s.card, 0.68)),
      0: fill,
    },
  };
}

// One set of colour objects per theme, built on first use: the same DynamicColorIOS value every time
// it is read, rather than a new one per access.
const built = new Map<ThemeId, Palette>();
const palette = (): Palette => {
  let p = built.get(current.id);
  if (!p) { p = build(current); built.set(current.id, p); }
  return p;
};

/** The theme's own colours as plain hex, for the few places that need a string rather than a ColorValue. */
export const Brand = {
  get bg() { return current.light.bg; }, get bgDark() { return current.dark.bg; },
  get card() { return current.light.card; }, get cardDark() { return current.dark.card; },
  get accent() { return current.light.accent; }, get accentDark() { return current.dark.accent; },
  get border() { return current.light.border; }, get borderDark() { return current.dark.border; },
};

/** The app's semantic colours, in the current theme. */
export const C = {
  get label(): ColorValue { return palette().C.label; },
  get secondary(): ColorValue { return palette().C.secondary; },
  get tertiary(): ColorValue { return palette().C.tertiary; },
  get bg(): ColorValue { return palette().C.bg; },
  get bgGrouped(): ColorValue { return palette().C.bgGrouped; },
  get card(): ColorValue { return palette().C.card; },
  get fill(): ColorValue { return palette().C.fill; },
  get fill2(): ColorValue { return palette().C.fill2; },
  get separator(): ColorValue { return palette().C.separator; },
  get tint(): ColorValue { return palette().C.tint; },
  /** Text and icons drawn on top of `tint`. */
  get onTint(): ColorValue { return palette().C.onTint; },
  get red(): ColorValue { return palette().C.red; },
  get green(): ColorValue { return palette().C.green; },
  get orange(): ColorValue { return palette().C.orange; },
  /** The status colours as a wash behind text: amount pills, banners. */
  get redSoft(): ColorValue { return palette().C.redSoft; },
  get greenSoft(): ColorValue { return palette().C.greenSoft; },
  get orangeSoft(): ColorValue { return palette().C.orangeSoft; },
};

/**
 * Icon colours for UI chrome — the filled squares on Settings, automation and data rows, insight
 * kinds, the travel blue. Call sites name them in iOS's own system hexes ("#FF9F0A", "#5E5CE6",
 * "#30D158", …), which is exactly right in the default Graphite theme, the iOS look the app shipped
 * with, and clashes in every other one: an iOS indigo square on Gruvbox's warm cream is a stranger
 * on the page. So the hex is read as a *role* rather than a colour — red/pink, orange/yellow/brown,
 * green/mint, grey, or anything blue-to-purple (which becomes the theme's accent) — and drawn in the
 * theme's own colour for that role. Default theme: the hex as given, untouched. A theme that names
 * finer hues (`ThemeSide.hues`: pink, yellow, teal, blue, purple) has those drawn in its own instead.
 *
 * Only for chrome. Category, tag and account colours are the user's data (DATA.md) and are drawn as
 * chosen; never pass one through here.
 */
type HueRole = "red" | "orange" | "green" | "accent" | "muted";

function hueRole(hex: string): HueRole {
  const [r, g, b] = rgb(hex).map((v) => v / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (s < 0.2) return "muted"; // #8E8E93 and other greys (#A2845E brown is ~0.27 and stays orange)
  const h = (max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
  if (h >= 330 || h < 15) return "red"; // red, pink (#FF375F, #FF2D55)
  if (h < 70) return "orange"; // orange, yellow, brown
  if (h < 180) return "green"; // green, mint
  return "accent"; // teal, cyan, blue, indigo, purple
}

/** The finer hue a theme may name for `hex` (`ThemeSide.hues`), or null for red, orange, green and grey. */
function extraHue(hex: string): ExtraHue | null {
  const [r, g, b] = rgb(hex).map((v) => v / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  const l = (max + Math.min(r, g, b)) / 2;
  if (d === 0 || d / (1 - Math.abs(2 * l - 1)) < 0.2) return null;
  const h = (max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
  if (h >= 320 && h < 355) return "pink"; // #FF375F, #FF2D55
  if (h >= 40 && h < 70) return "yellow"; // #FFD60A, #FFCC00
  if (h >= 160 && h < 200) return "teal"; // mint, teal, cyan
  if (h >= 200 && h < 235) return "blue"; // #0A84FF, #007AFF
  if (h >= 235 && h < 320) return "purple"; // indigo #5E5CE6, purple #BF5AF2
  return null;
}

/** WCAG relative luminance of an opaque hex colour. */
function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** WCAG contrast ratio between two opaque hex colours, 1–21. */
function contrast(a: string, b: string): number { const [x, y] = [luminance(a), luminance(b)]; return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
/** White or the page background on `fill`, whichever reads better: dark themes' greens and oranges are pale. */
const glyphOn = (fill: string, side: ThemeSide) => (contrast("#FFFFFF", fill) >= contrast(side.bg, fill) ? "#FFFFFF" : side.bg);

interface Tone { fill: ColorValue; glyph: ColorValue }
const tones = new Map<string, Tone>();

/** `hex` as the current theme draws it: the fill of an icon square, and the glyph on top of it. */
export function themeTone(hex: string): Tone {
  if (current.id === DEFAULT_THEME || !/^#[0-9a-f]{6}/i.test(hex)) return { fill: hex, glyph: "#FFFFFF" };
  const role = hueRole(hex);
  const extra = extraHue(hex);
  const key = `${current.id}:${extra ?? role}`;
  let tone = tones.get(key);
  if (!tone) {
    const { light: l, dark: d } = current;
    // Per side: the theme's own colour for the finer hue where that side names one, else the role's.
    const own = (s: ThemeSide) => (extra ? s.hues?.[extra] : undefined);
    const fill = (s: ThemeSide) => own(s) ?? (role === "muted" ? s.muted : s[role]);
    const glyph = (s: ThemeSide) => (!own(s) && role === "accent" ? s.onAccent : glyphOn(fill(s), s));
    tone = { fill: dyn(fill(l), fill(d)), glyph: dyn(glyph(l), glyph(d)) };
    tones.set(key, tone);
  }
  return tone;
}
/** The fill alone, for a chrome colour drawn on the page rather than as a square (a bar, a lone glyph). */
export const themeHue = (hex: string): ColorValue => themeTone(hex).fill;

/**
 * Styles that follow the theme: `const styles = themed(() => StyleSheet.create({ ... }))`, then
 * `styles.row` as before. The factory runs on first read and again on the first read after the theme
 * changed, so a module-level style sheet never keeps the colours of the theme the app started in.
 */
export function themed<T extends object>(factory: () => T): T {
  let value: T | null = null;
  let id: ThemeId | null = null;
  const get = (): T => {
    if (value === null || id !== current.id) { value = factory(); id = current.id; }
    return value;
  };
  return new Proxy({} as T, {
    get: (_, key) => Reflect.get(get(), key),
    has: (_, key) => Reflect.has(get(), key),
    ownKeys: () => Reflect.ownKeys(get()),
    getOwnPropertyDescriptor: (_, key) => {
      const desc = Reflect.getOwnPropertyDescriptor(get(), key);
      return desc ? { ...desc, configurable: true } : undefined;
    },
  });
}

/**
 * The ordinal ramp for the importance split: one hue — the theme's accent — at three lightness
 * steps, because the levels are *ordered* (essential → in between → could stop) rather than a set
 * of unrelated things. A ramp is the right encoding for ordered tiers; hues would imply they are
 * different kinds of thing rather than degrees of one.
 *
 * Deliberately not green/orange. Those are status colours, and reusing them here would make the
 * card a verdict: "could stop tomorrow" is a fact about a category, not a criticism of it
 * (DATA.md rule 15). `0` is not part of the ramp at all — it is the palest fill on the card,
 * because "nobody has marked this" is an absence, not a fourth level.
 *
 * The lighter steps are the accent mixed 35% and 68% of the way towards the card it is drawn on, on
 * each side separately, so the dark steps are chosen against the dark card rather than flipped.
 * Validated for all eight themes, both sides (OKLab): monotone lightness, adjacent ΔL ≥ 0.10, single
 * hue, light end clear of the surface by ΔL ≥ 0.10.
 */
export const ValueRamp: Readonly<Record<0 | 1 | 2 | 3, ColorValue>> = {
  get 3() { return palette().ramp[3]; },
  get 2() { return palette().ramp[2]; },
  get 1() { return palette().ramp[1]; },
  get 0() { return palette().ramp[0]; },
};

/**
 * What each step of `ValueRamp` is called, wherever the split is shown. Getters rather than strings:
 * the words are looked up when read, in the language the app is in then, not once at import.
 */
export const VALUE_LABEL: Readonly<Record<0 | 1 | 2 | 3, string>> = {
  get 3() { return t("ui.value.high"); },
  get 2() { return t("ui.value.medium"); },
  get 1() { return t("ui.value.low"); },
  get 0() { return t("ui.value.none"); },
};

export const S = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
/** `card` is the one radius every content card uses; `pill` is "fully round" for anything pill-shaped. */
export const R = { sm: 8, md: 12, card: 14, lg: 18, xl: 26, pill: 999 } as const;

/**
 * The floating layer (bottom bar, header pills) casts this; content cards stay flat so the
 * floating chrome is the only thing that reads as lifted off the page. On iOS 26 the glass
 * material carries its own shadow, so this is mostly for the pre-glass fallback.
 */
export const Elevation = Platform.select({
  ios: { shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  default: { elevation: 4 },
}) as ViewStyle;

export const Fonts = {
  mono: Platform.select({ ios: "ui-monospace", default: "monospace" }),
  rounded: Platform.select({ ios: "ui-rounded", default: "normal" }),
};
