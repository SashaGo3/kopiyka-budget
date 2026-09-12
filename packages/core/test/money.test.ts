import { describe, expect, test } from "bun:test";
import { formatMinor, parseAmount, toMinor, fromMinor, convertMinor } from "../src/money";

describe("money", () => {
  test("minor unit round trip", () => {
    expect(toMinor(769.43, "PLN")).toBe(76943);
    expect(fromMinor(76943, "PLN")).toBe(769.43);
    expect(toMinor(0.1 + 0.2, "EUR")).toBe(30);
    expect(toMinor(1000, "JPY")).toBe(1000);
  });
  test("parse", () => {
    expect(parseAmount("1 234,56", "EUR")).toBe(123456);
    expect(parseAmount("-12", "EUR")).toBe(-1200);
    expect(parseAmount("abc", "EUR")).toBeNull();
    expect(parseAmount("", "EUR")).toBeNull();
  });
  test("format", () => {
    expect(formatMinor(-123456, "PLN")).toBe("-1 234.56");
    expect(formatMinor(500, "EUR", { sign: true })).toBe("+5.00");
    expect(formatMinor(7, "EUR")).toBe("0.07");
  });
  test("convert", () => {
    expect(convertMinor(100000, "EUR", "PLN", 4.3)).toBe(430000);
  });
});

import { sumInBase } from "../src/money";
describe("net worth in base", () => {
  test("converts known currencies and reports missing ones", () => {
    const r = sumInBase([{ currency: "PLN", minor: 100000 }, { currency: "EUR", minor: 10000 }, { currency: "USD", minor: 5000 }], "PLN",
      (f, t) => (f === "EUR" && t === "PLN" ? 4.3 : null));
    expect(r).toEqual({ minor: 143000, missing: ["USD"] });
  });
});
