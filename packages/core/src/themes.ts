/**
 * Four themes, each named after a cat: Pusik (the default, graphite), Siri, Tadeusz & Kastuś, and
 * Una. Una's palette is Catppuccin's (github.com/catppuccin/catppuccin, MIT; the app and the site
 * credit it), only its colour values taken. 1.0.3 shipped six more editor palettes — Solarized,
 * Gruvbox, Nord, Tokyo Night, Rosé Pine, GitHub — removed in 1.1.0: a phone still storing one of
 * those ids reads it as the default (`themeOf`), and an app icon set for one goes back to the primary
 * icon, because the alternate is no longer in the bundle.
 *
 * The colour themes, as plain data: the app (apps/mobile/src/constants/theme.ts), the generated app
 * icons (apps/mobile/scripts/icons) and the website (site/) all read their colours from here, so a
 * theme looks the same in all three. Every theme has a light and a dark side and follows the phone's
 * appearance; a theme is a palette, not a mode.
 *
 * The id is what `meta.theme` stores (DATA.md rule 7) and what names an alternate app icon, so like a
 * preset key it is forever: add themes, never rename one. (The default was renamed once, "kopiyka" →
 * "graphite", before any release carried it; `themeOf` still reads the old id. The ids keep their
 * first names — "catppuccin" is Una — since a name is only a label.) Text and status colours are
 * held to contrast bands and a minimum chroma in themeColors.ts; the site build warns if a palette
 * regresses.
 */

export interface ThemeSide {
  /** Page background. */
  bg: string;
  /** Cards and grouped rows, one step off `bg`. */
  card: string;
  /** Primary text. */
  text: string;
  /** Secondary text: subtitles, captions. */
  muted: string;
  /** The accent: buttons, selection, the app icon's letter. */
  accent: string;
  /** Text and icons drawn on top of `accent`. */
  onAccent: string;
  /** Hairlines between rows. */
  border: string;
  red: string;
  green: string;
  orange: string;
  /**
   * More hues for the icon squares in the app's chrome (apps/mobile/src/constants/theme.ts,
   * `themeTone`). Without them an iOS blue, indigo or purple square is drawn in the accent, pink in
   * red, yellow in orange, teal in the accent or green — which left a theme with only a handful of
   * icon colours, and one whose accent is green (GitHub) with half of Settings in one green. Each
   * theme takes these from its own palette; a hue it has no colour of its own for (Gruvbox's yellow
   * is already its orange, Rosé Pine's rose is its orange) is left out and falls back to that role.
   */
  hues?: Partial<Record<ExtraHue, string>>;
}

export type ExtraHue = "pink" | "yellow" | "teal" | "blue" | "purple";

export interface Theme {
  id: ThemeId;
  light: ThemeSide;
  dark: ThemeSide;
}

export const THEME_IDS = ["graphite", "siri", "tadeusz", "catppuccin"] as const;
export type ThemeId = (typeof THEME_IDS)[number];
export const DEFAULT_THEME: ThemeId = "graphite";

export const THEMES: Record<ThemeId, Theme> = {
  graphite: {
    id: "graphite",
    light: { bg: "#F4F4F1", card: "#FFFFFF", text: "#141413", muted: "#6E6E73", accent: "#2B2B2E", onAccent: "#FFFFFF", border: "#D9D9D4", red: "#FF3B30", green: "#34C759", orange: "#FF9500" },
    dark: { bg: "#141413", card: "#1F1F1E", text: "#F4F4F1", muted: "#A0A09C", accent: "#F4F4F1", onAccent: "#141413", border: "#2E2E2C", red: "#FF453A", green: "#30D158", orange: "#FF9F0A" },
  },
  // The app's own, with cats: Siri is a grey-fawn tabby with a terracotta nose (taupe surfaces, the nose
  // as the accent); Tadeusz and Kastuś are a pair of gingers (cream surfaces, ginger accent).
  siri: {
    id: "siri",
    light: { bg: "#EEEAE5", card: "#FAF8F5", text: "#2A2420", muted: "#6B6159", accent: "#A9573F", onAccent: "#FFFFFF", border: "#DCD5CD", red: "#D93A2B", green: "#2E9A4C", orange: "#D9731A",
      hues: { pink: "#D2607A", blue: "#4F78A8", purple: "#8462A6", yellow: "#C49516", teal: "#2F8C86" } },
    dark: { bg: "#1A1715", card: "#26221F", text: "#F2ECE6", muted: "#ABA096", accent: "#E8A089", onAccent: "#1A1715", border: "#3A3430", red: "#FF5A4E", green: "#3ED16A", orange: "#FFA040",
      hues: { pink: "#F38CA3", blue: "#86A8DA", purple: "#B69CDB", yellow: "#EBC45A", teal: "#5EC6BB" } },
  },
  tadeusz: {
    id: "tadeusz",
    light: { bg: "#FAEFE2", card: "#FFF9F1", text: "#2E1A0E", muted: "#765843", accent: "#B84A08", onAccent: "#FFFFFF", border: "#EBD6BF", red: "#D3261E", green: "#2C8F43", orange: "#E07A0A",
      hues: { pink: "#D8577A", blue: "#3A72BE", purple: "#8657BD", yellow: "#D69A12", teal: "#24897F" } },
    dark: { bg: "#1C120B", card: "#2A1C12", text: "#FBEBDC", muted: "#C2A189", accent: "#FF8A3D", onAccent: "#1C120B", border: "#3E2B1D", red: "#FF5A4A", green: "#45C963", orange: "#FFB13B",
      hues: { pink: "#FF8FA8", blue: "#7FB0FF", purple: "#C29BFF", yellow: "#FFD15C", teal: "#4FD1C0" } },
  },
  catppuccin: {
    id: "catppuccin",
    light: { bg: "#E6E9EF", card: "#EFF1F5", text: "#4C4F69", muted: "#64677E", accent: "#8839EF", onAccent: "#FFFFFF", border: "#CCD0DA", red: "#D20F39", green: "#40A02B", orange: "#FE640B",
      hues: { blue: "#1E66F5", purple: "#7287FD", pink: "#EA76CB", yellow: "#DF8E1D", teal: "#179299" } },
    dark: { bg: "#1E1E2E", card: "#313244", text: "#CDD6F4", muted: "#A6ADC8", accent: "#CBA6F7", onAccent: "#1E1E2E", border: "#45475A", red: "#F38BA8", green: "#A6E3A1", orange: "#FAB387",
      hues: { blue: "#89B4FA", purple: "#B4BEFE", pink: "#F5C2E7", yellow: "#F9E2AF", teal: "#94E2D5" } },
  },
};

/**
 * Ids a theme was stored under before it got its current one, read as that theme. The default was
 * "kopiyka" in pre-release 1.0.3 builds (dev and TestFlight installs may have it in `meta.theme`, and
 * a backup from one carries it); it was renamed "graphite" before release, because that is what the
 * palette is. Reading the old id falls to the default anyway, but saying so keeps it true if the
 * default ever changes.
 */
const RENAMED: Record<string, ThemeId> = { kopiyka: "graphite" };

/** A stored `meta.theme` as a theme: anything unknown (an older build, a typo in an edited export) is the default. */
export function themeOf(id: string | null | undefined): Theme {
  const key = RENAMED[id ?? ""] ?? id ?? "";
  return THEMES[(THEME_IDS as readonly string[]).includes(key) ? (key as ThemeId) : DEFAULT_THEME];
}
