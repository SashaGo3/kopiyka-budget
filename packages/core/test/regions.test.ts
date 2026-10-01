import { describe, expect, test } from "bun:test";
import { currencyForCountry, currencyForLocale, regionOfLocale } from "../src/regions";

describe("regions", () => {
  test("countries map to their own currency", () => {
    expect(currencyForCountry("PL")).toBe("PLN");
    expect(currencyForCountry("ua")).toBe("UAH");
    expect(currencyForCountry("BR")).toBe("BRL");
    expect(currencyForCountry("GB")).toBe("GBP");
    expect(currencyForCountry("US")).toBe("USD");
  });

  test("the euro area is the euro, adopted or not", () => {
    for (const c of ["DE", "PT", "ES", "ME", "XK", "MC"]) expect(currencyForCountry(c)).toBe("EUR");
  });

  test("anything unknown falls back to the euro rather than to nothing", () => {
    expect(currencyForCountry("ZZ")).toBe("EUR");
    expect(currencyForCountry(null)).toBe("EUR");
    expect(currencyForCountry("")).toBe("EUR");
  });

  test("the region is read out of a locale, in either spelling", () => {
    expect(regionOfLocale("pl-PL")).toBe("PL");
    expect(regionOfLocale("pt_BR")).toBe("BR");
    expect(regionOfLocale("en-GB-u-ca-gregory")).toBe("GB");
    expect(regionOfLocale("PL")).toBe("PL");
    expect(regionOfLocale("uk")).toBeNull();
    expect(regionOfLocale(null)).toBeNull();
  });

  test("a locale without a region gets the fallback, not its language's country", () => {
    expect(currencyForLocale("pt-BR")).toBe("BRL");
    expect(currencyForLocale("pt-PT")).toBe("EUR");
    expect(currencyForLocale("uk")).toBe("EUR");
  });
});
