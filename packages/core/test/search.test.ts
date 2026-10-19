import { describe, expect, test } from "bun:test";
import { searchEntry, searchMatches, searchTokens } from "../src/search";

const e = searchEntry(["Starbucks Kraków", "Кава з друзями", "Food › Coffee", "Trip: Lisbon", "7-Eleven"], [-1250, 300]);
const hit = (q: string) => searchMatches(e, searchTokens(q));

describe("search", () => {
  test("case and accents, any alphabet", () => {
    expect(hit("krakow")).toBe(true);
    expect(hit("КАВА")).toBe(true);
    expect(hit("друзі")).toBe(true);   // another ending of the same word
    expect(hit("собака")).toBe(false);
  });
  test("every word must be found", () => {
    expect(hit("coffee lisbon")).toBe(true);
    expect(hit("coffee porto")).toBe(false);
  });
  test("a slip is forgiven from four letters", () => {
    expect(hit("starbuks")).toBe(true);
    expect(hit("lisbno")).toBe(true);
    expect(hit("cofe")).toBe(true);
    expect(hit("tea")).toBe(false);
  });
  test("numbers match amounts", () => {
    expect(hit("12.50")).toBe(true);
    expect(hit("12,5")).toBe(true);
    expect(hit("12")).toBe(true);
    expect(hit("12.51")).toBe(false);
    expect(hit("3")).toBe(true);
    expect(hit("7")).toBe(true);
    expect(hit("99")).toBe(false);
  });
});
