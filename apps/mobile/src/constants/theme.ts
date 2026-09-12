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
