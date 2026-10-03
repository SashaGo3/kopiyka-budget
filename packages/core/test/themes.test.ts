import { expect, test } from "bun:test";
import { DEFAULT_THEME, THEMES, themeOf } from "../src/themes";

test("themeOf reads ids, falls back to the default, and keeps the pre-release default id", () => {
  expect(DEFAULT_THEME).toBe("graphite");
  expect(themeOf("nord")).toBe(THEMES.nord);
  expect(themeOf("kopiyka")).toBe(THEMES.graphite);
  expect(themeOf("nope")).toBe(THEMES.graphite);
  expect(themeOf(null)).toBe(THEMES.graphite);
});
