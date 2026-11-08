import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { openBunDb } from "../src/drivers/bun";
import { migrate } from "../src/schema";
import { createAccount, createCategory, createTransaction, locationIgnoredIds, save, setLocationIgnoreChoice, setLocationSuggest } from "../src/repo";
import { categoryForShop, categoryTypes, isCategoryType, isPlaceless, suggestCategoryTypes, typesToStore } from "../src/categoryTypes";
import { SHOPS, shopType } from "../src/shops";
import { shopsSwift } from "../scripts/shops";

describe("shops", () => {
  test("bank strings in Polish, Ukrainian and English find their kind", () => {
    expect(shopType("JMP S.A. BIEDRONKA 1234 WARSZAWA")).toBe("food.groceries");
    expect(shopType("ZABKA ZE212 K.5")).toBe("food.groceries");
    expect(shopType("Сільпо")).toBe("food.groceries");
    expect(shopType("SILPO KYIV")).toBe("food.groceries");
    expect(shopType("АТБ-маркет")).toBe("food.groceries");
    expect(shopType("WOG 1234")).toBe("transport.fuel");
    expect(shopType("MCDONALD'S 123")).toBe("food.restaurants");
    expect(shopType("Spotify P1234")).toBe("bills.subscriptions");
  });
  test("the longest term wins: a meal is not a ride", () => {
    expect(shopType("UBER *EATS")).toBe("food.restaurants");
    expect(shopType("UBER *TRIP")).toBe("transport.taxi");
    expect(shopType("BOLT FOOD")).toBe("food.restaurants");
    expect(shopType("BOLT.EU/O/2311")).toBe("transport.taxi");
  });
  test("whole words only, and a marketplace is no guess", () => {
    expect(shopType("Lidlowa 5")).toBeNull();
    expect(shopType("PayU*Allegro")).toBeNull();
    expect(shopType(null, "", "  ")).toBeNull();
  });
  test("every shop names a type that exists", () => {
    for (const s of SHOPS) expect(isCategoryType(s.type)).toBe(true);
  });
  test("native/KPShops.swift is generated from this list (bun run scripts/shops.ts)", () => {
    const swift = readFileSync(join(import.meta.dir, "../../../apps/mobile/native/KPShops.swift"), "utf8");
    expect(swift).toBe(shopsSwift());
  });
});

describe("category types", () => {
  test("a ready-made category answers with its preset; a stated list wins; [] and none are none", () => {
    expect(categoryTypes({ type: null, preset: "food.groceries" })).toEqual(["food.groceries"]);
    expect(categoryTypes({ type: '["transport.fuel","transport.parking"]', preset: "transport.car" })).toEqual(["transport.fuel", "transport.parking"]);
    expect(categoryTypes({ type: "transport.parking", preset: null })).toEqual(["transport.parking"]); // the first 1.1.2 build wrote a bare key
    expect(categoryTypes({ type: "[]", preset: "food.groceries" })).toEqual([]);
    expect(categoryTypes({ type: "none", preset: "food.groceries" })).toEqual([]);
    expect(categoryTypes({ type: null, preset: "food" })).toEqual([]); // a folder's key is not a type
    expect(categoryTypes({ type: '["made.up","food.coffee"]', preset: null })).toEqual(["food.coffee"]);
  });
  test("what is stored: nothing while the preset says it, the list otherwise", () => {
    expect(typesToStore(["food.groceries"], "food.groceries")).toBeNull();
    expect(typesToStore(["food.groceries", "food.coffee"], "food.groceries")).toBe('["food.groceries","food.coffee"]');
    expect(typesToStore([], "food.groceries")).toBe("[]");
    expect(typesToStore([], null)).toBeNull();
  });
  test("a name suggests one or more types, in any language", () => {
    expect(suggestCategoryTypes("Паркування")).toEqual(["transport.parking"]);
    expect(suggestCategoryTypes("Продукти")).toEqual(["food.groceries"]);
    expect(suggestCategoryTypes("Taxi & parking").sort()).toEqual(["transport.parking", "transport.taxi"]);
    expect(suggestCategoryTypes("Lidl")).toEqual(["food.groceries"]);
    expect(suggestCategoryTypes("Зарплата", "income")).toEqual(["income.salary"]);
    expect(suggestCategoryTypes("Їжа вдома")).toEqual([]);
  });
  test("placeless means every type is", () => {
    expect(isPlaceless({ type: '["transport.parking"]' })).toBe(true);
    expect(isPlaceless({ type: '["transport.parking","transport.fuel"]' })).toBe(false);
    expect(isPlaceless({ type: null, preset: null })).toBe(false);
  });

  function world() {
    const db = openBunDb(); migrate(db);
    const acc = createAccount(db, { name: "Main", currency: "PLN" });
    const food = createCategory(db, { name: "Food", preset: "food" });
    return { db, acc, food };
  }
  test("a shop goes to whatever your category of that type is called", () => {
    const { db, food } = world();
    const mine = createCategory(db, { name: "Їжа вдома", parent_id: food.id, preset: "food.groceries" });
    expect(categoryForShop(db, "BIEDRONKA 1234")).toBe(mine.id);
    expect(categoryForShop(db, "WOG")).toBeNull();
  });
  test("of several, the most specific, then the most used lately; archived never", () => {
    const { db, acc, food } = world();
    const wide = createCategory(db, { name: "Food & coffee", parent_id: food.id, type: '["food.groceries","food.coffee"]' });
    const a = createCategory(db, { name: "Groceries", parent_id: food.id, preset: "food.groceries" });
    const b = createCategory(db, { name: "Lidl & co", parent_id: food.id, type: '["food.groceries"]' });
    const now = new Date().toISOString();
    for (let i = 0; i < 5; i++) createTransaction(db, { account_id: acc.id, date: now, amount_minor: -100, category_id: wide.id });
    for (let i = 0; i < 3; i++) createTransaction(db, { account_id: acc.id, date: now, amount_minor: -100, category_id: b.id });
    expect(categoryForShop(db, "LIDL")).toBe(b.id);
    save(db, "categories", { ...b, archived: 1 });
    expect(categoryForShop(db, "LIDL")).toBe(a.id);
    expect(categoryForShop(db, "STARBUCKS")).toBe(wide.id);
  });
  test("v24 adds the column and backfills nothing", () => {
    const { db } = world();
    expect(db.all<{ type: string | null }>(`SELECT type FROM categories`).every((r) => r.type === null)).toBe(true);
  });
});

describe("never suggest by location", () => {
  test("placeless categories are out by default, and a category can be let in or put out", () => {
    const db = openBunDb(); migrate(db);
    const t = createCategory(db, { name: "Transport", preset: "transport" });
    const parking = createCategory(db, { name: "Parking", parent_id: t.id, type: '["transport.parking"]' });
    const car = createCategory(db, { name: "Car", parent_id: t.id, type: '["transport.parking","transport.fuel"]' });
    const coffee = createCategory(db, { name: "Coffee", type: '["food.coffee"]' });
    expect([...locationIgnoredIds(db)].sort()).toEqual([parking.id]);
    setLocationSuggest(db, parking.id, true);
    expect(locationIgnoredIds(db).has(parking.id)).toBe(false);
    setLocationSuggest(db, coffee.id, false);
    expect(locationIgnoredIds(db).has(coffee.id)).toBe(true);
    setLocationSuggest(db, coffee.id, true);
    expect(locationIgnoredIds(db).has(coffee.id)).toBe(false);
    expect(locationIgnoredIds(db).has(car.id)).toBe(false);
  });
  test("the Settings list: a ticked folder covers its categories; an unticked default is let in", () => {
    const db = openBunDb(); migrate(db);
    const t = createCategory(db, { name: "Transport" });
    const parking = createCategory(db, { name: "Parking", parent_id: t.id, type: '["transport.parking"]' });
    const fuel = createCategory(db, { name: "Fuel", parent_id: t.id, type: '["transport.fuel"]' });
    setLocationIgnoreChoice(db, [t.id]);
    expect(locationIgnoredIds(db)).toEqual(new Set([t.id, parking.id, fuel.id]));
    setLocationIgnoreChoice(db, []);
    expect(locationIgnoredIds(db).size).toBe(0);
  });
});
