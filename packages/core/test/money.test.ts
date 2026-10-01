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

import { oneCurrency, sumInBase } from "../src/money";
describe("net worth in base", () => {
  test("converts known currencies and reports missing ones", () => {
    const r = sumInBase([{ currency: "PLN", minor: 100000 }, { currency: "EUR", minor: 10000 }, { currency: "USD", minor: 5000 }], "PLN",
      (f, t) => (f === "EUR" && t === "PLN" ? 4.3 : null));
    expect(r).toEqual({ minor: 143000, missing: ["USD"] });
  });
});

describe("oneCurrency", () => {
  const rates: Record<string, number> = { "USD>PLN": 4, "EUR>PLN": 4.3 };
  const rateFor = (from: string, to: string) => (from === to ? 1 : rates[`${from}>${to}`] ?? null);
  const minors = (r: ReturnType<typeof oneCurrency>) => r.totals.map((t) => t.minor);
  const approx = (r: ReturnType<typeof oneCurrency>) => r.totals.map((t) => t.approx);

  test("nothing at all reads as zero in the base currency", () => {
    const r = oneCurrency([[], []], "PLN", rateFor);
    expect(r.currency).toBe("PLN");
    expect(minors(r)).toEqual([0, 0]);
    expect(approx(r)).toEqual([false, false]);
  });

  test("one currency is kept exactly, even when it is not the base one", () => {
    const r = oneCurrency([[{ currency: "USD", minor: 250000 }], [{ currency: "USD", minor: -30000 }]], "PLN", rateFor);
    expect(r.currency).toBe("USD");
    expect(minors(r)).toEqual([250000, -30000]);
    expect(approx(r)).toEqual([false, false]);
  });

  test("a mixed set converts to the base currency and says which numbers it converted", () => {
    const r = oneCurrency([[{ currency: "PLN", minor: 100000 }, { currency: "USD", minor: 100000 }], []], "PLN", rateFor);
    expect(r.currency).toBe("PLN");
    expect(minors(r)[0]).toBe(100000 + 400000);
    expect(approx(r)).toEqual([true, false]);
    expect(r.totals[0]!.converted).toEqual([{ currency: "USD", minor: 100000 }]);
  });

  test("a group already in the base currency is exact, whatever the other groups needed", () => {
    // Dollar income beside zloty expenses: the pair shares one currency, but only income was converted.
    const r = oneCurrency([[{ currency: "USD", minor: 300000 }], [{ currency: "PLN", minor: -50000 }]], "PLN", rateFor);
    expect(r.currency).toBe("PLN");
    expect(minors(r)).toEqual([1200000, -50000]);
    expect(approx(r)).toEqual([true, false]);
    expect(r.totals[1]!.converted).toEqual([]);
  });

  test("a currency with no rate is left out and named, once", () => {
    const r = oneCurrency([[{ currency: "PLN", minor: 100000 }, { currency: "GBP", minor: 5000 }], [{ currency: "GBP", minor: -5000 }]], "PLN", rateFor);
    expect(minors(r)).toEqual([100000, 0]);
    expect(r.missing).toEqual(["GBP"]);
  });

  test("groups share one currency, so they are never printed in two", () => {
    const r = oneCurrency([[{ currency: "USD", minor: 100000 }], [{ currency: "EUR", minor: -50000 }]], "PLN", rateFor);
    expect(r.currency).toBe("PLN");
    expect(approx(r)).toEqual([true, true]);
  });
});
