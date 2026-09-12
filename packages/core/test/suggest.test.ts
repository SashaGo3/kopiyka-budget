import { describe, expect, test } from "bun:test";
import { openBunDb } from "../src/drivers/bun";
import { migrate } from "../src/schema";
import { createAccount, createCategory, createTag, createTransaction } from "../src/repo";
import { suggestBudget } from "../src/suggest";

function seed() {
  const db = openBunDb(); migrate(db);
  const acc = createAccount(db, { name: "Main", currency: "PLN" });
  const eur = createAccount(db, { name: "Card", currency: "EUR" });
  const food = createCategory(db, { name: "Food" });
  const coffee = createCategory(db, { name: "Coffee", parent_id: food.id });
  const rent = createCategory(db, { name: "Rent" });
  const tag = createTag(db, { name: "work" });
  // Complete periods (startDay=1): Aug, Jul, Jun. Current (Sep, incomplete) must be excluded.
  createTransaction(db, { account_id: acc.id, date: "2026-09-05T10:00:00+02:00", amount_minor: -99900, category_id: food.id }); // current period, excluded
  createTransaction(db, { account_id: acc.id, date: "2026-08-05T10:00:00+02:00", amount_minor: -20000, category_id: food.id });
  createTransaction(db, { account_id: acc.id, date: "2026-08-06T10:00:00+02:00", amount_minor: -10000, category_id: coffee.id }); // subcategory, same period
  createTransaction(db, { account_id: acc.id, date: "2026-07-05T10:00:00+02:00", amount_minor: -10000, category_id: food.id });
  createTransaction(db, { account_id: acc.id, date: "2026-06-05T10:00:00+02:00", amount_minor: -20000, category_id: food.id });
  createTransaction(db, { account_id: acc.id, date: "2026-08-10T10:00:00+02:00", amount_minor: -5000, category_id: food.id, tag_ids: JSON.stringify([tag.id]) });
  createTransaction(db, { account_id: eur.id, date: "2026-08-07T10:00:00+02:00", amount_minor: -30000, category_id: food.id }); // wrong currency, excluded
  return { db, acc, eur, food, coffee, rent, tag };
}

describe("suggestBudget", () => {
  test("averages the last 3 complete periods, a category with its subcategories, one currency", () => {
    const { db, food } = seed();
    // Aug: 20000(food)+10000(coffee)+5000(tagged food, still counts for the category) = 35000. Jul: 10000. Jun: 20000.
    const r = suggestBudget(db, { categoryId: food.id, tagId: null, currency: "PLN", startDay: 1, today: "2026-09-20" })!;
    expect(r).toEqual({ average_minor: Math.round((35000 + 10000 + 20000) / 3), last_minor: 35000, max_minor: 35000, periods: 3 });
  });

  test("current, still-running period is excluded", () => {
    const { db, food } = seed();
    const r = suggestBudget(db, { categoryId: food.id, tagId: null, currency: "PLN", startDay: 1, today: "2026-09-20" })!;
    expect(r.last_minor).not.toBe(99900);
  });

  test("subcategory rolls up into the parent, not counted on its own", () => {
    const { db, coffee } = seed();
    const r = suggestBudget(db, { categoryId: coffee.id, tagId: null, currency: "PLN", startDay: 1, today: "2026-09-20" })!;
    expect(r).toEqual({ average_minor: Math.round(10000 / 3), last_minor: 10000, max_minor: 10000, periods: 3 });
  });

  test("tag budget counts every expense with the tag, any category", () => {
    const { db, tag } = seed();
    const r = suggestBudget(db, { categoryId: null, tagId: tag.id, currency: "PLN", startDay: 1, today: "2026-09-20" })!;
    expect(r).toEqual({ average_minor: Math.round(5000 / 3), last_minor: 5000, max_minor: 5000, periods: 3 });
  });

  test("null category and tag = all spending", () => {
    const { db } = seed();
    const r = suggestBudget(db, { categoryId: null, tagId: null, currency: "PLN", startDay: 1, today: "2026-09-20" })!;
    expect(r).toEqual({ average_minor: Math.round((35000 + 10000 + 20000) / 3), last_minor: 35000, max_minor: 35000, periods: 3 });
  });

  test("account scope narrows the pool", () => {
    const { db, acc, food } = seed();
    const r = suggestBudget(db, { categoryId: food.id, tagId: null, currency: "PLN", accountIds: [acc.id], startDay: 1, today: "2026-09-20" })!;
    expect(r.last_minor).toBe(35000); // every PLN row is already on acc
  });

  test("no spend at all in the window returns null", () => {
    const { db, rent } = seed();
    expect(suggestBudget(db, { categoryId: rent.id, tagId: null, currency: "PLN", startDay: 1, today: "2026-09-20" })).toBeNull();
  });

  test("respects a non-default periods count", () => {
    const { db, food } = seed();
    const r = suggestBudget(db, { categoryId: food.id, tagId: null, currency: "PLN", startDay: 1, today: "2026-09-20", periods: 1 })!;
    expect(r).toEqual({ average_minor: 35000, last_minor: 35000, max_minor: 35000, periods: 1 });
  });
});
