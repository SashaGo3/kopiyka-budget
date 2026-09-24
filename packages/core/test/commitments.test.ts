import { describe, expect, test } from "bun:test";
import { openBunDb } from "../src/drivers/bun";
import { migrate } from "../src/schema";
import { createAccount, createCategory, createDebt, createRecurring, createTransaction } from "../src/repo";
import { commitments, committedMinor } from "../src/commitments";
import { occurrencesBetween, postDueRecurring } from "../src/recurring";
import { claimRecurring } from "../src/claim";

function fresh() {
  const db = openBunDb();
  migrate(db);
  const acc = createAccount(db, { name: "Bank", currency: "PLN" });
  const other = createAccount(db, { name: "Euro", currency: "EUR" });
  return { db, acc, other };
}
const WINDOW = { start: "2026-09-21", end: "2026-10-01" };

describe("occurrencesBetween", () => {
  const rule = { frequency: "monthly" as const, interval: 1, next_date: "2026-09-25", end_date: null, active: 1 as const };

  test("only the occurrences inside the window", () => {
    expect(occurrencesBetween(rule, "2026-09-21", "2026-10-01")).toEqual(["2026-09-25"]);
    expect(occurrencesBetween(rule, "2026-09-26", "2026-10-01")).toEqual([]);
    expect(occurrencesBetween(rule, "2026-09-21", "2026-12-01")).toEqual(["2026-09-25", "2026-10-25", "2026-11-25"]);
  });

  test("a weekly rule needs however many it needs — the count bound could not say this", () => {
    const weekly = { ...rule, frequency: "weekly" as const, next_date: "2026-09-01" };
    expect(occurrencesBetween(weekly, "2026-09-01", "2026-10-01")).toEqual(["2026-09-01", "2026-09-08", "2026-09-15", "2026-09-22", "2026-09-29"]);
  });

  test("an overdue occurrence is still money that has to leave", () => {
    const behind = { ...rule, next_date: "2026-09-01" };
    expect(occurrencesBetween(behind, "2026-09-01", "2026-10-01")).toEqual(["2026-09-01"]);
  });

  test("a paused rule and one past its end date commit to nothing", () => {
    expect(occurrencesBetween({ ...rule, active: 0 }, "2026-09-21", "2026-12-01")).toEqual([]);
    expect(occurrencesBetween({ ...rule, end_date: "2026-09-30" }, "2026-09-21", "2026-12-01")).toEqual(["2026-09-25"]);
  });
});

describe("what is still coming", () => {
  test("a rule due inside the window, in its account's currency", () => {
    const { db, acc } = fresh();
    createRecurring(db, { account_id: acc.id, amount_minor: -4999, frequency: "monthly", start_date: "2026-09-25", payee: "Rent" });
    expect(commitments(db, WINDOW)).toEqual([
      { kind: "rule", id: expect.any(String), title: "Rent", day: "2026-09-25", currency: "PLN", minor: 4999, category_id: null, tag_ids: [] },
    ]);
    expect(committedMinor(db, WINDOW)).toEqual([{ currency: "PLN", minor: 4999 }]);
  });

  test("income is not a commitment", () => {
    const { db, acc } = fresh();
    createRecurring(db, { account_id: acc.id, amount_minor: 800000, frequency: "monthly", start_date: "2026-09-25", payee: "Salary" });
    expect(commitments(db, WINDOW)).toEqual([]);
  });

  test("an occurrence that has been posted is no longer coming", () => {
    const { db, acc } = fresh();
    createRecurring(db, { account_id: acc.id, amount_minor: -4999, frequency: "monthly", start_date: "2026-09-25", payee: "Rent", auto_post: 1 });
    expect(committedMinor(db, WINDOW)).toEqual([{ currency: "PLN", minor: 4999 }]);
    expect(postDueRecurring(db, "2026-09-25")).toHaveLength(1);
    // next_date has moved past it, which is the whole double-counting argument.
    expect(committedMinor(db, WINDOW)).toEqual([]);
  });

  test("an occurrence claimed by the bank's own charge is no longer coming either", () => {
    const { db, acc } = fresh();
    createRecurring(db, { account_id: acc.id, amount_minor: -4999, frequency: "monthly", start_date: "2026-09-25", payee: "Netflix", match_payee: "NETFLIX.COM" });
    const tx = createTransaction(db, { account_id: acc.id, date: "2026-09-25T10:00:00Z", amount_minor: -5299, payee: "NETFLIX.COM" });
    expect(claimRecurring(db, tx, { today: "2026-09-25", waitDefault: 7 })).not.toBeNull();
    expect(committedMinor(db, WINDOW)).toEqual([]);
  });

  test("a debt I owe, due in the window; one owed to me is not my problem", () => {
    const { db } = fresh();
    createDebt(db, { person: "Anna", amount_minor: 20000, currency: "PLN", opened_date: "2026-08-01", due_date: "2026-09-28", direction: "i_owe" });
    createDebt(db, { person: "Bob", amount_minor: 50000, currency: "PLN", opened_date: "2026-08-01", due_date: "2026-09-28", direction: "owed_to_me" });
    expect(committedMinor(db, WINDOW)).toEqual([{ currency: "PLN", minor: 20000 }]);
  });

  test("a settled debt, and one due after the window, are both out", () => {
    const { db } = fresh();
    createDebt(db, { person: "Anna", amount_minor: 20000, currency: "PLN", opened_date: "2026-08-01", due_date: "2026-09-28", direction: "i_owe", settled_date: "2026-09-22" });
    createDebt(db, { person: "Cara", amount_minor: 30000, currency: "PLN", opened_date: "2026-08-01", due_date: "2026-10-05", direction: "i_owe" });
    expect(committedMinor(db, WINDOW)).toEqual([]);
  });

  test("currencies are kept apart, and the account scope is respected", () => {
    const { db, acc, other } = fresh();
    createRecurring(db, { account_id: acc.id, amount_minor: -4999, frequency: "monthly", start_date: "2026-09-25", payee: "Rent" });
    createRecurring(db, { account_id: other.id, amount_minor: -1000, frequency: "monthly", start_date: "2026-09-26", payee: "Server" });
    expect(committedMinor(db, WINDOW).sort((a, b) => a.currency.localeCompare(b.currency)))
      .toEqual([{ currency: "EUR", minor: 1000 }, { currency: "PLN", minor: 4999 }]);
    expect(committedMinor(db, { ...WINDOW, accountIds: [acc.id] })).toEqual([{ currency: "PLN", minor: 4999 }]);
  });

  test("asking within a category scope leaves debts out, because a debt is in no category", () => {
    const { db, acc } = fresh();
    const subs = createCategory(db, { name: "Subscriptions" });
    const netflix = createCategory(db, { name: "Netflix", parent_id: subs.id });
    createRecurring(db, { account_id: acc.id, amount_minor: -4999, frequency: "monthly", start_date: "2026-09-25", category_id: netflix.id });
    createDebt(db, { person: "Anna", amount_minor: 20000, currency: "PLN", opened_date: "2026-08-01", due_date: "2026-09-28", direction: "i_owe" });
    expect(committedMinor(db, WINDOW)).toEqual([{ currency: "PLN", minor: 24999 }]);
    // A folder stands for what is inside it.
    expect(committedMinor(db, { ...WINDOW, categoryIds: [subs.id] })).toEqual([{ currency: "PLN", minor: 4999 }]);
  });

  test("they come back in the order they will happen", () => {
    const { db, acc } = fresh();
    createRecurring(db, { account_id: acc.id, amount_minor: -1000, frequency: "monthly", start_date: "2026-09-29", payee: "Late" });
    createRecurring(db, { account_id: acc.id, amount_minor: -2000, frequency: "monthly", start_date: "2026-09-23", payee: "Early" });
    expect(commitments(db, WINDOW).map((c) => c.title)).toEqual(["Early", "Late"]);
  });
});
