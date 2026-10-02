import { DynamicColorIOS, Platform, PlatformColor, type ColorValue, type ViewStyle } from "react-native";
import { DEFAULT_THEME, THEMES, themeOf, type Theme, type ThemeId, type ThemeSide } from "@kopiyka/core";
import { t } from "@/i18n";

/**
 * Colours come from the current theme (packages/core/src/themes.ts). A theme is a palette with a
 * light and a dark side; every colour here is a DynamicColorIOS of the two, so the phone's appearance
 * is still followed natively.
 *
 * The names (`C`, `Brand`, `ValueRamp`) are read through getters, so a call site reads the theme that
 * is current *when it reads*. Nothing tries to repaint in place: a change of theme re-keys the root
 * layout and the whole tree mounts again (src/lib/theme.ts), exactly like a change of language. What
 * follows is the one rule: never capture a colour at module scope. Styles go through `themed`, which
 * rebuilds them for the theme that is current.
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
/** `hex` at `alpha` (0–1), as #RRGGBBAA. */
const alpha = (hex: string, a: number) => `${hex.slice(0, 7)}${Math.round(a * 255).toString(16).padStart(2, "0")}`;

interface Palette { C: Record<keyof typeof C, ColorValue>; ramp: Record<0 | 1 | 2 | 3, ColorValue> }

function build(theme: Theme): Palette {
  const { light: l, dark: d } = theme;
  const both = (f: (s: ThemeSide) => string) => dyn(f(l), f(d));
  // The default theme is the graphite the app shipped with, which leans on iOS's own semantic colours
  // for text, fills and status; keeping them means "Kopiyka" stays exactly the app people already
  // know. Every other theme derives the same roles from its own palette, so its greys carry its hue.
  const native = theme.id === DEFAULT_THEME;
  const fill = native ? sys("tertiarySystemFill", "#eee") : dyn(alpha(l.text, 0.07), alpha(d.text, 0.13));
  return {
    C: {
      label: native ? sys("label", "#000") : both((s) => s.text),
      secondary: native ? sys("secondaryLabel", "#666") : both((s) => s.muted),
      tertiary: native ? sys("tertiaryLabel", "#999") : both((s) => mixHex(s.muted, s.bg, 0.4)),
      bg: both((s) => s.bg),
      bgGrouped: both((s) => s.bg),
      card: both((s) => s.card),
      fill,
      fill2: native ? sys("secondarySystemFill", "#e5e5ea") : dyn(alpha(l.text, 0.11), alpha(d.text, 0.2)),
      separator: native ? sys("separator", "#ccc") : both((s) => s.border),
      tint: both((s) => s.accent),
      onTint: both((s) => s.onAccent),
      red: native ? sys("systemRed", "#ff3b30") : both((s) => s.red),
      green: native ? sys("systemGreen", "#34c759") : both((s) => s.green),
      orange: native ? sys("systemOrange", "#ff9500") : both((s) => s.orange),
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
