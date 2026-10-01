import { DynamicColorIOS, Platform, PlatformColor, type ColorValue, type ViewStyle } from "react-native";

const dyn = (light: string, dark: string) => (Platform.OS === "ios" ? DynamicColorIOS({ light, dark }) : light);

/** Brand palette: the launch-screen off-white is the app background, graphite is the accent; dark mode mirrors both. */
export const Brand = { bg: "#F4F4F1", bgDark: "#141413", card: "#FFFFFF", cardDark: "#1F1F1E", accent: "#2B2B2E", accentDark: "#F4F4F1", border: "#D9D9D4", borderDark: "#2E2E2C" } as const;

/** System colors so the app matches iOS in light/dark automatically. */
export const C = {
  label: Platform.OS === "ios" ? PlatformColor("label") : "#000",
  secondary: Platform.OS === "ios" ? PlatformColor("secondaryLabel") : "#666",
  tertiary: Platform.OS === "ios" ? PlatformColor("tertiaryLabel") : "#999",
  bg: dyn(Brand.bg, Brand.bgDark),
  bgGrouped: dyn(Brand.bg, Brand.bgDark),
  card: dyn(Brand.card, Brand.cardDark),
  fill: Platform.OS === "ios" ? PlatformColor("tertiarySystemFill") : "#eee",
  fill2: Platform.OS === "ios" ? PlatformColor("secondarySystemFill") : "#e5e5ea",
  separator: Platform.OS === "ios" ? PlatformColor("separator") : "#ccc",
  tint: dyn(Brand.accent, Brand.accentDark),
  /** Text and icons drawn on top of `tint`. */
  onTint: dyn("#FFFFFF", Brand.bgDark),
  red: Platform.OS === "ios" ? PlatformColor("systemRed") : "#ff3b30",
  green: Platform.OS === "ios" ? PlatformColor("systemGreen") : "#34c759",
  orange: Platform.OS === "ios" ? PlatformColor("systemOrange") : "#ff9500",
} satisfies Record<string, ColorValue>;

/**
 * The ordinal ramp for the importance split: one hue — the brand graphite — at three lightness
 * steps, because the levels are *ordered* (essential → in between → could stop) rather than a set
 * of unrelated things. A ramp is the right encoding for ordered tiers; hues would imply they are
 * different kinds of thing rather than degrees of one.
 *
 * Deliberately not green/orange. Those are status colours, and reusing them here would make the
 * card a verdict: "could stop tomorrow" is a fact about a category, not a criticism of it
 * (DATA.md rule 15). `0` is not part of the ramp at all — it is the palest fill on the card,
 * because "nobody has marked this" is an absence, not a fourth level.
 *
 * Dark steps are chosen against the dark card rather than flipped. Both sets validated: monotone
 * lightness, adjacent ΔL ≥ 0.06, single hue, light end clear of the surface.
 */
export const ValueRamp = {
  3: dyn("#2B2B2E", "#F4F4F1"),
  2: dyn("#6E6E73", "#A0A09C"),
  1: dyn("#B4B4B8", "#5C5C58"),
  0: Platform.OS === "ios" ? PlatformColor("tertiarySystemFill") : "#eee",
} satisfies Record<0 | 1 | 2 | 3, ColorValue>;

/** What each step of `ValueRamp` is called, wherever the split is shown. */
export const VALUE_LABEL = {
  3: "Could not live without",
  2: "In between",
  1: "Could stop tomorrow",
  0: "Not marked yet",
} as const;

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
