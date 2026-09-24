import { describe, expect, test } from "bun:test";
import { openBunDb } from "../src/drivers/bun";
import { migrate } from "../src/schema";
import { createAccount, createBudget, createCategory, createTag, createTransaction, createTransfer, listRows, tagIdsOf } from "../src/repo";
import { activeBudgets, budgetRows } from "../src/insights";
import { activeTrip, activeTripTagId, daysBetween, defaultTripEnd, endTrip, listTrips, startTrip, tagTransactions, tripStats, withTripTag } from "../src/trips";

function seed() {
  const db = openBunDb(); migrate(db);
  const pln = createAccount(db, { name: "Main", currency: "PLN" });
  const eur = createAccount(db, { name: "Cash EUR", currency: "EUR" });
  const food = createCategory(db, { name: "Food" });
  const hotel = createCategory(db, { name: "Hotels" });
  return { db, pln, eur, food, hotel };
}

describe("travel mode", () => {
  test("start creates the tag and a once-budget; only one trip runs at a time", () => {
    const { db } = seed();
    expect(activeTrip(db)).toBeNull();
    const { budget, tag } = startTrip(db, { name: "Rome", currency: "EUR", amount_minor: 100000, ends: "2026-09-14", today: "2026-09-08" });
    expect(tag.name).toBe("Rome");
    expect(budget).toMatchObject({ tag_id: tag.id, period: "once", starts: "2026-09-08", ends: "2026-09-14", ended: null, category_id: null, account_id: null });
    expect(activeTripTagId(db)).toBe(tag.id);
    expect(withTripTag(db, [])).toEqual([tag.id]);
    expect(withTripTag(db, [tag.id, "x"])).toEqual([tag.id, "x"]);
    expect(() => startTrip(db, { name: "Paris", currency: "EUR", amount_minor: 1, ends: "2026-09-20" })).toThrow();
    // Trips never show up among the monthly budgets.
    expect(activeBudgets(db, "2026-10-01", null)).toHaveLength(0);
  });

  test("what a trip paid for is the trip's, not the month budgets'", () => {
    const { db, pln, food } = seed();
    createBudget(db, { currency: "PLN", amount_minor: 300000, starts: "2026-09-01" });
    createBudget(db, { currency: "PLN", amount_minor: 100000, starts: "2026-09-01", category_ids: JSON.stringify([food.id]) });
    const { tag } = startTrip(db, { name: "Rome", currency: "PLN", amount_minor: 500000, ends: "2026-09-14", today: "2026-09-08" });
    const other = createTag(db, { name: "work" });
    createTransaction(db, { account_id: pln.id, date: "2026-09-09T12:00:00+02:00", amount_minor: -4000, category_id: food.id, tag_ids: JSON.stringify([tag.id]) });
    createTransaction(db, { account_id: pln.id, date: "2026-09-10T12:00:00+02:00", amount_minor: -1500, category_id: food.id, tag_ids: JSON.stringify([other.id]) });
    createBudget(db, { currency: "PLN", amount_minor: 20000, starts: "2026-09-01", tag_id: other.id });
    const rows = budgetRows(db, { start: "2026-09-01", end: "2026-10-01", budgetAccount: null });
    // Overall and Food see only the lunch at home; the tag budget sees its own row, not the trip's.
    expect(rows.map((r) => r.spent_minor)).toEqual([1500, 1500, 1500]);
    // A budget on the trip's own tag still counts it.
    createBudget(db, { currency: "PLN", amount_minor: 10000, starts: "2026-09-01", tag_id: tag.id });
    expect(budgetRows(db, { start: "2026-09-01", end: "2026-10-01", budgetAccount: null }).find((r) => r.budget.tag_id === tag.id)?.spent_minor).toBe(4000);
  });

  test("a recurring payment is never the trip's, even carrying its tag", () => {
    const { db, pln, food } = seed();
    createBudget(db, { currency: "PLN", amount_minor: 300000, starts: "2026-09-01" });
    const { budget, tag } = startTrip(db, { name: "Rome", currency: "PLN", amount_minor: 500000, ends: "2026-09-14", today: "2026-09-08" });
    createTransaction(db, { account_id: pln.id, date: "2026-09-09T12:00:00+02:00", amount_minor: -4000, category_id: food.id, tag_ids: JSON.stringify([tag.id]) });
    const sub = createTransaction(db, { account_id: pln.id, date: "2026-09-10T12:00:00+02:00", amount_minor: -2999, tag_ids: JSON.stringify([tag.id]), recurring_id: "rule-1" });
    expect(tripStats(db, budget, { today: "2026-09-10" }).spent_minor).toBe(4000);
    // …so it stays with the month instead of falling between the two.
    expect(budgetRows(db, { start: "2026-09-01", end: "2026-10-01", budgetAccount: null })[0]!.spent_minor).toBe(2999);
    // And adding earlier purchases to the trip skips them.
    const rent = createTransaction(db, { account_id: pln.id, date: "2026-09-01T09:00:00+02:00", amount_minor: -150000, recurring_id: "rule-2" });
    expect(tagTransactions(db, tag.id, [sub.id, rent.id])).toBe(0);
  });

  test("an existing tag with the same name is reused, case-insensitively", () => {
    const { db } = seed();
    const old = createTag(db, { name: "rome" });
    const { tag } = startTrip(db, { name: "Rome", currency: "EUR", amount_minor: 1, ends: "2026-09-14" });
    expect(tag.id).toBe(old.id);
    expect(listRows(db, "tags")).toHaveLength(1);
  });

  test("end keeps the trip as history; a new one can start afterwards", () => {
    const { db } = seed();
    const { budget } = startTrip(db, { name: "Rome", currency: "EUR", amount_minor: 100000, ends: "2026-09-14", today: "2026-09-08" });
    endTrip(db, budget.id, "2026-09-12");
    expect(activeTrip(db)).toBeNull();
    expect(withTripTag(db, ["a"])).toEqual(["a"]);
    expect(listTrips(db)).toHaveLength(1);
    expect(listTrips(db)[0]!.ended).toBe("2026-09-12");
    startTrip(db, { name: "Paris", currency: "EUR", amount_minor: 1, ends: "2026-10-01", today: "2026-09-20" });
    expect(listTrips(db)).toHaveLength(2);
    expect(listTrips(db)[0]!.ended).toBeNull();
  });

  test("stats: tagged spend in any currency converts with cached rates, transfers and untagged rows do not count", () => {
    const { db, pln, eur, food, hotel } = seed();
    const { budget, tag } = startTrip(db, { name: "Rome", currency: "EUR", amount_minor: 70000, ends: "2026-09-14", today: "2026-09-08" });
    const tags = JSON.stringify([tag.id]);
    createTransaction(db, { account_id: eur.id, date: "2026-09-08T10:00:00+02:00", amount_minor: -5000, category_id: food.id, tag_ids: tags });
    createTransaction(db, { account_id: eur.id, date: "2026-09-09T10:00:00+02:00", amount_minor: -20000, category_id: hotel.id, tag_ids: tags });
    createTransaction(db, { account_id: pln.id, date: "2026-09-09T12:00:00+02:00", amount_minor: -43000, category_id: food.id, tag_ids: tags }); // 430 PLN
    createTransaction(db, { account_id: eur.id, date: "2026-09-09T13:00:00+02:00", amount_minor: -9900, category_id: food.id }); // no tag
    createTransaction(db, { account_id: eur.id, date: "2026-09-09T14:00:00+02:00", amount_minor: 3000, category_id: food.id, tag_ids: tags }); // refund, not spend
    createTransfer(db, { from_account_id: pln.id, to_account_id: eur.id, date: "2026-09-09T15:00:00+02:00", from_amount_minor: 86000, to_amount_minor: 20000, from_currency: "PLN", to_currency: "EUR", tag_ids: tags });
    // No rate yet: PLN spend is reported, not counted.
    let s = tripStats(db, budget, { today: "2026-09-10" });
    expect(s.spent_minor).toBe(25000);
    expect(s.unconverted).toEqual([{ currency: "PLN", minor: 43000 }]);
    db.run(`INSERT INTO exchange_rates(base, quote, day, rate, fetched_at) VALUES ('EUR','PLN','2026-09-09',4.3,0)`);
    s = tripStats(db, budget, { today: "2026-09-10" });
    expect(s.spent_minor).toBe(35000);
    expect(s.unconverted).toEqual([]);
    expect(s.by_category).toEqual([{ category_id: hotel.id, spent_minor: 20000 }, { category_id: food.id, spent_minor: 15000 }]);
    expect(s).toMatchObject({ day: 3, days: 7, days_left: 5, remaining_minor: 35000, per_day_minor: Math.round(35000 / 3), allowance_minor: 7000, active: true, over: false });
    // Past the planned end but still on: no allowance, day capped to the planned length.
    s = tripStats(db, budget, { today: "2026-09-20" });
    expect(s).toMatchObject({ day: 7, days_left: 0, allowance_minor: null, active: true });
    endTrip(db, budget.id, "2026-09-11");
    s = tripStats(db, activeTrip(db) ?? listTrips(db)[0]!, { today: "2026-09-20" });
    expect(s).toMatchObject({ day: 4, days: 4, days_left: 0, active: false });
  });

  test("backfill tags chosen transactions once and skips transfers", () => {
    const { db, eur, pln, food } = seed();
    const { tag } = startTrip(db, { name: "Rome", currency: "EUR", amount_minor: 1, ends: "2026-09-14" });
    const flight = createTransaction(db, { account_id: eur.id, date: "2026-08-01T10:00:00+02:00", amount_minor: -12000, category_id: food.id, tag_ids: JSON.stringify(["other"]) });
    const tr = createTransfer(db, { from_account_id: pln.id, to_account_id: eur.id, date: "2026-08-02T10:00:00+02:00", from_amount_minor: 100, to_amount_minor: 20, from_currency: "PLN", to_currency: "EUR" });
    expect(tagTransactions(db, tag.id, [flight.id, tr.out.id, "missing"])).toBe(1);
    expect(tagIdsOf(listRows(db, "transactions", "id=?", [flight.id])[0]!)).toEqual(["other", tag.id]);
    expect(tagTransactions(db, tag.id, [flight.id])).toBe(0);
  });

  test("monthly tag budgets count tagged spend in the period, same currency, and sit next to category budgets", () => {
    const { db, eur, food } = seed();
    const tag = createTag(db, { name: "Eating out" });
    createBudget(db, { currency: "EUR", amount_minor: 10000, starts: "2026-09-01", tag_id: tag.id });
    createBudget(db, { currency: "EUR", amount_minor: 50000, starts: "2026-09-01", category_id: food.id });
    createTransaction(db, { account_id: eur.id, date: "2026-09-03T10:00:00+02:00", amount_minor: -3000, category_id: food.id, tag_ids: JSON.stringify([tag.id]) });
    createTransaction(db, { account_id: eur.id, date: "2026-08-03T10:00:00+02:00", amount_minor: -4000, category_id: food.id, tag_ids: JSON.stringify([tag.id]) });
    createTransaction(db, { account_id: eur.id, date: "2026-09-04T10:00:00+02:00", amount_minor: -1000, category_id: food.id });
    const rows = budgetRows(db, { start: "2026-09-01", end: "2026-10-01", budgetAccount: null });
    expect(rows).toHaveLength(2);
    const byTag = rows.find((r) => r.budget.tag_id === tag.id)!;
    expect(byTag.spent_minor).toBe(3000);
    expect(byTag.children).toEqual([{ category_id: food.id, spent_minor: 3000 }]);
    expect(rows.find((r) => r.budget.category_id === food.id)!.spent_minor).toBe(4000);
  });

  test("date helpers", () => {
    expect(daysBetween("2026-09-08", "2026-09-14")).toBe(6);
    expect(daysBetween("2026-09-14", "2026-09-08")).toBe(-6);
    expect(defaultTripEnd("2026-09-28")).toBe("2026-10-04");
  });
});
