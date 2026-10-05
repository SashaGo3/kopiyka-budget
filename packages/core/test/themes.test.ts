import { expect, test } from "bun:test";
import { DEFAULT_THEME, THEMES, themeOf } from "../src/themes";

test("themeOf reads ids, falls back to the default, and keeps the pre-release default id", () => {
  expect(DEFAULT_THEME).toBe("graphite");
  expect(themeOf("nord")).toBe(THEMES.nord);
  expect(themeOf("kopiyka")).toBe(THEMES.graphite);
  expect(themeOf("nope")).toBe(THEMES.graphite);
  expect(themeOf(null)).toBe(THEMES.graphite);
});

import { DEFAULT_THEME as DEF, THEME_IDS } from "../src/themes";
import { contrast, LABEL_MIN_DARK, SURFACE_MIN, TEXT_MIN, themeColors, toneColors } from "../src/themeColors";

const opaque = (v: string) => v.startsWith("#") && v.length === 7;

test("every theme's text clears its floor against the page and the card, on both sides", () => {
  const failures: string[] = [];
  for (const id of THEME_IDS) {
    const c = themeColors(THEMES[id]);
    for (const side of [0, 1] as const) {
      const grounds = [c.bg[side], c.card[side]];
      const floors: [keyof typeof c, number][] = [
        ["label", side ? LABEL_MIN_DARK : TEXT_MIN.label], ["secondary", TEXT_MIN.secondary], ["tertiary", TEXT_MIN.tertiary],
        ["red", TEXT_MIN.coloured], ["green", TEXT_MIN.coloured], ["orange", TEXT_MIN.coloured],
      ];
      for (const [role, min] of floors) {
        for (const g of grounds) {
          const r = contrast(c[role][side], g);
          if (r < min - 0.01 && !/^#(FFFFFF|000000)$/.test(c[role][side])) failures.push(`${id} ${side ? "dark" : "light"} ${role} ${c[role][side]} on ${g}: ${r.toFixed(2)} < ${min}`);
        }
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
  const nord = toneColors(THEMES.nord, "#0A84FF");
  expect(nord.fill).toEqual([THEMES.nord.light.hues!.blue!, THEMES.nord.dark.hues!.blue!]);
  // A grey is the theme's muted colour.
  expect(toneColors(THEMES.gruvbox, "#8E8E93").fill).toEqual([THEMES.gruvbox.light.muted, THEMES.gruvbox.dark.muted]);
});
