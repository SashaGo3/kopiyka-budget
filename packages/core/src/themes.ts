/**
 * Palette sources, all under the MIT licence (the app and the site credit them on the theme screen
 * and the themes section): Solarized — Ethan Schoonover (github.com/altercation/solarized);
 * Catppuccin — github.com/catppuccin/catppuccin; Gruvbox — Pavel Pertsev (github.com/morhetz/gruvbox);
 * Nord — Arctic Ice Studio (github.com/nordtheme/nord); Tokyo Night — enkia
 * (github.com/enkia/tokyo-night-vscode-theme); Rosé Pine — github.com/rose-pine/rose-pine-theme;
 * GitHub — Primer primitives (github.com/primer/primitives). Only colour values are taken.
 *
 * The colour themes, as plain data: the app (apps/mobile/src/constants/theme.ts), the generated app
 * icons (apps/mobile/scripts/icons) and the website (site/) all read their colours from here, so a
 * theme looks the same in all three. Every theme has a light and a dark side and follows the phone's
 * appearance; a theme is a palette, not a mode.
 *
 * The id is what `meta.theme` stores (DATA.md rule 7) and what names an alternate app icon, so like a
 * preset key it is forever: add themes, never rename one. (The default was renamed once, "kopiyka" →
 * "graphite", before any release carried it; `themeOf` still reads the old id.) The palettes are the editor themes'
 * published colours; where one of them reads poorly as text on its own background (Nord's green on
 * Snow Storm), the darker shade the theme itself uses for that role is taken instead, and an accent
 * or muted grey that missed WCAG AA (4.5:1 for button text on the accent and for muted text on both
 * `bg` and `card`) has been nudged just far enough to pass. The site build warns if one regresses.
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
}

export interface Theme {
  id: ThemeId;
  light: ThemeSide;
  dark: ThemeSide;
}

export const THEME_IDS = ["graphite", "solarized", "catppuccin", "gruvbox", "nord", "tokyonight", "rosepine", "github"] as const;
export type ThemeId = (typeof THEME_IDS)[number];
export const DEFAULT_THEME: ThemeId = "graphite";

export const THEMES: Record<ThemeId, Theme> = {
  graphite: {
    id: "graphite",
    light: { bg: "#F4F4F1", card: "#FFFFFF", text: "#141413", muted: "#6E6E73", accent: "#2B2B2E", onAccent: "#FFFFFF", border: "#D9D9D4", red: "#FF3B30", green: "#34C759", orange: "#FF9500" },
    dark: { bg: "#141413", card: "#1F1F1E", text: "#F4F4F1", muted: "#A0A09C", accent: "#F4F4F1", onAccent: "#141413", border: "#2E2E2C", red: "#FF453A", green: "#30D158", orange: "#FF9F0A" },
  },
  solarized: {
    id: "solarized",
    light: { bg: "#EEE8D5", card: "#FDF6E3", text: "#073642", muted: "#526D76", accent: "#217AB9", onAccent: "#FFFFFF", border: "#D9D2BC", red: "#DC322F", green: "#859900", orange: "#CB4B16" },
    dark: { bg: "#002B36", card: "#073642", text: "#EEE8D5", muted: "#93A1A1", accent: "#3794D6", onAccent: "#002B36", border: "#0E4552", red: "#DC322F", green: "#859900", orange: "#CB4B16" },
  },
  catppuccin: {
    id: "catppuccin",
    light: { bg: "#E6E9EF", card: "#EFF1F5", text: "#4C4F69", muted: "#64677E", accent: "#8839EF", onAccent: "#FFFFFF", border: "#CCD0DA", red: "#D20F39", green: "#40A02B", orange: "#FE640B" },
    dark: { bg: "#1E1E2E", card: "#313244", text: "#CDD6F4", muted: "#A6ADC8", accent: "#CBA6F7", onAccent: "#1E1E2E", border: "#45475A", red: "#F38BA8", green: "#A6E3A1", orange: "#FAB387" },
  },
  gruvbox: {
    id: "gruvbox",
    light: { bg: "#F2E5BC", card: "#FBF1C7", text: "#3C3836", muted: "#6F645B", accent: "#AF3A03", onAccent: "#FFFFFF", border: "#D5C4A1", red: "#9D0006", green: "#79740E", orange: "#B57614" },
    dark: { bg: "#282828", card: "#3C3836", text: "#EBDBB2", muted: "#AFA089", accent: "#FE8019", onAccent: "#282828", border: "#504945", red: "#FB4934", green: "#B8BB26", orange: "#FABD2F" },
  },
  nord: {
    id: "nord",
    light: { bg: "#E5E9F0", card: "#ECEFF4", text: "#2E3440", muted: "#4C566A", accent: "#56779E", onAccent: "#FFFFFF", border: "#D8DEE9", red: "#BF616A", green: "#5E8A4E", orange: "#C2693E" },
    dark: { bg: "#2E3440", card: "#3B4252", text: "#ECEFF4", muted: "#D8DEE9", accent: "#88C0D0", onAccent: "#2E3440", border: "#434C5E", red: "#BF616A", green: "#A3BE8C", orange: "#D08770" },
  },
  tokyonight: {
    id: "tokyonight",
    light: { bg: "#E1E2E7", card: "#EDEEF2", text: "#3760BF", muted: "#4C5A8C", accent: "#2A73D6", onAccent: "#FFFFFF", border: "#C4C8DA", red: "#F52A65", green: "#587539", orange: "#B15C00" },
    dark: { bg: "#1A1B26", card: "#24283B", text: "#C0CAF5", muted: "#A9B1D6", accent: "#7AA2F7", onAccent: "#1A1B26", border: "#2F3549", red: "#F7768E", green: "#9ECE6A", orange: "#FF9E64" },
  },
  rosepine: {
    id: "rosepine",
    light: { bg: "#FAF4ED", card: "#FFFAF3", text: "#575279", muted: "#716C8D", accent: "#826E98", onAccent: "#FFFFFF", border: "#DFDAD9", red: "#B4637A", green: "#286983", orange: "#D7827E" },
    dark: { bg: "#191724", card: "#1F1D2E", text: "#E0DEF4", muted: "#908CAA", accent: "#C4A7E7", onAccent: "#191724", border: "#26233A", red: "#EB6F92", green: "#31748F", orange: "#F6C177" },
  },
  github: {
    id: "github",
    // Primer's current functional colours; the accent is GitHub's green primary button
    // (bgColor-success-emphasis, white text), not its link blue, which is what reads as GitHub.
    light: { bg: "#F6F8FA", card: "#FFFFFF", text: "#1F2328", muted: "#59636E", accent: "#1F883D", onAccent: "#FFFFFF", border: "#D1D9E0", red: "#D1242F", green: "#1A7F37", orange: "#BC4C00" },
    dark: { bg: "#0D1117", card: "#151B23", text: "#F0F6FC", muted: "#9198A1", accent: "#238636", onAccent: "#FFFFFF", border: "#3D444D", red: "#F85149", green: "#3FB950", orange: "#DB6D28" },
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
