import { describe, expect, test } from "bun:test";
import { openBunDb } from "../src/drivers/bun";
import { migrate } from "../src/schema";
import { budgetCategoryIds, createAccount, createBudget, createCategory, createRecurring, createTag, createTransaction } from "../src/repo";
import { accountLeftover, budgetRows, categoryChecklist, checklistTotals, daysToSalary, freeMoney, regularSpending, savingsGoal, subscriptionsPerYear, templateFromTransaction, upcomingPayments } from "../src/insights";
import { candidateFromTransaction } from "../src/detect";

function seed() {
  const db = openBunDb(); migrate(db);
  const acc = createAccount(db, { name: "Main", currency: "PLN" });
  const sav = createAccount(db, { name: "Savings", currency: "PLN", opening_balance_minor: 400000 });
  const food = createCategory(db, { name: "Food" });
  const coffee = createCategory(db, { name: "Coffee", parent_id: food.id });
  const rent = createCategory(db, { name: "Rent" });
  const tag = createTag(db, { name: "work" });
  createBudget(db, { currency: "PLN", amount_minor: 300000, starts: "2026-09-01" });
  createBudget(db, { currency: "PLN", amount_minor: 100000, starts: "2026-09-01", category_id: food.id });
  createBudget(db, { currency: "PLN", amount_minor: 50000, starts: "2026-09-01", account_id: sav.id, category_id: food.id });
  createTransaction(db, { account_id: acc.id, date: "2026-09-03T10:00:00+02:00", amount_minor: -20000, category_id: coffee.id, tag_ids: JSON.stringify([tag.id]), notes: "Latte" });
  createTransaction(db, { account_id: acc.id, date: "2026-08-03T10:00:00+02:00", amount_minor: -30000, category_id: coffee.id });
  createTransaction(db, { account_id: acc.id, date: "2026-07-03T10:00:00+02:00", amount_minor: -10000, category_id: coffee.id });
  createRecurring(db, { account_id: acc.id, amount_minor: -4500, frequency: "monthly", start_date: "2026-09-10", payee: "Netflix" });
  createRecurring(db, { account_id: acc.id, amount_minor: -1000, frequency: "weekly", start_date: "2026-09-10", payee: "Paper" });
  return { db, acc, sav, food, coffee, rent, tag };
}
const period = { start: "2026-09-01", end: "2026-10-01" };

describe("insights", () => {
  test("free money uses the overall budget once, per account scope", () => {
    const { db, sav } = seed();
    expect(freeMoney(db, { ...period, budgetAccount: null })).toEqual([{ currency: "PLN", minor: 280000 }]);
    expect(freeMoney(db, { ...period, accountIds: [sav.id], budgetAccount: sav.id })).toEqual([{ currency: "PLN", minor: 50000 }]);
  });
  test("days to salary spreads the free money", () => {
    const { db } = seed();
    const r = daysToSalary(db, { today: "2026-09-21", startDay: 1, budgetAccount: null });
    expect(r).toEqual({ days: 10, next: "2026-10-01", per_day: [{ currency: "PLN", minor: 28000 }] });
  });
  test("account leftover: balance now, and what the period moved", () => {
    const { db, acc, sav } = seed();
    createTransaction(db, { account_id: acc.id, date: "2026-09-05T10:00:00+02:00", amount_minor: 150000, notes: "Salary" });
    createTransaction(db, { account_id: acc.id, date: "2026-09-06T10:00:00+02:00", amount_minor: -5000, pending: 1 });
    const r = accountLeftover(db, { account_id: acc.id }, period)!;
    expect(r.name).toBe("Main");
    expect(r.balance_minor).toBe(90000);           // 150000 salary less 60000 of coffee; the pending row is not counted
    expect(r.with_pending_minor).toBe(85000);
    expect(r.in_minor).toBe(150000);
    expect(r.out_minor).toBe(25000);               // the period moved it, pending or not
    expect(accountLeftover(db, { account_id: sav.id }, period)!.balance_minor).toBe(400000);
    expect(accountLeftover(db, {}, period)).toBeNull();
  });
  test("savings goal", () => {
    const { db, sav } = seed();
    expect(savingsGoal(db, { account_id: sav.id, target_minor: 800000 })).toEqual({ balance: 400000, target: 800000, currency: "PLN", ratio: 0.5 });
  });
  test("checklist, subscriptions, templates, regular spending", () => {
    const { db, acc, food, rent, coffee, tag } = seed();
    expect(categoryChecklist(db, { category_ids: [food.id, rent.id] }, period).map((c) => [c.name, c.done])).toEqual([["Coffee", true], ["Rent", false]]);
    // last: the most recent transaction before the period started (Aug, not the Sep one in the period itself)
    const [coffeeItem, rentItem] = categoryChecklist(db, { category_ids: [food.id, rent.id] }, period);
    expect(coffeeItem!.last).toEqual({ id: expect.any(String), amount_minor: -30000, currency: "PLN", date: "2026-08-03T10:00:00+02:00", tag_ids: [], notes: null, account_id: acc.id, payee: null });
    expect(rentItem!.last).toBeNull();
    // no transaction before the period: falls back to the most recent one overall
    const gadgets = createCategory(db, { name: "Gadgets" });
    createTransaction(db, { account_id: acc.id, date: "2026-09-15T10:00:00+02:00", amount_minor: -5000, category_id: gadgets.id });
    const gadgetsItem = categoryChecklist(db, { category_ids: [gadgets.id] }, period)[0]!;
    expect(gadgetsItem.last).toEqual({ id: expect.any(String), amount_minor: -5000, currency: "PLN", date: "2026-09-15T10:00:00+02:00", tag_ids: [], notes: null, account_id: acc.id, payee: null });
    const subs = subscriptionsPerYear(db);
    expect(subs.lines.map((l) => [l.title, l.yearly_minor, l.per_period])).toEqual([["Netflix", 54000, "per month"], ["Paper", 52000, "per week"]]);
    expect(subs.totals).toEqual([{ currency: "PLN", minor: 106000 }]);
    expect(subscriptionsPerYear(db, { exclude_rule_ids: [subs.lines[1]!.rule.id] }).totals).toEqual([{ currency: "PLN", minor: 54000 }]);
    // a folder in the checklist stands for its categories
    expect(categoryChecklist(db, { category_ids: [food.id] }, period).map((c) => c.name)).toEqual(["Coffee"]);
    const tpl = templateFromTransaction({ category_id: coffee.id, tag_ids: JSON.stringify([tag.id]), notes: "Latte\nmore", amount_minor: -20000, account_id: acc.id });
    const up = upcomingPayments(db, { templates: [tpl, { ...tpl, notes: "Rent" }] }, period);
    expect(up.map((u) => u.done)).toEqual([true, false]);
    expect(up[0]!.tag_names).toEqual(["work"]);
    const reg = regularSpending(db, { category_ids: [food.id] }, { today: "2026-09-20" });
    expect(reg).toEqual([{ currency: "PLN", average_minor: 10000, periods: 6, last_minor: 20000, frequency: "monthly" }]);
  });
  test("rule from a transaction picks up the monthly series", () => {
    const { db } = seed();
    const t = db.get<{ id: string }>(`SELECT id FROM transactions WHERE amount_minor=-30000`)!;
    const c = candidateFromTransaction(db, t.id, "2026-09-08")!;
    expect(c.frequency).toBe("monthly");
    expect(c.next_date >= "2026-09-08").toBe(true);
  });
});

import { convertTagToCategory, getRow, listRows as list2 } from "../src/repo";
describe("tag → category", () => {
  test("moves transactions and rules, deletes the tag", () => {
    const { db, acc, food, tag } = seed();
    const cat = convertTagToCategory(db, tag.id, { parent_id: food.id });
    expect(cat.name).toBe("work");
    const moved = list2(db, "transactions", "deleted=0 AND category_id=?", [cat.id]);
    expect(moved.length).toBe(1);
    expect(moved[0]!.tag_ids).toBe("[]");
    expect(getRow(db, "tags", tag.id)?.deleted).toBe(1);
  });
});

describe("a budget over several categories", () => {
  function seedMulti() {
    const db = openBunDb(); migrate(db);
    const acc = createAccount(db, { name: "Main", currency: "PLN" });
    const food = createCategory(db, { name: "Food" });
    const fuel = createCategory(db, { name: "Fuel" });
    const fun = createCategory(db, { name: "Fun" });
    const spend = (category_id: string, minor: number) =>
      createTransaction(db, { account_id: acc.id, date: "2026-09-10T10:00:00+02:00", amount_minor: -minor, category_id });
    spend(food.id, 3000); spend(fuel.id, 20000); spend(fun.id, 5000);
    return { db, acc, food, fuel, fun };
  }
  const period = { start: "2026-09-01", end: "2026-10-01", budgetAccount: null };

  test("counts every category in the set and nothing else", () => {
    const { db, food, fuel } = seedMulti();
    createBudget(db, { currency: "PLN", amount_minor: 100000, starts: "2026-09-01", category_ids: JSON.stringify([food.id, fuel.id]) });
    const row = budgetRows(db, period)[0]!;
    expect(row.spent_minor).toBe(23000);       // food + fuel, not fun
    expect(budgetCategoryIds(row.budget)).toEqual([food.id, fuel.id]);
  });

  test("a folder in the set still brings its categories with it", () => {
    const db = openBunDb(); migrate(db);
    const acc = createAccount(db, { name: "Main", currency: "PLN" });
    const out = createCategory(db, { name: "Going out" });
    const bar = createCategory(db, { name: "Bar", parent_id: out.id });
    const fuel = createCategory(db, { name: "Fuel" });
    createTransaction(db, { account_id: acc.id, date: "2026-09-10T10:00:00+02:00", amount_minor: -4000, category_id: bar.id });
    createTransaction(db, { account_id: acc.id, date: "2026-09-10T10:00:00+02:00", amount_minor: -20000, category_id: fuel.id });
    createBudget(db, { currency: "PLN", amount_minor: 100000, starts: "2026-09-01", category_ids: JSON.stringify([out.id, fuel.id]) });
    expect(budgetRows(db, period)[0]!.spent_minor).toBe(24000);
  });

  test("a budget written before the set existed still counts its one category", () => {
    const { db, food } = seedMulti();
    const b = createBudget(db, { currency: "PLN", amount_minor: 100000, starts: "2026-09-01", category_id: food.id });
    // What a row restored from an older backup looks like: the single column, and nothing in the set.
    db.run(`UPDATE budgets SET category_ids='[]' WHERE id=?`, [b.id]);
    const row = budgetRows(db, period)[0]!;
    expect(budgetCategoryIds(row.budget)).toEqual([food.id]);
    expect(row.spent_minor).toBe(3000);
  });

  test("category_id is kept in step with the set, so the two never disagree", () => {
    const { db, food, fuel } = seedMulti();
    const b = createBudget(db, { currency: "PLN", amount_minor: 100000, starts: "2026-09-01", category_ids: JSON.stringify([food.id, fuel.id]) });
    expect(b.category_id).toBe(food.id);   // an older build reads a narrower budget, never a wider one
    const overall = createBudget(db, { currency: "PLN", amount_minor: 100000, starts: "2026-09-01" });
    expect(overall.category_id).toBeNull();
    expect(budgetCategoryIds(overall)).toEqual([]);
  });

  test("two budgets over different sets do not supersede each other", () => {
    const { db, food, fuel, fun } = seedMulti();
    createBudget(db, { currency: "PLN", amount_minor: 100000, starts: "2026-09-01", category_ids: JSON.stringify([food.id, fuel.id]) });
    createBudget(db, { currency: "PLN", amount_minor: 20000, starts: "2026-09-01", category_ids: JSON.stringify([fun.id]) });
    expect(budgetRows(db, period).length).toBe(2);
  });
});

describe("payments checklist", () => {
  test("a category waited for per tag is one line per tag, done by an expense carrying it", () => {
    const { db, acc } = seed();
    const insurance = createCategory(db, { name: "Insurance" });
    const mum = createTag(db, { name: "mum" });
    const dad = createTag(db, { name: "dad" });
    createTransaction(db, { account_id: acc.id, date: "2026-09-05T10:00:00+02:00", amount_minor: -9000, category_id: insurance.id, tag_ids: JSON.stringify([mum.id]) });
    createTransaction(db, { account_id: acc.id, date: "2026-08-05T10:00:00+02:00", amount_minor: -7000, category_id: insurance.id, tag_ids: JSON.stringify([dad.id]) });
    const items = categoryChecklist(db, { category_ids: [insurance.id], category_tags: { [insurance.id]: [mum.id, dad.id] } }, period);
    expect(items.map((i) => [i.key, i.tag_id, i.done, i.spent_minor])).toEqual([[`${insurance.id}#${mum.id}`, mum.id, true, 9000], [`${insurance.id}#${dad.id}`, dad.id, false, 0]]);
    // the line is prefilled from the last payment *for that person*
    expect(items[1]!.last?.amount_minor).toBe(-7000);
  });
  test("a folder waited for per tag stands as a whole once per tag", () => {
    const { db, food, coffee, tag } = seed();
    const items = categoryChecklist(db, { category_ids: [food.id], category_tags: { [food.id]: [tag.id] } }, period);
    expect(items.map((i) => [i.category_id, i.done])).toEqual([[food.id, true]]);
    expect(items[0]!.category_id).not.toBe(coffee.id);
  });
  test("recurring expenses that fall in the period join the list", () => {
    const { db, acc } = seed();
    // seed: Netflix monthly from 2026-09-10 (still owed), Paper weekly from 2026-09-10 (still owed)
    const gym = createRecurring(db, { account_id: acc.id, amount_minor: -8000, frequency: "monthly", start_date: "2026-09-20", next_date: "2026-10-20", payee: "Gym" });
    createTransaction(db, { account_id: acc.id, date: "2026-09-20T09:00:00+02:00", amount_minor: -8000, recurring_id: gym.id });
    createRecurring(db, { account_id: acc.id, amount_minor: -2000, frequency: "yearly", start_date: "2027-01-05", payee: "Domain" });
    createRecurring(db, { account_id: acc.id, amount_minor: 500000, frequency: "monthly", start_date: "2026-09-25", payee: "Salary" });
    const items = categoryChecklist(db, { include_recurring: true }, period);
    expect(items.map((i) => [i.name, i.done, i.due])).toEqual([["Netflix", false, "2026-09-10"], ["Paper", false, "2026-09-10"], ["Gym", true, null]]);
    expect(items.find((i) => i.name === "Gym")!.spent_minor).toBe(8000);
    expect(categoryChecklist(db, {}, period)).toEqual([]);
  });
  test("a weekly payment counts its occurrences; a skipped one is no longer asked for", () => {
    const { db, acc } = seed();
    const lessons = createRecurring(db, { account_id: acc.id, amount_minor: -10000, frequency: "weekly", start_date: "2026-09-03", next_date: "2026-09-17", payee: "Polish" });
    createTransaction(db, { account_id: acc.id, date: "2026-09-03T18:00:00+02:00", amount_minor: -10000, recurring_id: lessons.id });
    // 3 Sep paid, 10 Sep skipped (next_date moved past it), 17 and 24 Sep still owed
    const line = categoryChecklist(db, { include_recurring: true }, period).find((i) => i.rule_id === lessons.id)!;
    expect([line.occurrences, line.due, line.expected_minor, line.done]).toEqual([{ paid: 1, total: 3 }, "2026-09-17", 20000, false]);
  });
  test("a rule left out of the checklist is not waited for", () => {
    const { db } = seed();
    const all = categoryChecklist(db, { include_recurring: true }, period);
    const netflix = all.find((i) => i.name === "Netflix")!.rule_id!;
    expect(categoryChecklist(db, { include_recurring: true, exclude_rule_ids: [netflix] }, period).map((i) => i.name)).toEqual(["Paper"]);
  });
});

describe("payments checklist totals", () => {
  test("paid this period, and what the open lines are expected to cost", () => {
    const { db, acc, food, rent } = seed();
    createTransaction(db, { account_id: acc.id, date: "2026-08-01T10:00:00+02:00", amount_minor: -250000, category_id: rent.id });
    const items = categoryChecklist(db, { category_ids: [food.id, rent.id], include_recurring: true }, period);
    // Coffee paid 200.00; Rent open, expected at last month's 2500.00; Netflix 45.00 owed, and Paper 10.00 weekly three times (10, 17, 24 Sep)
    expect(checklistTotals(items)).toEqual([{ currency: "PLN", paid_minor: 20000, expected_minor: 250000 + 4500 + 3 * 1000 }]);
  });
});
