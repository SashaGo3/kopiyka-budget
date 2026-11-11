import { describe, expect, test } from "bun:test";
import { openBunDb } from "../src/drivers/bun";
import { migrate } from "../src/schema";
import { createAccount, createCategory, createTransaction, createTransfer } from "../src/repo";
import {
  crossoverYear, doublingYears, freedomNumber, futureInputs, goalForecast, growth, monthAfter, monthsBetween, monthsToTarget, moneyPace, mortgage, paceIn,
  realValue, requiredMonthly, roundNice,
} from "../src/forecast";

describe("forecast maths", () => {
  test("growth with no rate is just what was put in", () => {
    const g = growth({ start_minor: 1000_00, monthly_minor: 100_00, rate_pct: 0, years: 2 });
    expect(g.map((y) => y.total_minor)).toEqual([1000_00, 2200_00, 3400_00]);
    expect(g[2]).toMatchObject({ contributed_minor: 3400_00, growth_minor: 0, added_this_year_minor: 1200_00 });
  });

  test("a lump sum compounds to the effective yearly rate", () => {
    const g = growth({ start_minor: 1000_00, monthly_minor: 0, rate_pct: 10, years: 2 });
    expect(g[1]!.total_minor).toBe(1100_00);
    expect(g[2]!.total_minor).toBe(1210_00);
    expect(g[2]!.growth_minor).toBe(210_00);
  });

  test("monthly saving at 7% for 30 years: interest outgrows the deposits, and the year it overtakes them is found", () => {
    const g = growth({ start_minor: 0, monthly_minor: 500_00, rate_pct: 7, years: 30 });
    const last = g[30]!;
    expect(last.contributed_minor).toBe(180_000_00);
    // ≈ 590 k: the textbook figure for 500 a month at 7% a year.
    expect(last.total_minor).toBeGreaterThan(580_000_00);
    expect(last.total_minor).toBeLessThan(600_000_00);
    const x = crossoverYear(g)!;
    expect(x).toBeGreaterThan(9);
    expect(x).toBeLessThan(12);
    expect(g[x]!.earned_this_year_minor).toBeGreaterThanOrEqual(g[x]!.added_this_year_minor);
  });

  test("inflation shrinks the total into today's money", () => {
    const g = growth({ start_minor: 1000_00, monthly_minor: 0, rate_pct: 0, years: 10, inflation_pct: 3 });
    expect(g[10]!.real_minor).toBe(realValue(1000_00, 3, 10));
    expect(g[10]!.real_minor).toBe(744_09);
  });

  test("a yearly raise grows the monthly amount", () => {
    const flat = growth({ start_minor: 0, monthly_minor: 100_00, rate_pct: 0, years: 3 });
    const raised = growth({ start_minor: 0, monthly_minor: 100_00, rate_pct: 0, years: 3, raise_pct: 10 });
    expect(raised[3]!.total_minor).toBe(1200_00 + 1320_00 + 1452_00);
    expect(raised[3]!.total_minor).toBeGreaterThan(flat[3]!.total_minor);
  });

  test("doubling time is the rule of 72, near enough", () => {
    expect(doublingYears(7)!).toBeCloseTo(10.24, 1);
    expect(doublingYears(0)).toBeNull();
  });

  test("months to a target, with and without growth; never is null", () => {
    expect(monthsToTarget({ have_minor: 0, monthly_minor: 100_00, rate_pct: 0, target_minor: 1000_00 })).toBe(10);
    expect(monthsToTarget({ have_minor: 2000_00, monthly_minor: 0, rate_pct: 0, target_minor: 1000_00 })).toBe(0);
    expect(monthsToTarget({ have_minor: 0, monthly_minor: 0, rate_pct: 5, target_minor: 1000_00 })).toBeNull();
    expect(monthsToTarget({ have_minor: 0, monthly_minor: 100_00, rate_pct: 10, target_minor: 10_000_00 })).toBeLessThan(85);
  });

  test("what has to go in each month to make it in time", () => {
    expect(requiredMonthly({ have_minor: 0, target_minor: 1200_00, months: 12, rate_pct: 0 })).toBe(100_00);
    expect(requiredMonthly({ have_minor: 2000_00, target_minor: 1200_00, months: 12, rate_pct: 0 })).toBe(0);
    // With growth less has to go in, and paying that much does get there.
    const m = requiredMonthly({ have_minor: 0, target_minor: 100_000_00, months: 120, rate_pct: 7 });
    expect(m).toBeLessThan(100_000_00 / 120);
    expect(monthsToTarget({ have_minor: 0, monthly_minor: m, rate_pct: 7, target_minor: 100_000_00 })).toBe(120);
  });

  test("a mortgage: the bank's instalment, its interest, and what overpaying saves", () => {
    const m = mortgage({ principal_minor: 300_000_00, rate_pct: 6, years: 30 });
    // The standard annuity: 300 000 at 6% over 30 years is 1 798.65 a month.
    expect(m.monthly_minor).toBe(1798_65);
    expect(m.months).toBe(360);
    expect(m.interest_minor).toBeGreaterThan(347_000_00);
    expect(m.balance_by_year[0]).toBe(300_000_00);
    expect(m.balance_by_year[30]).toBe(0);
    const faster = mortgage({ principal_minor: 300_000_00, rate_pct: 6, years: 30, extra_minor: 200_00 });
    expect(faster.monthly_minor).toBe(m.monthly_minor);
    expect(faster.months).toBeLessThan(300);
    expect(faster.interest_minor).toBeLessThan(m.interest_minor - 80_000_00);
    expect(mortgage({ principal_minor: 12_000_00, rate_pct: 0, years: 1 }).monthly_minor).toBe(1000_00);
  });

  test("the freedom number is 25 years of spending at 4%", () => {
    expect(freedomNumber(40_000_00)).toBe(1_000_000_00);
    expect(freedomNumber(40_000_00, 3)).toBe(1_333_333_33);
  });

  test("months and dates", () => {
    expect(monthAfter("2026-11-09", 3)).toBe("2027-02-01");
    expect(monthsBetween("2026-11-09", "2027-11-09")).toBe(12);
    expect(monthsBetween("2026-11-09", "2027-11-08")).toBe(11);
    expect(monthsBetween("2026-11-09", "2026-10-01")).toBe(-2);
    expect(roundNice(1_234_567_89)).toBe(1_200_000_00);
  });
});

function seed() {
  const db = openBunDb(); migrate(db);
  const main = createAccount(db, { name: "Main", currency: "PLN" });
  const sav = createAccount(db, { name: "Savings", currency: "PLN" });
  const usd = createAccount(db, { name: "Dollars", currency: "USD", opening_balance_minor: 500_00 });
  const food = createCategory(db, { name: "Food" });
  const salary = createCategory(db, { name: "Salary", kind: "income" });
  // Three full months of salary and spending, and a running one; saving 1 000 a month into Savings.
  for (const m of ["08", "09", "10"]) {
    createTransaction(db, { account_id: main.id, date: `2026-${m}-02T10:00:00+02:00`, amount_minor: 8000_00, category_id: salary.id });
    createTransaction(db, { account_id: main.id, date: `2026-${m}-05T10:00:00+02:00`, amount_minor: -5000_00, category_id: food.id });
    createTransfer(db, { from_account_id: main.id, to_account_id: sav.id, date: `2026-${m}-06T10:00:00+02:00`, from_amount_minor: 1000_00, to_amount_minor: 1000_00, from_currency: "PLN", to_currency: "PLN" });
  }
  createTransaction(db, { account_id: main.id, date: "2026-11-03T10:00:00+02:00", amount_minor: -100_00, category_id: food.id });
  return { db, main, sav, usd };
}

describe("forecast from your data", () => {
  test("pace is income minus spending per complete period, transfers ignored, balances summed per currency", () => {
    const { db } = seed();
    const [pln, usd] = moneyPace(db, { today: "2026-11-09", startDay: 1 });
    expect(pln).toMatchObject({ currency: "PLN", income_minor: 8000_00, spend_minor: 5000_00, net_minor: 3000_00, periods: 3, balance_minor: 8900_00 });
    expect(pln!.savings_rate).toBeCloseTo(0.375, 3);
    expect(usd).toMatchObject({ currency: "USD", balance_minor: 500_00, periods: 0, savings_rate: null });
  });

  test("the calculators start from the card, else the defaults, else your pace", () => {
    const { db } = seed();
    const pace = moneyPace(db, { today: "2026-11-09", startDay: 1 })[0]!;
    const f = futureInputs({ rate_pct: 5 }, pace);
    expect(f).toMatchObject({ currency: "PLN", rate_pct: 5, years: 20, start_minor: 8900_00, monthly_minor: 3000_00, habit_category_id: null });
    expect(futureInputs(undefined, null)).toMatchObject({ currency: "EUR", monthly_minor: 0, start_minor: 0 });
  });

  test("a goal at 1 000 a month: on track for a deadline it makes, behind for one it does not", () => {
    const { db, sav } = seed();
    const base = { account_id: sav.id, target_minor: 9000_00 };
    const open = goalForecast(db, base, { today: "2026-11-09", startDay: 1 })!;
    expect(open).toMatchObject({ balance_minor: 3000_00, pace_minor: 1000_00, months_left: 6, eta: "2027-05-01", status: "open" });
    expect(open.milestones.map((m) => !!m.reached)).toEqual([true, false, false, false]);
    expect(open.milestones[1]!.eta).toBe("2027-01-01");
    const ok = goalForecast(db, { ...base, deadline: "2027-12-31" }, { today: "2026-11-09", startDay: 1 })!;
    expect(ok.status).toBe("on_track");
    const late = goalForecast(db, { ...base, deadline: "2027-02-15" }, { today: "2026-11-09", startDay: 1 })!;
    expect(late).toMatchObject({ status: "behind", months_to_deadline: 3, need_minor: 2000_00 });
    const done = goalForecast(db, { ...base, target_minor: 2000_00 }, { today: "2026-11-09", startDay: 1 })!;
    expect(done.status).toBe("done");
  });

  test("a goal that is not growing is stalled, not 'never'", () => {
    const { db, usd } = seed();
    const g = goalForecast(db, { account_id: usd.id, target_minor: 1000_00 }, { today: "2026-11-09", startDay: 1 })!;
    expect(g).toMatchObject({ status: "stalled", months_left: null, eta: null });
  });
});

describe("paceIn", () => {
  const pln = { currency: "PLN", balance_minor: 5_000_00, income_minor: 0, spend_minor: 8_000_00, net_minor: -8_000_00, periods: 6, savings_rate: null };
  const usd = { currency: "USD", balance_minor: 1_000_00, income_minor: 3_000_00, spend_minor: 0, net_minor: 3_000_00, periods: 3, savings_rate: 1 };
  test("adds a salary in one currency to a life spent in another", () => {
    const p = paceIn([pln, usd], "PLN", (f, t) => (f === "USD" && t === "PLN" ? 4 : null))!;
    expect(p).toMatchObject({ currency: "PLN", balance_minor: 9_000_00, income_minor: 12_000_00, spend_minor: 8_000_00, net_minor: 4_000_00, periods: 6, missing: [] });
    expect(p.savings_rate).toBeCloseTo(1 / 3);
  });
  test("leaves out, and names, a currency with no rate", () => {
    const p = paceIn([pln, usd], "PLN", () => null)!;
    expect(p).toMatchObject({ net_minor: -8_000_00, missing: ["USD"] });
  });
  test("is null with nothing to go on", () => expect(paceIn([], "PLN", () => 1)).toBeNull());
});

describe("moneyPace over chosen accounts", () => {
  test("a transfer in from outside the chosen accounts is money arriving", () => {
    const { db, sav } = seed();
    const [only] = moneyPace(db, { today: "2026-11-09", startDay: 1, accountIds: [sav.id] });
    expect(only).toMatchObject({ currency: "PLN", balance_minor: 3000_00, income_minor: 1000_00, spend_minor: 0, net_minor: 1000_00, periods: 3 });
  });
});

describe("moneyPace reads what was earned, not what moved", () => {
  test("a salary that moved currency is not counted twice, and money back under an expense category is not income", async () => {
    const { openBunDb } = await import("../src/drivers/bun");
    const { migrate } = await import("../src/schema");
    const { createAccount, createCategory, createTransaction } = await import("../src/repo");
    const { moneyPace } = await import("../src/forecast");
    const db = openBunDb(":memory:"); migrate(db);
    const pln = createAccount(db, { name: "PLN", currency: "PLN" });
    const usd = createAccount(db, { name: "USD", currency: "USD" });
    const salary = createCategory(db, { name: "Salary", kind: "income" });
    const savings = createCategory(db, { name: "Savings", kind: "expense" });
    // Paid in złoty for the first three months, in dollars for the last three.
    for (const [d, acc, m] of [["2026-05-20", pln, 600000], ["2026-06-20", pln, 600000], ["2026-07-20", pln, 600000],
      ["2026-08-20", usd, 150000], ["2026-09-20", usd, 150000], ["2026-10-20", usd, 150000]] as const)
      createTransaction(db, { account_id: acc.id, date: d, amount_minor: m, category_id: salary.id });
    createTransaction(db, { account_id: pln.id, date: "2026-06-25", amount_minor: 100000, category_id: savings.id });
    const pace = moneyPace(db, { today: "2026-11-25", startDay: 1, periods: 6 });
    const p = pace.find((x) => x.currency === "PLN")!, u = pace.find((x) => x.currency === "USD")!;
    expect(u.income_minor).toBe(75000);
    expect(p.income_minor).toBe(300000);
    expect(p.spend_minor).toBe(Math.round(-100000 / 6));
  });
});
