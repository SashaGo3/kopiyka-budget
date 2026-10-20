import { expect, test } from "bun:test";
import { DEFAULT_THEME, THEMES, themeOf } from "../src/themes";

test("themeOf reads ids, falls back to the default, and keeps the pre-release default id", () => {
  expect(DEFAULT_THEME).toBe("graphite");
  expect(themeOf("siri")).toBe(THEMES.siri);
  // A theme 1.0.3 shipped and 1.1.0 removed reads as the default.
  expect(themeOf("nord")).toBe(THEMES.graphite);
  expect(themeOf("kopiyka")).toBe(THEMES.graphite);
  expect(themeOf("nope")).toBe(THEMES.graphite);
  expect(themeOf(null)).toBe(THEMES.graphite);
});

import { DEFAULT_THEME as DEF, THEME_IDS } from "../src/themes";
import { apca, contrast, ICON_LC, MIN_CHROMA, oklch, SURFACE_MIN, TEXT_LC, themeColors, toneColors } from "../src/themeColors";

const opaque = (v: string) => v.startsWith("#") && v.length === 7;

test("every theme's text sits in its APCA band against the page and the card, on both sides", () => {
  const failures: string[] = [];
  for (const id of THEME_IDS) {
    const c = themeColors(THEMES[id]);
    for (const side of [0, 1] as const) {
      const grounds = [c.bg[side], c.card[side]].filter((g) => g.startsWith("#")).map((g) => g.slice(0, 7));
      const bands: [keyof typeof c, number, number][] = [
        ["label", side ? TEXT_LC.label.loDark : TEXT_LC.label.lo, side ? TEXT_LC.label.hiDark : TEXT_LC.label.hi],
        ["secondary", TEXT_LC.secondary.lo, TEXT_LC.secondary.hi], ["tertiary", TEXT_LC.tertiary.lo, TEXT_LC.tertiary.hi],
        ...(["red", "green", "orange"] as const).map((r): [keyof typeof c, number, number] => [r, side ? TEXT_LC.coloured.loDark : TEXT_LC.coloured.lo, side ? TEXT_LC.coloured.hiDark : TEXT_LC.coloured.hi]),
      ];
      for (const [role, lo, hi] of bands) {
        const fg = c[role][side];
        if (/^#(FFFFFF|000000)$/.test(fg)) continue;
        const lcs = grounds.map((g) => apca(fg, g));
        // The ceiling gives way only where page and card are further apart than the band is wide:
        // then the colour sits right at the floor on the page, and readability wins.
        if (Math.min(...lcs) < lo - 0.5 || (lcs[lcs.length - 1]! > hi + 0.5 && Math.min(...lcs) > lo + 1.5)) failures.push(`${id} ${side ? "dark" : "light"} ${role} ${fg}: Lc ${lcs.map((l) => l.toFixed(0)).join("/")} outside ${lo}–${hi}`);
      }
    }
  }
  expect(failures).toEqual([]);
});

test("cards stand off the page and hairlines off the card (themes that draw their own surfaces)", () => {
  for (const id of THEME_IDS) {
    if (id === DEF) continue;
    const c = themeColors(THEMES[id]);
    for (const side of [0, 1] as const) {
      expect(contrast(c.card[side], c.bg[side])).toBeGreaterThanOrEqual(SURFACE_MIN.card - 0.01);
      expect(contrast(c.separator[side], c.card[side])).toBeGreaterThanOrEqual(SURFACE_MIN.separator - 0.01);
    }
  }
});

test("button text on the accent stays readable", () => {
  for (const id of THEME_IDS) {
    const c = themeColors(THEMES[id]);
    for (const side of [0, 1] as const) {
      const accent = THEMES[id][side ? "dark" : "light"].accent;
      // Never worse than the palette's own pairing.
      expect(contrast(c.onTint[side], c.tint[side])).toBeGreaterThanOrEqual(Math.min(4.5, contrast(c.onTint[side], accent)) - 0.01);
    }
  }
});

test("every value is a colour native can read", () => {
  for (const id of THEME_IDS) {
    for (const [role, pair] of Object.entries(themeColors(THEMES[id]))) {
      for (const v of pair) expect(opaque(v) || /^#[0-9A-F]{8}$/.test(v) || (id === DEF && v.startsWith("@")), `${id} ${role} ${v}`).toBe(true);
    }
  }
});

test("chrome tones: the default theme draws the hex as given, others in their own palette", () => {
  expect(toneColors(THEMES.graphite, "#FF9F0A")).toEqual({ fill: ["#FF9F0A", "#FF9F0A"], glyph: ["#FFFFFF", "#FFFFFF"] });
  // A vivid palette colour that already holds its glyph is drawn as the palette has it: Una's light blue.
  expect(toneColors(THEMES.catppuccin, "#0A84FF").fill[0]).toBe(THEMES.catppuccin.light.hues!.blue!);
  // A muted one is first raised to MIN_CHROMA: Una's pastel dark green (#A6E3A1, C 0.10), and its incomes with it.
  expect(oklch(toneColors(THEMES.catppuccin, "#30D158").fill[1]).c).toBeGreaterThan(MIN_CHROMA - 0.01);
  expect(oklch(themeColors(THEMES.catppuccin).green[1]).c).toBeGreaterThan(MIN_CHROMA - 0.01);
  // A grey is the theme's muted colour.
  expect(toneColors(THEMES.siri, "#8E8E93").fill[0]).toBe(THEMES.siri.light.muted);
});

test("an icon's glyph reads on its square in every theme", () => {
  const failures: string[] = [];
  for (const id of THEME_IDS) {
    if (id === DEF) continue;
    for (const hex of ["#FF9F0A", "#5E5CE6", "#30D158", "#0A84FF", "#FF375F", "#8E8E93", "#64D2FF", "#BF5AF2", "#FFD60A", "#A2845E"]) {
      const t = toneColors(THEMES[id], hex);
      for (const side of [0, 1] as const) {
        const r = apca(t.glyph[side], t.fill[side]);
        if (r < ICON_LC - 0.5) failures.push(`${id} ${side ? "dark" : "light"} ${hex}: ${t.glyph[side]} on ${t.fill[side]} ${r.toFixed(2)}`);
      }
    }
  }
  expect(failures).toEqual([]);
});
