import { describe, expect, test } from "bun:test";
import { addPeriod, advanceRule, budgetPeriod, dueManualRules, dueOccurrences, occurrenceTimestamp, occurrencesPerYear, plannedNotifications, postDueRecurring, upcomingOccurrences, yearlyAmountMinor } from "../src/recurring";
import { openBunDb } from "../src/drivers/bun";
import { migrate } from "../src/schema";
import { createAccount, createRecurring, createTransaction, listRows, getRow, recurringSpend } from "../src/repo";
import type { RecurringRule } from "../src/models";

describe("recurring", () => {
  test("month end clamping", () => {
    expect(addPeriod("2026-01-31", "monthly", 1)).toBe("2026-02-28");
    expect(addPeriod("2028-01-31", "monthly", 1)).toBe("2028-02-29");
    expect(addPeriod("2026-01-31", "monthly", 3)).toBe("2026-04-30");
    expect(addPeriod("2024-02-29", "yearly", 1)).toBe("2025-02-28");
    expect(addPeriod("2026-12-15", "monthly", 1)).toBe("2027-01-15");
  });
  test("weekly and daily", () => {
    expect(addPeriod("2026-09-07", "weekly", 2)).toBe("2026-09-21");
    expect(addPeriod("2026-09-30", "daily", 1)).toBe("2026-10-01");
    expect(addPeriod("2026-09-01", "daily", -1)).toBe("2026-08-31");
  });
  test("cadence normalised to a year", () => {
    expect(occurrencesPerYear("monthly", 1)).toBe(12);
    expect(occurrencesPerYear("yearly", 1)).toBe(1);
    expect(occurrencesPerYear("monthly", 3)).toBe(4);   // quarterly
    expect(occurrencesPerYear("weekly", 2)).toBeCloseTo(26.07, 2);
    // A weekly -280 is a bigger yearly commitment than a monthly -1000.
    expect(yearlyAmountMinor({ amount_minor: -28000, frequency: "weekly", interval: 1 })).toBe(-1460000);
    expect(yearlyAmountMinor({ amount_minor: -100000, frequency: "monthly", interval: 1 })).toBe(-1200000);
    expect(yearlyAmountMinor({ amount_minor: -80000, frequency: "yearly", interval: 1 })).toBe(-80000);
    // Income keeps its sign, so a salary offsets the outgoings rather than adding to them.
    expect(yearlyAmountMinor({ amount_minor: 500000, frequency: "monthly", interval: 1 })).toBe(6000000);
  });
  test("occurrences", () => {
    const r = { frequency: "monthly" as const, interval: 1, next_date: "2026-09-10", end_date: "2026-11-30", active: 1 as const };
    expect(upcomingOccurrences(r, 5)).toEqual(["2026-09-10", "2026-10-10", "2026-11-10"]);
    expect(dueOccurrences(r, "2026-10-15")).toEqual(["2026-09-10", "2026-10-10"]);
    expect(dueOccurrences({ ...r, active: 0 }, "2026-10-15")).toEqual([]);
  });
  test("notification plan respects days-before and horizon", () => {
    const base: RecurringRule = {
      id: "r1", updated_at: 0, deleted: 0, account_id: "a", amount_minor: -1000, category_id: null, payee: null, notes: null,
      tag_ids: "[]", frequency: "monthly", interval: 1, start_date: "2026-09-10", end_date: null, next_date: "2026-09-10",
      notify: 1, notify_days_before: 2, auto_post: 0, active: 1, time_of_day: "09:00",
    };
    const plan = plannedNotifications([base], "2026-09-07", 40);
    expect(plan).toEqual([
      { rule_id: "r1", occurrence: "2026-09-10", fire_day: "2026-09-08", kind: "reminder" },
      { rule_id: "r1", occurrence: "2026-09-10", fire_day: "2026-09-10", kind: "due" },
      { rule_id: "r1", occurrence: "2026-10-10", fire_day: "2026-10-08", kind: "reminder" },
      { rule_id: "r1", occurrence: "2026-10-10", fire_day: "2026-10-10", kind: "due" },
    ]);
    // No reminder when it would fall before today; the due notification still fires on the day.
    expect(plannedNotifications([base], "2026-09-09", 10).map((p) => p.kind)).toEqual(["due"]);
    expect(plannedNotifications([{ ...base, notify_days_before: 0 }], "2026-09-07", 10).map((p) => p.kind)).toEqual(["due"]);
    expect(plannedNotifications([{ ...base, notify: 0 }], "2026-09-07")).toEqual([]);
  });
});

describe("auto posting and periods", () => {
  test("auto rules post due occurrences and advance; manual rules wait", () => {
    const db = openBunDb(); migrate(db);
    const acc = createAccount(db, { name: "A", currency: "PLN" });
    const auto = createRecurring(db, { account_id: acc.id, amount_minor: -6000, frequency: "monthly", start_date: "2026-08-06", payee: "Disney+", auto_post: 1, time_of_day: "17:36" });
    createRecurring(db, { account_id: acc.id, amount_minor: -437400, frequency: "monthly", start_date: "2026-08-03", payee: "Rent", auto_post: 0 });
    const posted = postDueRecurring(db, "2026-09-07");
    expect(posted.map((p) => [p.rule.payee, p.days])).toEqual([["Disney+", ["2026-08-06", "2026-09-06"]]]);
    const txs = listRows(db, "transactions");
    expect(txs.length).toBe(2);
    expect(txs[1]!.date.slice(0, 16)).toBe("2026-09-06T17:36");
    expect(txs[1]!.recurring_id).toBe(auto.id);
    expect(getRow(db, "recurring_rules", auto.id)?.next_date).toBe("2026-10-06");
    expect(postDueRecurring(db, "2026-09-07").length).toBe(0);
    // The manual rule is what the "Recurring due" queue on Transactions shows: still owed, never auto-written.
    expect(dueManualRules(db, "2026-09-07").map((d) => [d.rule.payee, d.days])).toEqual([["Rent", ["2026-08-03", "2026-09-03"]]]);
  });

  test("due manual rules cover only what is owed, and skipping empties the queue", () => {
    const db = openBunDb(); migrate(db);
    const acc = createAccount(db, { name: "A", currency: "PLN" });
    const rent = createRecurring(db, { account_id: acc.id, amount_minor: -437400, frequency: "monthly", start_date: "2026-09-03", payee: "Rent", auto_post: 0 });
    createRecurring(db, { account_id: acc.id, amount_minor: -2000, frequency: "monthly", start_date: "2026-10-20", payee: "Gym", auto_post: 0 });
    createRecurring(db, { account_id: acc.id, amount_minor: -900, frequency: "monthly", start_date: "2026-09-01", payee: "Paused", auto_post: 0, active: 0 });
    // Only the rule whose day has passed: not the future one, not the paused one.
    expect(dueManualRules(db, "2026-09-07").map((d) => d.rule.payee)).toEqual(["Rent"]);
    // Skipping adds no transaction and takes it out of the queue.
    advanceRule(db, rent, "2026-09-03");
    expect(dueManualRules(db, "2026-09-07")).toEqual([]);
    expect(listRows(db, "transactions").length).toBe(0);
    expect(getRow(db, "recurring_rules", rent.id)?.next_date).toBe("2026-10-03");
  });
  test("recurring spend counts only what a rule posted", () => {
    const db = openBunDb(); migrate(db);
    const acc = createAccount(db, { name: "A", currency: "PLN" });
    const rule = createRecurring(db, { account_id: acc.id, amount_minor: -6000, frequency: "monthly", start_date: "2026-09-06", payee: "Disney+", auto_post: 1 });
    postDueRecurring(db, "2026-09-07");
    // Logged by hand, same shop and month: not a rule posting, so it must not be counted.
    createTransaction(db, { account_id: acc.id, date: "2026-09-08T10:00:00+02:00", amount_minor: -2500, payee: "Disney+" });
    const spend = recurringSpend(db, "2026-09-01", "2026-10-01");
    expect(spend).toEqual([{ recurring_id: rule.id, currency: "PLN", spent_minor: -6000, n: 1 }]);
    // Outside the window: nothing.
    expect(recurringSpend(db, "2026-10-01", "2026-11-01")).toEqual([]);
    // Another account's scope excludes it.
    const other = createAccount(db, { name: "B", currency: "PLN" });
    expect(recurringSpend(db, "2026-09-01", "2026-10-01", [other.id])).toEqual([]);
    expect(recurringSpend(db, "2026-09-01", "2026-10-01", [acc.id]).length).toBe(1);
  });

  test("occurrence timestamp and mid-month budget periods", () => {
    expect(occurrenceTimestamp("2026-09-22", "11:17", 120)).toBe("2026-09-22T11:17:00+02:00");
    expect(budgetPeriod("2026-09-07", 15)).toEqual({ start: "2026-08-15", end: "2026-09-15" });
    expect(budgetPeriod("2026-09-20", 15)).toEqual({ start: "2026-09-15", end: "2026-10-15" });
    expect(budgetPeriod("2026-09-07", 1)).toEqual({ start: "2026-09-01", end: "2026-10-01" });
    expect(budgetPeriod("2026-02-10", 31)).toEqual({ start: "2026-01-31", end: "2026-02-28" });
  });
});
