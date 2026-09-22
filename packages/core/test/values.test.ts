import { describe, expect, test } from "bun:test";
import { openBunDb } from "../src/drivers/bun";
import { migrate } from "../src/schema";
import { createAccount, createBudget, createCategory, createDebt, createRecurring, createTransaction } from "../src/repo";
import { recentPeriods, safeToSpend, safetyBuffer, valueSplit } from "../src/insights";

const TODAY = "2026-09-21";

function fresh() {
  const db = openBunDb();
  migrate(db);
  const acc = createAccount(db, { name: "Bank", currency: "PLN" });
  const rent = createCategory(db, { name: "Rent", importance: 3 });
  const food = createCategory(db, { name: "Food", importance: 2 });
  const bars = createCategory(db, { name: "Bars", importance: 1 });
  const nobody = createCategory(db, { name: "Unmarked" });
  return { db, acc, rent, food, bars, nobody };
}
const spend = (db: ReturnType<typeof fresh>["db"], acc: string, cat: string | null, minor: number, day = "2026-09-10") =>
  createTransaction(db, { account_id: acc, date: `${day}T10:00:00Z`, amount_minor: -minor, category_id: cat });

describe("recentPeriods", () => {
  test("consecutive periods ending with the one containing today, oldest first", () => {
    expect(recentPeriods(TODAY, 1, 3)).toEqual([
      { start: "2026-07-01", end: "2026-08-01" },
      { start: "2026-08-01", end: "2026-09-01" },
      { start: "2026-09-01", end: "2026-10-01" },
    ]);
  });
  test("a period that starts mid-month still lines up", () => {
    expect(recentPeriods(TODAY, 15, 2)).toEqual([
      { start: "2026-08-15", end: "2026-09-15" },
      { start: "2026-09-15", end: "2026-10-15" },
    ]);
  });
});

describe("what it went on", () => {
  test("the period splits by how much each category matters", () => {
    const { db, acc, rent, food, bars } = fresh();
    spend(db, acc.id, rent.id, 200000);
    spend(db, acc.id, food.id, 80000);
    spend(db, acc.id, bars.id, 20000);
    const [v] = valueSplit(db, { today: TODAY, startDay: 1 });
    expect(v!.currency).toBe("PLN");
    expect(v!.now.by_level).toEqual({ 0: 0, 1: 20000, 2: 80000, 3: 200000 });
    expect(v!.now.total_minor).toBe(300000);
    expect(v!.now.essential_share).toBeCloseTo(200000 / 300000);
  });

  test("a folder answers for what is inside it", () => {
    const db = openBunDb(); migrate(db);
    const acc = createAccount(db, { name: "Bank", currency: "PLN" });
    const home = createCategory(db, { name: "Home", importance: 3 });
    const power = createCategory(db, { name: "Power", parent_id: home.id });
    spend(db, acc.id, power.id, 15000);
    expect(valueSplit(db, { today: TODAY, startDay: 1 })[0]!.now.by_level[3]).toBe(15000);
  });

  test("unmarked spend is reported, not guessed at", () => {
    const { db, acc, rent, nobody } = fresh();
    spend(db, acc.id, rent.id, 100000);
    spend(db, acc.id, nobody.id, 40000);
    spend(db, acc.id, null, 10000); // uncategorised: nobody said what it was, let alone whether it mattered
    const [v] = valueSplit(db, { today: TODAY, startDay: 1 });
    expect(v!.unmarked_minor).toBe(50000);
    expect(v!.now.by_level[2]).toBe(0);
  });

  test("the history is the point: six periods, newest last", () => {
    const { db, acc, rent, bars } = fresh();
    spend(db, acc.id, rent.id, 100000, "2026-04-10");
    spend(db, acc.id, bars.id, 100000, "2026-04-11");
    spend(db, acc.id, rent.id, 100000, "2026-09-10");
    const [v] = valueSplit(db, { today: TODAY, startDay: 1 });
    expect(v!.periods).toHaveLength(6);
    expect(v!.periods[0]!.start).toBe("2026-04-01");
    expect(v!.periods[0]!.essential_share).toBeCloseTo(0.5);
    expect(v!.periods[5]!.essential_share).toBe(1); // drifted up, which is the number to watch
    expect(v!.now).toBe(v!.periods[5]!);
  });

  test("a period with nothing spent has no share rather than a zero one", () => {
    const { db, acc, rent } = fresh();
    spend(db, acc.id, rent.id, 100000);
    const [v] = valueSplit(db, { today: TODAY, startDay: 1 });
    expect(v!.periods[0]!.essential_share).toBeNull();
  });

  test("income and transfers are not spending", () => {
    const { db, acc, rent } = fresh();
    spend(db, acc.id, rent.id, 100000);
    createTransaction(db, { account_id: acc.id, date: "2026-09-05T10:00:00Z", amount_minor: 800000 });
    expect(valueSplit(db, { today: TODAY, startDay: 1 })[0]!.now.total_minor).toBe(100000);
  });

  test("currencies are kept apart and the busiest comes first", () => {
    const { db, acc, rent } = fresh();
    const eur = createAccount(db, { name: "Euro", currency: "EUR" });
    spend(db, acc.id, rent.id, 100000);
    spend(db, eur.id, rent.id, 5000);
    expect(valueSplit(db, { today: TODAY, startDay: 1 }).map((v) => v.currency)).toEqual(["PLN", "EUR"]);
  });

  test("a currency first seen in a later period still lines up with the others", () => {
    const { db, acc, rent } = fresh();
    const eur = createAccount(db, { name: "Euro", currency: "EUR" });
    spend(db, acc.id, rent.id, 100000, "2026-04-10");
    spend(db, acc.id, rent.id, 100000, "2026-09-10");
    spend(db, eur.id, rent.id, 5000, "2026-09-11"); // EUR appears only in the last period
    const [pln, eurSeries] = valueSplit(db, { today: TODAY, startDay: 1 });
    expect(pln!.periods).toHaveLength(6);
    expect(eurSeries!.periods).toHaveLength(6);
    // Same months in the same slots, so the two trends are read against each other honestly.
    expect(eurSeries!.periods.map((x) => x.start)).toEqual(pln!.periods.map((x) => x.start));
    expect(eurSeries!.periods[0]!.total_minor).toBe(0);
    expect(eurSeries!.now.total_minor).toBe(5000);
  });

  test("nothing spent at all is no card rather than an empty one", () => {
    const { db } = fresh();
    expect(valueSplit(db, { today: TODAY, startDay: 1 })).toEqual([]);
  });
});

describe("safety buffer", () => {
  test("the target is computed from what essentials actually cost", () => {
    const { db, acc, rent, bars } = fresh();
    // Three complete months of essentials at 100000, and some noise that is not essential.
    for (const d of ["2026-06-10", "2026-07-10", "2026-08-10"]) spend(db, acc.id, rent.id, 100000, d);
    for (const d of ["2026-06-11", "2026-07-11"]) spend(db, acc.id, bars.id, 50000, d);
    createTransaction(db, { account_id: acc.id, date: "2026-01-01T10:00:00Z", amount_minor: 600000 }); // money in the account
    const b = safetyBuffer(db, { account_id: acc.id, months: 3 }, { today: TODAY, startDay: 1 })!;
    expect(b.periods).toBe(6);
    expect(b.essential_minor).toBe(50000); // 300000 over six complete periods
    expect(b.target_minor).toBe(150000);
    expect(b.months_covered).toBeCloseTo(b.have_minor / 50000);
  });

  test("the month in progress is left out, so the average does not sag every time it is read", () => {
    const { db, acc, rent } = fresh();
    spend(db, acc.id, rent.id, 120000, "2026-08-10");
    spend(db, acc.id, rent.id, 999999, "2026-09-10"); // this period: not complete, not counted
    expect(safetyBuffer(db, { account_id: acc.id }, { today: TODAY, startDay: 1 })!.essential_minor).toBe(20000);
  });

  test("with nothing marked essential it says so rather than showing a zero target", () => {
    const db = openBunDb(); migrate(db);
    const acc = createAccount(db, { name: "Bank", currency: "PLN" });
    createCategory(db, { name: "Food", importance: 2 });
    const b = safetyBuffer(db, { account_id: acc.id }, { today: TODAY, startDay: 1 })!;
    expect(b.no_essentials).toBe(true);
    expect(b.months_covered).toBeNull();
    expect(b.target_minor).toBe(0);
  });

  test("only the account's own currency counts towards its buffer", () => {
    const { db, acc, rent } = fresh();
    const eur = createAccount(db, { name: "Euro", currency: "EUR" });
    spend(db, acc.id, rent.id, 60000, "2026-08-10");
    spend(db, eur.id, rent.id, 60000, "2026-08-11");
    expect(safetyBuffer(db, { account_id: acc.id }, { today: TODAY, startDay: 1 })!.essential_minor).toBe(10000);
  });

  test("no account chosen is no card", () => {
    const { db } = fresh();
    expect(safetyBuffer(db, {}, { today: TODAY, startDay: 1 })).toBeNull();
  });
});

describe("safe to spend", () => {
  test("what is still coming is taken off the free money", () => {
    const { db, acc } = fresh();
    createBudget(db, { currency: "PLN", amount_minor: 300000, starts: "2026-09-01" });
    createRecurring(db, { account_id: acc.id, amount_minor: -100000, frequency: "monthly", start_date: "2026-09-25", payee: "Rent" });
    const s = safeToSpend(db, { today: TODAY, startDay: 1, budgetAccount: null });
    expect(s.free).toEqual([{ currency: "PLN", minor: 300000 }]);
    expect(s.committed).toEqual([{ currency: "PLN", minor: 100000 }]);
    expect(s.safe).toEqual([{ currency: "PLN", minor: 200000 }]);
    expect(s.days).toBe(10); // 21 September to 1 October, the same count days_to_salary uses
    expect(s.per_day).toEqual([{ currency: "PLN", minor: 20000 }]);
  });

  test("a bill already paid this period is not still coming", () => {
    const { db, acc } = fresh();
    createBudget(db, { currency: "PLN", amount_minor: 300000, starts: "2026-09-01" });
    // Due on the 5th, already posted, so the rule has moved on to October.
    createRecurring(db, { account_id: acc.id, amount_minor: -100000, frequency: "monthly", start_date: "2026-09-05", next_date: "2026-10-05", payee: "Rent" });
    expect(safeToSpend(db, { today: TODAY, startDay: 1, budgetAccount: null }).committed).toEqual([]);
  });

  test("debts due before payday count too", () => {
    const { db } = fresh();
    createBudget(db, { currency: "PLN", amount_minor: 300000, starts: "2026-09-01" });
    createDebt(db, { person: "Anna", amount_minor: 50000, currency: "PLN", opened_date: "2026-08-01", due_date: "2026-09-28", direction: "i_owe" });
    expect(safeToSpend(db, { today: TODAY, startDay: 1, budgetAccount: null }).safe).toEqual([{ currency: "PLN", minor: 250000 }]);
  });

  test("commitments in a currency with no budget are all overspend, not silence", () => {
    const { db } = fresh();
    const eur = createAccount(db, { name: "Euro", currency: "EUR" });
    createRecurring(db, { account_id: eur.id, amount_minor: -2000, frequency: "monthly", start_date: "2026-09-25", payee: "Server" });
    expect(safeToSpend(db, { today: TODAY, startDay: 1, budgetAccount: null }).safe).toEqual([{ currency: "EUR", minor: -2000 }]);
  });

  test("it is strictly better than days_to_salary: same figure when nothing is coming", () => {
    const { db } = fresh();
    createBudget(db, { currency: "PLN", amount_minor: 300000, starts: "2026-09-01" });
    const s = safeToSpend(db, { today: TODAY, startDay: 1, budgetAccount: null });
    expect(s.safe).toEqual(s.free);
  });
});
