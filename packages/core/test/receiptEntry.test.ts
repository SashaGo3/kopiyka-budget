import { describe, expect, it } from "bun:test";
import { NOMINAL_BASIS, receiptFill, receiptPlan, receiptSave, type EntryNow } from "../src/receiptEntry";

const entry: EntryNow = { amount_minor: null, expense: true, currency: "PLN", category_id: null, suggested: false, debt_id: null, payee: null, place: null, placeFromPhone: false, note: "", day: "2026-11-18" };
const receipt = { merchant: "Żabka", total: 19.93, currency: "PLN", date: "2021-07-27", category_id: "food", items: [] };

describe("receiptFill", () => {
  it("converts a receipt in another currency, and flags it when there is no rate", () => {
    const uah = { ...entry, currency: "UAH" };
    expect(receiptFill(uah, receipt, 10, "").amount).toBe(199.3);
    expect(receiptFill(uah, receipt, null, "")).toMatchObject({ amount: 0, unconverted: "PLN" });
  });
  it("never overrides a category or place chosen by hand", () => {
    const chosen = { ...entry, category_id: "mine", place: "Home" };
    const f = receiptFill(chosen, receipt, null, "");
    expect(f.category_id).toBeUndefined();
    expect(f.place).toBeUndefined();
  });
});

describe("receiptPlan + receiptSave", () => {
  const items = [{ price: 10, category_id: "food" }, { price: 5, category_id: "home" }, { price: 5, category_id: null }];
  it("scales a split worked out before the entry's total was known", () => {
    const plan = receiptPlan(items, 20, 0, null);
    expect(plan.basis).toBe(NOMINAL_BASIS);
    const saved = receiptSave(plan, plan.parts, 20000, null);
    expect(saved.parts.map((x) => x.amount_minor)).toEqual([10000, 5000]);
  });
  it("keeps the entry's category for the items given none", () => {
    const plan = receiptPlan(items, 20, 2000, null);
    expect(receiptSave(plan, plan.parts, 2000, "groceries").category_id).toBe("groceries");
  });
  it("always leaves the entry something", () => {
    const saved = receiptSave({ category_id: null, basis: 100 }, [{ amount_minor: 60, category_id: "a" }, { amount_minor: 40, category_id: "b" }], 100, null);
    expect(saved.parts.reduce((a, x) => a + x.amount_minor, 0)).toBeLessThan(100);
  });
});
