import { describe, expect, test } from "bun:test";
import { openBunDb } from "../src/drivers/bun";
import { migrate } from "../src/schema";
import { NEAR_RADIUS_M, createAccount, createCategory, createTag, createTransaction, distanceMeters, setHome, suggestCategoryAt } from "../src/repo";
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
    const r = suggestBudget(db, { categoryIds: [food.id], tagId: null, currency: "PLN", startDay: 1, today: "2026-09-20" })!;
    expect(r).toEqual({ average_minor: Math.round((35000 + 10000 + 20000) / 3), periods: 3, last_minor: 35000,
      year_minor: null, year_periods: 0, all_minor: Math.round((35000 + 10000 + 20000) / 3), all_periods: 3,
      max_minor: 35000, min_minor: 10000 });
  });

  test("current, still-running period is excluded", () => {
    const { db, food } = seed();
    const r = suggestBudget(db, { categoryIds: [food.id], tagId: null, currency: "PLN", startDay: 1, today: "2026-09-20" })!;
    expect(r.last_minor).not.toBe(99900);
  });

  test("subcategory rolls up into the parent, not counted on its own", () => {
    const { db, coffee } = seed();
    const r = suggestBudget(db, { categoryIds: [coffee.id], tagId: null, currency: "PLN", startDay: 1, today: "2026-09-20" })!;
    // Only August had any coffee, so that one period is the whole history: the 3-month mean still
    // divides by three, but "highest", "lowest" and the all-history mean are that one month.
    expect(r).toEqual({ average_minor: Math.round(10000 / 3), periods: 3, last_minor: 10000,
      year_minor: null, year_periods: 0, all_minor: 10000, all_periods: 1, max_minor: 10000, min_minor: 10000 });
  });

  test("tag budget counts every expense with the tag, any category", () => {
    const { db, tag } = seed();
    const r = suggestBudget(db, { categoryIds: [], tagId: tag.id, currency: "PLN", startDay: 1, today: "2026-09-20" })!;
    expect(r).toEqual({ average_minor: Math.round(5000 / 3), periods: 3, last_minor: 5000,
      year_minor: null, year_periods: 0, all_minor: 5000, all_periods: 1, max_minor: 5000, min_minor: 5000 });
  });

  test("null category and tag = all spending", () => {
    const { db } = seed();
    const r = suggestBudget(db, { categoryIds: [], tagId: null, currency: "PLN", startDay: 1, today: "2026-09-20" })!;
    expect(r).toEqual({ average_minor: Math.round((35000 + 10000 + 20000) / 3), periods: 3, last_minor: 35000,
      year_minor: null, year_periods: 0, all_minor: Math.round((35000 + 10000 + 20000) / 3), all_periods: 3,
      max_minor: 35000, min_minor: 10000 });
  });

  test("account scope narrows the pool", () => {
    const { db, acc, food } = seed();
    const r = suggestBudget(db, { categoryIds: [food.id], tagId: null, currency: "PLN", accountIds: [acc.id], startDay: 1, today: "2026-09-20" })!;
    expect(r.last_minor).toBe(35000); // every PLN row is already on acc
  });

  test("no spend at all in the window returns null", () => {
    const { db, rent } = seed();
    expect(suggestBudget(db, { categoryIds: [rent.id], tagId: null, currency: "PLN", startDay: 1, today: "2026-09-20" })).toBeNull();
  });

  test("respects a non-default periods count", () => {
    const { db, food } = seed();
    const r = suggestBudget(db, { categoryIds: [food.id], tagId: null, currency: "PLN", startDay: 1, today: "2026-09-20", periods: 1 })!;
    // The short mean is one period, but the rest still describes everything there is: three months.
    expect(r).toEqual({ average_minor: 35000, periods: 1, last_minor: 35000,
      year_minor: Math.round((35000 + 10000 + 20000) / 3), year_periods: 3,
      all_minor: Math.round((35000 + 10000 + 20000) / 3), all_periods: 3, max_minor: 35000, min_minor: 10000 });
  });
});

describe("suggestBudget over a longer history", () => {
  function seedYears() {
    const db = openBunDb(); migrate(db);
    const acc = createAccount(db, { name: "Main", currency: "PLN" });
    const food = createCategory(db, { name: "Food" });
    // 18 complete months before Sep 2026, each a round 1000 × its distance back, plus two empty ones.
    const spend = (day: string, minor: number) =>
      createTransaction(db, { account_id: acc.id, date: `${day}T10:00:00+02:00`, amount_minor: -minor, category_id: food.id });
    const months = ["2026-08", "2026-07", "2026-06", "2026-05", "2026-04", "2026-03", "2026-02", "2026-01",
      "2025-12", "2025-11", "2025-10", "2025-09", "2025-08", "2025-07", "2025-06", "2025-05", "2025-04", "2025-03"];
    months.forEach((m, i) => { if (i !== 4 && i !== 5) spend(`${m}-05`, (i + 1) * 1000); });  // two months with nothing
    return { db, food };
  }

  test("averages a year and the whole history, and finds the extremes over all of it", () => {
    const { db, food } = seedYears();
    const r = suggestBudget(db, { categoryIds: [food.id], tagId: null, currency: "PLN", startDay: 1, today: "2026-09-20" })!;
    expect(r.periods).toBe(3);
    expect(r.average_minor).toBe(Math.round((1000 + 2000 + 3000) / 3));
    expect(r.year_periods).toBe(12);
    expect(r.all_periods).toBe(18);
    expect(r.max_minor).toBe(18000);          // the oldest month, the biggest number
    expect(r.min_minor).toBe(1000);           // the two empty months are not the lowest: nobody budgets zero
    expect(r.all_minor).toBe(Math.round([...Array(18)].reduce((a, _, i) => a + (i === 4 || i === 5 ? 0 : (i + 1) * 1000), 0) / 18));
  });

  test("history starts at the first month that had any spending", () => {
    const db = openBunDb(); migrate(db);
    const acc = createAccount(db, { name: "Main", currency: "PLN" });
    const old = createCategory(db, { name: "Old" });
    const fresh = createCategory(db, { name: "Fresh" });
    // Two years of another category's history, and one month of this one.
    createTransaction(db, { account_id: acc.id, date: "2024-10-05T10:00:00+02:00", amount_minor: -50000, category_id: old.id });
    createTransaction(db, { account_id: acc.id, date: "2026-08-05T10:00:00+02:00", amount_minor: -9000, category_id: fresh.id });
    const r = suggestBudget(db, { categoryIds: [fresh.id], tagId: null, currency: "PLN", startDay: 1, today: "2026-09-20" })!;
    expect(r.all_periods).toBe(1);
    expect(r.all_minor).toBe(9000);
    expect(r.year_minor).toBeNull();          // nothing more to say than the short average
  });
});

describe("suggesting a category for where you are", () => {
  const SHOP = { lat: 52.2297, lon: 21.0122 };
  /** ~120 m east: a different shop on the same street, well outside the 80 m radius. */
  const NEXT_DOOR = { lat: 52.2297, lon: 21.0140 };

  function world() {
    const db = openBunDb();
    migrate(db);
    const acc = createAccount(db, { name: "Cash", currency: "PLN" });
    const food = createCategory(db, { name: "Food" });
    const fuel = createCategory(db, { name: "Fuel" });
    const at = (c: { lat: number; lon: number }, category_id: string, place: string | null, date = "2026-09-07T10:00:00+02:00") =>
      createTransaction(db, { account_id: acc.id, date, amount_minor: -500, category_id, lat: c.lat, lon: c.lon, place });
    return { db, food, fuel, at };
  }

  test("the same place by name wins, even when the fix landed down the street", () => {
    const { db, food, fuel, at } = world();
    at(SHOP, food.id, "Biedronka");
    at(NEXT_DOOR, fuel.id, "Orlen");
    // Standing at the petrol station's coordinates, but the geocoder says Biedronka.
    const hit = suggestCategoryAt(db, { ...NEXT_DOOR, place: "biedronka" });
    expect(hit?.category_id).toBe(food.id);
    expect(hit?.by).toBe("place");
  });

  test("punctuation and accents do not make it a different place", () => {
    const { db, food, at } = world();
    at(SHOP, food.id, "Żabka Nano 3087");
    expect(suggestCategoryAt(db, { ...SHOP, place: "zabka  nano 3087!" })?.category_id).toBe(food.id);
  });

  test("the same name far away is a different shop", () => {
    const { db, food, at } = world();
    at(SHOP, food.id, "Biedronka");
    const abroad = { lat: 50.0647, lon: 19.945 };   // Kraków, ~250 km
    expect(suggestCategoryAt(db, { ...abroad, place: "Biedronka" })).toBeNull();
  });

  test("with no name it falls back to what is nearby, and the neighbour is not nearby", () => {
    const { db, food, fuel, at } = world();
    at(SHOP, food.id, "Biedronka");
    at(NEXT_DOOR, fuel.id, "Orlen");
    const hit = suggestCategoryAt(db, { ...SHOP, place: null });
    expect(hit?.category_id).toBe(food.id);
    expect(hit?.by).toBe("near");
    // 150 m used to reach across the street; 80 m does not.
    expect(distanceMeters(SHOP.lat, SHOP.lon, NEXT_DOOR.lat, NEXT_DOOR.lon)).toBeGreaterThan(NEAR_RADIUS_M);
  });

  test("a name nobody has filed before falls back rather than giving up", () => {
    const { db, food, at } = world();
    at(SHOP, food.id, "Biedronka");
    expect(suggestCategoryAt(db, { ...SHOP, place: "Somewhere new" })?.by).toBe("near");
  });

  test("home is still home, whatever it is called", () => {
    const { db, food, at } = world();
    at(SHOP, food.id, "Biedronka");
    setHome(db, { ...SHOP, place: "Home" });
    expect(suggestCategoryAt(db, { ...SHOP, place: "Biedronka" })).toBeNull();
  });

  test("most used at the place wins, ties going to the most recent", () => {
    const { db, food, fuel, at } = world();
    at(SHOP, fuel.id, "Biedronka", "2026-09-01T10:00:00+02:00");
    at(SHOP, food.id, "Biedronka", "2026-09-02T10:00:00+02:00");
    at(SHOP, food.id, "Biedronka", "2026-09-03T10:00:00+02:00");
    expect(suggestCategoryAt(db, { ...SHOP, place: "Biedronka" })?.category_id).toBe(food.id);
    const tie = world();
    tie.at(SHOP, tie.fuel.id, "Biedronka", "2026-09-01T10:00:00+02:00");
    tie.at(SHOP, tie.food.id, "Biedronka", "2026-09-05T10:00:00+02:00");
    expect(suggestCategoryAt(tie.db, { ...SHOP, place: "Biedronka" })?.category_id).toBe(tie.food.id);
  });
});
