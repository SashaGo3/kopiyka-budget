import { describe, expect, it } from "bun:test";
import { receiptSplit, shareEntered, splitAmounts } from "../src/split";

describe("splitAmounts", () => {
  it("gives the entry what the parts leave, itself first", () => {
    expect(splitAmounts(35000, [12000, 3000])).toEqual([20000, 12000, 3000]);
  });

  it("reads the total as a magnitude, so an expense splits like anything else", () => {
    expect(splitAmounts(-35000, [12000])).toEqual([23000, 12000]);
  });

  it("refuses to leave the entry with nothing", () => {
    expect(splitAmounts(10000, [10000])).toBeNull();
    expect(splitAmounts(10000, [6000, 5000])).toBeNull();
  });

  it("refuses a part that is not a positive whole number of minor units", () => {
    expect(splitAmounts(10000, [0])).toBeNull();
    expect(splitAmounts(10000, [-500])).toBeNull();
    expect(splitAmounts(10000, [12.5])).toBeNull();
  });

  it("is not a split without a part, or without a total", () => {
    expect(splitAmounts(10000, [])).toBeNull();
    expect(splitAmounts(0, [100])).toBeNull();
  });

  it("always adds back up to the total", () => {
    const parts = [333, 333, 1];
    const all = splitAmounts(1000, parts)!;
    expect(all.reduce((a, b) => a + b, 0)).toBe(1000);
  });
});

describe("shareEntered", () => {
  it("shares the charge in the same proportions", () => {
    expect(shareEntered(10000, [5000, 5000])).toEqual([5000, 5000]);
    expect(shareEntered(10000, [7500, 2500])).toEqual([7500, 2500]);
  });

  it("keeps the sign of the original", () => {
    expect(shareEntered(-10000, [7500, 2500])).toEqual([-7500, -2500]);
  });

  it("gives the rounding to the entry itself, so the shares still add up", () => {
    const shares = shareEntered(1000, [334, 333, 333]);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(1000);
    const odd = shareEntered(997, [1, 1, 1]);
    expect(odd.reduce((a, b) => a + b, 0)).toBe(997);
  });

  it("has nothing to share when the parts are empty", () => {
    expect(shareEntered(1000, [])).toEqual([]);
  });
});

describe("receiptSplit", () => {
  const items = [
    { price: 12.5, category_id: "food" },
    { price: 7.5, category_id: "food" },
    { price: 30, category_id: "home" },
    { price: 10, category_id: null },
  ];

  it("keeps unsorted items with the entry and carves off each other category", () => {
    expect(receiptSplit(items, 60, 6000, "food")).toEqual({ category_id: "food", parts: [{ category_id: "home", amount_minor: 3000 }] });
  });

  it("measures parts against the amount on the entry, so a converted payment splits in proportion", () => {
    // 60 EUR receipt paid as 258.00 PLN: the lamp is half of it.
    expect(receiptSplit(items, 60, 25800, null).parts).toEqual([{ category_id: "home", amount_minor: 12900 }, { category_id: "food", amount_minor: 8600 }]);
  });

  it("re-files the entry under the biggest group when everything was sorted elsewhere", () => {
    const sorted = items.map((i) => ({ ...i, category_id: i.category_id ?? "home" }));
    expect(receiptSplit(sorted, 60, 6000, "fuel")).toEqual({ category_id: "home", parts: [{ category_id: "food", amount_minor: 2000 }] });
  });

  it("reads items adding up to more than the total against their own sum", () => {
    expect(receiptSplit([{ price: 80, category_id: "a" }, { price: 20, category_id: "b" }], 90, 9000, "a").parts).toEqual([{ category_id: "b", amount_minor: 1800 }]);
  });

  it("is nothing to do when one category covers it all", () => {
    expect(receiptSplit([{ price: 5, category_id: "food" }], 5, 500, "food")).toEqual({ category_id: "food", parts: [] });
  });
});
