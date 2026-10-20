import { DynamicColorIOS, Platform, PlatformColor, type ColorValue, type ViewStyle } from "react-native";
import { DEFAULT_THEME, SYSTEM_FALLBACK, THEMES, THEME_IDS, isHexColor, themeColors, themeOf, toneColors, type ColorPair, type ColorRole, type Theme, type ThemeId } from "@kopiyka/core";
import { defineThemeColors, type ThemeColorTable } from "@/lib/bridge";
import { t } from "@/i18n";

/**
 * Colours come from the current theme. What each role is drawn in — every theme, light and dark,
 * contrast floors applied — is data in @kopiyka/core (themeColors.ts); this file turns it into
 * values React Native draws.
 *
 * On iOS every colour is *named*: the whole table is handed to native once, at import, and `C.label`
 * is `PlatformColor("kp.label")`, which native resolves in whatever theme is current
 * (native/KPThemeColors.swift). A theme switch changes that, natively, and nothing in React renders
 * or re-mounts at all — the same way the phone's light/dark switch has always worked. That is what
 * keeps a switch from ever leaving a screen empty: there is no re-mount to go wrong.
 *
 * Off iOS, or on a build whose native side cannot do it (`NAMED_COLORS` false), colours are plain
 * values of the current theme and a switch re-mounts the tree instead (src/app/_layout.tsx).
 *
 * The one rule either way: never capture a colour at module scope. Styles go through `themed`, and
 * the few things a `_layout` draws take the theme as an argument (`layoutColor`).
 */
let current: Theme = THEMES[DEFAULT_THEME];

/** The theme every colour is read from now. */
export function currentTheme(): Theme { return current; }
/** Set by src/lib/theme.ts, which owns the stored choice; anything else calls `setTheme` there. */
export function applyThemePalette(id: string | null | undefined): void { current = themeOf(id); }

const isSystem = (v: string) => v.startsWith("@");
const fallback = (v: string, dark: boolean) => (isSystem(v) ? SYSTEM_FALLBACK[v.slice(1)]?.[dark ? 1 : 0] ?? "#00000000" : v);

/** A light/dark pair as one plain value: DynamicColorIOS, a system colour, or the light side off iOS. */
function plain([light, dark]: ColorPair): ColorValue {
  if (Platform.OS !== "ios") return fallback(light, false);
  if (isSystem(light) && light === dark) return PlatformColor(light.slice(1));
  return DynamicColorIOS({ light: fallback(light, false), dark: fallback(dark, true) });
}

/** Every role of every theme, under the names `C` asks for. */
function table(): ThemeColorTable {
  const out: ThemeColorTable = {};
  for (const id of THEME_IDS) {
    for (const [role, pair] of Object.entries(themeColors(THEMES[id]))) {
      (out[`kp.${role}`] ??= {})[id] = [pair[0], pair[1]];
    }
  }
  return out;
}

/** Whether colours are named and resolved natively (see above). Decided once, before anything renders. */
export const NAMED_COLORS: boolean = defineThemeColors(table());

const namedCache = new Map<string, ColorValue>();
const named = (name: string): ColorValue => {
  let v = namedCache.get(name);
  if (!v) { v = PlatformColor(name); namedCache.set(name, v); }
  return v;
};

// One set of plain values per theme, built on first use: the same object every time it is read.
const plainCache = new Map<ThemeId, Record<ColorRole, ColorValue>>();
function plainColors(id: ThemeId): Record<ColorRole, ColorValue> {
  let p = plainCache.get(id);
  if (!p) {
    const c = themeColors(THEMES[id]);
    p = Object.fromEntries(Object.entries(c).map(([k, pair]) => [k, plain(pair)])) as Record<ColorRole, ColorValue>;
    plainCache.set(id, p);
  }
  return p;
}

const role = (r: ColorRole): ColorValue => (NAMED_COLORS ? named(`kp.${r}`) : plainColors(current.id)[r]);

/**
 * A colour for something a `_layout` draws (the tab tint, sheet backgrounds), which re-renders on a
 * switch rather than relying on native re-resolution: a plain value of exactly that theme.
 */
export function layoutColor(theme: ThemeId, r: ColorRole): ColorValue { return plainColors(theme)[r]; }

/** The theme's own colours as plain hex, for the few places that need a string rather than a ColorValue. */
export const Brand = {
  get bg() { return current.light.bg; }, get bgDark() { return current.dark.bg; },
  get card() { return current.light.card; }, get cardDark() { return current.dark.card; },
  get accent() { return current.light.accent; }, get accentDark() { return current.dark.accent; },
  get border() { return current.light.border; }, get borderDark() { return current.dark.border; },
};

/** The app's semantic colours, in the current theme. */
export const C = {
  get label(): ColorValue { return role("label"); },
  get secondary(): ColorValue { return role("secondary"); },
  get tertiary(): ColorValue { return role("tertiary"); },
  get bg(): ColorValue { return role("bg"); },
  get bgGrouped(): ColorValue { return role("bgGrouped"); },
  get card(): ColorValue { return role("card"); },
  get fill(): ColorValue { return role("fill"); },
  get fill2(): ColorValue { return role("fill2"); },
  get separator(): ColorValue { return role("separator"); },
  get tint(): ColorValue { return role("tint"); },
  /** Text and icons drawn on top of `tint`. */
  get onTint(): ColorValue { return role("onTint"); },
  get red(): ColorValue { return role("red"); },
  get green(): ColorValue { return role("green"); },
  get orange(): ColorValue { return role("orange"); },
  /** The status colours as a wash behind text: amount pills, banners. */
  get redSoft(): ColorValue { return role("redSoft"); },
  get greenSoft(): ColorValue { return role("greenSoft"); },
  get orangeSoft(): ColorValue { return role("orangeSoft"); },
};

interface Tone { fill: ColorValue; glyph: ColorValue }
const tones = new Map<string, Tone>();

/**
 * `hex` as the current theme draws it in UI chrome: the fill of an icon square, and the glyph on top
 * of it (core's `toneColors` says how a hex is read as a role). Only for chrome — category, tag and
 * account colours are the user's data and are drawn as chosen; never pass one through here.
 */
export function themeTone(hex: string): Tone {
  if (!isHexColor(hex)) return { fill: hex, glyph: "#FFFFFF" };
  const key = hex.toUpperCase();
  if (NAMED_COLORS) {
    let tone = tones.get(key);
    if (!tone) {
      const fill = `kp.tone.${key.slice(1)}.fill`;
      const glyph = `kp.tone.${key.slice(1)}.glyph`;
      const entries: ThemeColorTable = { [fill]: {}, [glyph]: {} };
      for (const id of THEME_IDS) {
        const c = toneColors(THEMES[id], key);
        entries[fill]![id] = [c.fill[0], c.fill[1]];
        entries[glyph]![id] = [c.glyph[0], c.glyph[1]];
      }
      tone = defineThemeColors(entries) ? { fill: named(fill), glyph: named(glyph) } : plainTone(current.id, key);
      tones.set(key, tone);
    }
    return tone;
  }
  return plainTone(current.id, key);
}
function plainTone(id: ThemeId, hex: string): Tone {
  const k = `${id}:${hex}`;
  let tone = tones.get(k);
  if (!tone) {
    const c = toneColors(THEMES[id], hex);
    tone = { fill: plain(c.fill), glyph: plain(c.glyph) };
    tones.set(k, tone);
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
  get 3() { return role("ramp3"); },
  get 2() { return role("ramp2"); },
  get 1() { return role("ramp1"); },
  get 0() { return role("ramp0"); },
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
