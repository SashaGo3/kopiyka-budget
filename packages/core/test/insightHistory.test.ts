import { describe, expect, test } from "bun:test";
import { openBunDb } from "../src/drivers/bun";
import { migrate } from "../src/schema";
import { createAccount, createBudget, createCategory, createTransaction, createTransfer } from "../src/repo";
import { budgetRows, budgetSeries, regularSpending } from "../src/insights";
import { accountHistory, incomeSeries, incomeSources, periodWindows, regularSeries, spendSeries, toSeries } from "../src/insightHistory";

function seed() {
  const db = openBunDb(); migrate(db);
  const acc = createAccount(db, { name: "Main", currency: "PLN" });
  const sav = createAccount(db, { name: "Savings", currency: "PLN" });
  const food = createCategory(db, { name: "Food" });
  const coffee = createCategory(db, { name: "Coffee", parent_id: food.id });
  const salary = createCategory(db, { name: "Salary" });
  for (const [day, minor] of [["2026-07-03", -10000], ["2026-08-03", -30000], ["2026-09-03", -20000], ["2026-09-16", -5000]] as const)
    createTransaction(db, { account_id: acc.id, date: `${day}T10:00:00+02:00`, amount_minor: minor, category_id: coffee.id });
  for (const [day, minor] of [["2026-07-10", 500000], ["2026-08-10", 520000], ["2026-09-10", 480000]] as const)
    createTransaction(db, { account_id: acc.id, date: `${day}T10:00:00+02:00`, amount_minor: minor, category_id: salary.id, payee: "Employer" });
  return { db, acc, sav, food, coffee, salary };
}

describe("insight history", () => {
  test("period windows end with the running one", () => {
    const w = periodWindows("2026-09-20", 1, 3);
    expect(w.map((x) => x.start)).toEqual(["2026-07-01", "2026-08-01", "2026-09-01"]);
    expect(w.map((x) => x.current)).toEqual([false, false, true]);
  });

  test("a series starts at the first period with anything in it and keeps the running one out of the stats", () => {
    const s = toSeries("PLN", [
      { start: "a", end: "b", minor: 0, current: false },
      { start: "b", end: "c", minor: 100, current: false },
      { start: "c", end: "d", minor: 300, current: false },
      { start: "d", end: "e", minor: 50, current: true },
    ])!;
    expect(s.points.length).toBe(3);
    expect(s).toMatchObject({ average_minor: 200, periods: 2, last_minor: 300, max_minor: 300, min_minor: 100, current_minor: 50 });
    expect(toSeries("PLN", [{ start: "a", end: "b", minor: 0, current: false }])).toBeNull();
  });

  test("spending per period follows a folder into its categories", () => {
    const { db, food } = seed();
    const [s] = spendSeries(db, { categoryIds: [food.id], startDay: 1, today: "2026-09-20" });
    expect(s!.points.map((p) => p.minor)).toEqual([10000, 30000, 25000]);
    expect(s).toMatchObject({ average_minor: 20000, last_minor: 30000, current_minor: 25000 });
  });

  test("a budget's history is what its bar counted each period", () => {
    const { db, food } = seed();
    const b = createBudget(db, { currency: "PLN", amount_minor: 40000, starts: "2026-01-01", category_ids: JSON.stringify([food.id]) });
    const s = budgetSeries(db, b, { startDay: 1, today: "2026-09-20" })!;
    expect(s.points.map((p) => p.minor)).toEqual([10000, 30000, 25000]);
    expect(s.current_minor).toBe(budgetRows(db, { start: "2026-09-01", end: "2026-10-01", budgetAccount: null })[0]!.spent_minor);
  });

  test("income leaves transfers out and groups where it came from", () => {
    const { db, acc, sav } = seed();
    createTransfer(db, { from_account_id: sav.id, to_account_id: acc.id, from_amount_minor: 100000, to_amount_minor: 100000, from_currency: "PLN", to_currency: "PLN", date: "2026-09-12T10:00:00+02:00" });
    const [s] = incomeSeries(db, { startDay: 1, today: "2026-09-20" });
    expect(s!.points.map((p) => p.minor)).toEqual([500000, 520000, 480000]);
    expect(s).toMatchObject({ average_minor: 510000, min_minor: 500000, max_minor: 520000, current_minor: 480000 });
    expect(incomeSources(db, { start: "2026-09-01", end: "2026-10-01" })).toMatchObject([{ payee: "Employer", minor: 480000, n: 1 }]);
  });

  test("a weekly regular card is counted in weeks, and the details agree with the card", () => {
    const { db, food } = seed();
    const p = { category_ids: [food.id], frequency: "weekly" as const, window_months: 1 };
    const [s] = regularSeries(db, p, { today: "2026-09-20" });
    expect(s!.periods).toBe(4);
    expect(s!.points.every((x) => !x.current)).toBe(true);
    // Seven-day windows ending with the 20th, oldest first: 3 Sep in the second, 16 Sep in the last.
    expect(s!.points.map((x) => x.minor)).toEqual([0, 20000, 0, 5000]);
    expect(regularSpending(db, p, { today: "2026-09-20" })).toEqual([{ currency: "PLN", average_minor: 6250, periods: 4, last_minor: 5000, frequency: "weekly" }]);
  });

  test("account history: in, out and the balance each period ended on", () => {
    const { db, acc } = seed();
    const h = accountHistory(db, acc.id, { startDay: 1, today: "2026-09-20" })!;
    expect(h.periods.map((x) => x.start)).toEqual(["2026-07-01", "2026-08-01", "2026-09-01"]);
    expect(h.periods.map((x) => x.balance_minor)).toEqual([490000, 980000, 1435000]);
    expect(h.periods[2]).toMatchObject({ in_minor: 480000, out_minor: 25000, net_minor: 455000, current: true });
  });
});
