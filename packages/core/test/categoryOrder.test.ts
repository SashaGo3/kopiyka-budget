import { describe, expect, test } from "bun:test";
import { openBunDb } from "../src/drivers/bun";
import { migrate, setMeta } from "../src/schema";
import { createAccount, createCategory, createTransaction, listRows } from "../src/repo";
import { categoryUsage, getCategoryOrder, inCategoryOrder, keepOrder, orderCategories } from "../src/categoryOrder";

describe("category order", () => {
  const setup = () => {
    const db = openBunDb(); migrate(db);
    const acc = createAccount(db, { name: "Main", currency: "PLN" });
    const food = createCategory(db, { name: "Food", sort: 0 });
    const car = createCategory(db, { name: "Car", sort: 1 });
    const groceries = createCategory(db, { name: "Groceries", parent_id: food.id, sort: 2 });
    const cafe = createCategory(db, { name: "Cafe", parent_id: food.id, sort: 3 });
    const fuel = createCategory(db, { name: "Fuel", parent_id: car.id, sort: 4 });
    const day = new Date().toISOString().slice(0, 10);
    const add = (category_id: string, n: number) => { for (let i = 0; i < n; i++) createTransaction(db, { account_id: acc.id, date: day, amount_minor: -100, category_id }); };
    add(fuel.id, 5); add(cafe.id, 3); add(groceries.id, 1);
    return { db, food, car, groceries, cafe, fuel };
  };

  test("custom is the default; unknown values read as it", () => {
    const { db } = setup();
    expect(getCategoryOrder(db)).toBe("custom");
    setMeta(db, "category_order", "sideways");
    expect(getCategoryOrder(db)).toBe("custom");
  });

  test("usage: a folder counts everything in it; ties keep the custom order", () => {
    const { db, food, car, groceries, cafe, fuel } = setup();
    const uses = categoryUsage(db);
    expect(uses.get(car.id)).toBe(5);
    expect(uses.get(food.id)).toBe(4);
    const ids = orderCategories([food, car, groceries, cafe, fuel], "usage", { usage: uses }).map((c) => c.name);
    expect(ids.indexOf("Car")).toBeLessThan(ids.indexOf("Food"));
    expect(ids.indexOf("Cafe")).toBeLessThan(ids.indexOf("Groceries"));
  });

  test("the stored setting is what inCategoryOrder follows; the old name order reads as custom; keepOrder freezes it", () => {
    const { db, food, car, groceries, cafe, fuel } = setup();
    setMeta(db, "category_order", "name");
    expect(getCategoryOrder(db)).toBe("custom");
    setMeta(db, "category_order", "usage");
    expect(inCategoryOrder(db, [food, car, groceries, cafe, fuel]).map((c) => c.name)).toEqual(["Car", "Fuel", "Food", "Cafe", "Groceries"]);
    const usage = inCategoryOrder(db, [food, car, groceries, cafe, fuel]);
    expect(keepOrder(db, usage)).toBeGreaterThan(0);
    expect(keepOrder(db, usage)).toBe(0); // nothing left to change, nothing written
    setMeta(db, "category_order", "custom");
    expect(inCategoryOrder(db, listRows(db, "categories", "deleted=0")).map((c) => c.name)).toEqual(["Car", "Fuel", "Food", "Cafe", "Groceries"]);
  });
});
