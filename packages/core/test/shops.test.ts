import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { openBunDb } from "../src/drivers/bun";
import { migrate } from "../src/schema";
import { createAccount, createCategory, createTransaction, save } from "../src/repo";
import { CATEGORY_TYPES, categoryForShop, categoryType, isCategoryType, suggestCategoryType } from "../src/categoryTypes";
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
  test("a ready-made category answers with its preset, renamed or not; a stated type wins; none is none", () => {
    expect(categoryType({ type: null, preset: "food.groceries" })).toBe("food.groceries");
    expect(categoryType({ type: "transport.parking", preset: "transport.car" })).toBe("transport.parking");
    expect(categoryType({ type: "none", preset: "food.groceries" })).toBeNull();
    expect(categoryType({ type: null, preset: "food" })).toBeNull(); // a folder's key is not a type
    expect(categoryType({ type: "made.up", preset: null })).toBeNull();
  });
  test("a name suggests a type in any language", () => {
    expect(suggestCategoryType("Паркування")).toBe("transport.parking");
    expect(suggestCategoryType("Parking")).toBe("transport.parking");
    expect(suggestCategoryType("Продукти")).toBe("food.groceries");
    expect(suggestCategoryType("Coffee with friends")).toBe("food.coffee");
    expect(suggestCategoryType("Lidl")).toBe("food.groceries");
    expect(suggestCategoryType("Зарплата", "income")).toBe("income.salary");
    expect(suggestCategoryType("Їжа вдома")).toBeNull();
  });
  test("every type has a name in every language", () => {
    for (const g of CATEGORY_TYPES) for (const x of g.types) expect(suggestCategoryType(x.key)).toBeDefined();
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
    expect(categoryForShop(db, "WOG")).toBeNull(); // nothing of yours is fuel
  });
  test("of several, the one used most lately; archived and folders never", () => {
    const { db, acc, food } = world();
    const a = createCategory(db, { name: "Groceries", parent_id: food.id, preset: "food.groceries" });
    const b = createCategory(db, { name: "Lidl & co", parent_id: food.id, type: "food.groceries" });
    const now = new Date().toISOString();
    for (let i = 0; i < 3; i++) createTransaction(db, { account_id: acc.id, date: now, amount_minor: -100, category_id: b.id });
    expect(categoryForShop(db, "LIDL")).toBe(b.id);
    save(db, "categories", { ...b, archived: 1 });
    expect(categoryForShop(db, "LIDL")).toBe(a.id);
  });
  test("v24 adds the column and backfills nothing", () => {
    const { db } = world();
    expect(db.all<{ type: string | null }>(`SELECT type FROM categories`).every((r) => r.type === null)).toBe(true);
  });
});
