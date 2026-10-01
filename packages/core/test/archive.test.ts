import { describe, expect, test } from "bun:test";
import { openBunDb } from "../src/drivers/bun";
import { migrate } from "../src/schema";
import {
  archivedCategoryIds, createAccount, createBudget, createCategory, createTag, createTransaction,
  getRow, pickableCategories, save, suggestCategoryAt, tagsForCategory,
} from "../src/repo";
import { isTrustedFiling, payeeHistory, payeeOptions } from "../src/payee";
import { activeBudgets, freeMoney } from "../src/insights";
import type { Category } from "../src/models";

function fresh() {
  const db = openBunDb();
  migrate(db);
  return db;
}

describe("archiving a category", () => {
  test("takes the categories inside the folder with it, and leaves everything else pickable", () => {
    const db = fresh();
    const food = createCategory(db, { name: "Food" });
    const shop = createCategory(db, { name: "Groceries", parent_id: food.id });
    const lunch = createCategory(db, { name: "Lunch", parent_id: food.id });
    const loose = createCategory(db, { name: "Fuel" });
    save(db, "categories", { ...food, archived: 1 } as Category);

    const all = [getRow(db, "categories", food.id)!, shop, lunch, loose];
    expect([...archivedCategoryIds(all)].sort()).toEqual([food.id, lunch.id, shop.id].sort());
    expect(pickableCategories(all).map((c) => c.id)).toEqual([loose.id]);
  });

  test("a shop's history stops answering with it, so the automation's entry has nothing to file under", () => {
    const db = fresh();
    const acc = createAccount(db, { name: "Revolut", currency: "PLN" });
    const old = createCategory(db, { name: "Kiosk" });
    createTransaction(db, { account_id: acc.id, date: "2026-09-01T10:00:00+02:00", amount_minor: -800, payee: "ZABKA ZE212 K.5", category_id: old.id });

    const before = payeeHistory(db, "ZABKA ZE212 K.5");
    expect(before.category_id).toBe(old.id);
    expect(isTrustedFiling(before)).toBe(true);

    save(db, "categories", { ...old, archived: 1 } as Category);
    const after = payeeHistory(db, "ZABKA ZE212 K.5");
    // No category and no match: the entry the Shortcut writes stays in the Pending queue, where the
    // shop can be given whichever category replaced the retired one.
    expect(after.category_id).toBeNull();
    expect(after.match).toBeNull();
    expect(isTrustedFiling(after)).toBe(false);
    // And it is not offered as one of the ways this shop has been filed either.
    expect(payeeOptions(db, "ZABKA ZE212 K.5")).toEqual([]);
  });

  test("is not suggested for where you are standing any more", () => {
    const db = fresh();
    const acc = createAccount(db, { name: "Cash", currency: "PLN" });
    const cat = createCategory(db, { name: "Coffee" });
    for (const d of ["2026-09-01", "2026-09-02"]) {
      createTransaction(db, { account_id: acc.id, date: `${d}T10:00:00+02:00`, amount_minor: -1500, category_id: cat.id, lat: 52.2297, lon: 21.0122, place: "Coffee Desk" });
    }
    expect(suggestCategoryAt(db, { lat: 52.2297, lon: 21.0122 })?.category_id).toBe(cat.id);
    save(db, "categories", { ...cat, archived: 1 } as Category);
    expect(suggestCategoryAt(db, { lat: 52.2297, lon: 21.0122 })).toBeNull();
  });

  test("the transactions filed under it are untouched", () => {
    const db = fresh();
    const acc = createAccount(db, { name: "Cash", currency: "PLN" });
    const cat = createCategory(db, { name: "Papers" });
    const tx = createTransaction(db, { account_id: acc.id, date: "2026-09-01T10:00:00+02:00", amount_minor: -500, category_id: cat.id });
    save(db, "categories", { ...cat, archived: 1 } as Category);
    expect(getRow(db, "transactions", tx.id)!.category_id).toBe(cat.id);
  });
});

describe("archiving a tag", () => {
  test("stops it being offered for a category, and drops it from what history hands a new payment", () => {
    const db = fresh();
    const acc = createAccount(db, { name: "Cash", currency: "PLN" });
    const cat = createCategory(db, { name: "Lunch" });
    const live = createTag(db, { name: "work" });
    const old = createTag(db, { name: "2025-office" });
    createTransaction(db, { account_id: acc.id, date: "2026-09-01T10:00:00+02:00", amount_minor: -2000, payee: "Bistro", category_id: cat.id, tag_ids: JSON.stringify([live.id, old.id]) });

    expect(tagsForCategory(db, cat.id).map((t) => t.id).sort()).toEqual([live.id, old.id].sort());
    expect(payeeHistory(db, "Bistro").tag_ids.sort()).toEqual([live.id, old.id].sort());

    save(db, "tags", { ...old, archived: 1 });
    expect(tagsForCategory(db, cat.id).map((t) => t.id)).toEqual([live.id]);
    expect(payeeHistory(db, "Bistro").tag_ids).toEqual([live.id]);
    // The transaction itself keeps both: archiving retires a tag, it does not un-tag anything.
    expect(payeeHistory(db, "Bistro").category_id).toBe(cat.id);
  });
});

describe("budgets kept out of the totals, and put in an order", () => {
  test("in_planned = 0 leaves a budget out of free money without suppressing the others", () => {
    const db = fresh();
    const acc = createAccount(db, { name: "Cash", currency: "PLN" });
    const cat = createCategory(db, { name: "Food" });
    createTransaction(db, { account_id: acc.id, date: "2026-09-10T10:00:00+02:00", amount_minor: -10000, category_id: cat.id });
    createBudget(db, { currency: "PLN", amount_minor: 100000, starts: "2026-09-01", category_ids: JSON.stringify([cat.id]) });
    const overall = createBudget(db, { currency: "PLN", amount_minor: 500000, starts: "2026-09-01" });
    const window = { start: "2026-09-01", end: "2026-10-01", budgetAccount: null };

    // The overall budget normally swallows the category one.
    expect(freeMoney(db, window)).toEqual([{ currency: "PLN", minor: 490000 }]);
    // Switched out of the totals it is not counted — and not counted *as* the overall one either,
    // so the category budget it used to suppress comes back rather than everything disappearing.
    save(db, "budgets", { ...getRow(db, "budgets", overall.id)!, in_planned: 0 });
    expect(freeMoney(db, window)).toEqual([{ currency: "PLN", minor: 90000 }]);
  });

  test("budgets come back in the order they were put in, and an untouched database keeps its own", () => {
    const db = fresh();
    const a = createCategory(db, { name: "Food" });
    const b = createCategory(db, { name: "Fuel" });
    const first = createBudget(db, { currency: "PLN", amount_minor: 1000, starts: "2026-09-01", category_ids: JSON.stringify([a.id]) });
    const second = createBudget(db, { currency: "PLN", amount_minor: 2000, starts: "2026-09-01", category_ids: JSON.stringify([b.id]) });
    // Every `sort` still 0: the order is whatever it always was, not scrambled.
    expect(activeBudgets(db, "2026-09-30", null).length).toBe(2);
    save(db, "budgets", { ...getRow(db, "budgets", second.id)!, sort: 0 });
    save(db, "budgets", { ...getRow(db, "budgets", first.id)!, sort: 1 });
    expect(activeBudgets(db, "2026-09-30", null).map((x) => x.id)).toEqual([second.id, first.id]);
  });
});
