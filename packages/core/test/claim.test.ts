import { describe, expect, test } from "bun:test";
import { claimRecurring, matchRecurring } from "../src/claim";
import { openBunDb } from "../src/drivers/bun";
import { migrate } from "../src/schema";
import { createAccount, createCategory, createRecurring, createTransaction, getRow, listRows } from "../src/repo";
import { dueManualRules, plannedNotifications, postDueRecurring, ruleWaitDays, waitingRules } from "../src/recurring";
import type { RecurringRule, Transaction } from "../src/models";

const TODAY = "2026-09-21";

function fixture(rule: Partial<RecurringRule> = {}) {
  const db = openBunDb();
  migrate(db);
  const acc = createAccount(db, { name: "Revolut", currency: "PLN" });
  const cat = createCategory(db, { name: "Entertainment" });
  const r = createRecurring(db, {
    account_id: acc.id, amount_minor: -1299, category_id: cat.id, payee: "Netflix",
    frequency: "monthly", interval: 1, start_date: "2026-09-20", next_date: "2026-09-20", auto_post: 1, ...rule,
  });
  return { db, acc, cat, rule: r };
}

const charge = (db: ReturnType<typeof openBunDb>, account_id: string, o: Partial<Transaction> & { date: string; amount_minor: number }) =>
  createTransaction(db, { account_id, payee: "NETFLIX.COM AMSTERDAM", pending: 1, source: "shortcut", ...o });

describe("a real charge claiming its recurring occurrence", () => {
  test("the bank's payment settles the occurrence instead of a second row being written", () => {
    const { db, acc, cat, rule } = fixture();
    const tx = charge(db, acc.id, { date: `${TODAY}T08:14:00+02:00`, amount_minor: -1299 });
    const hit = claimRecurring(db, tx, { today: TODAY, waitDefault: 7 });
    expect(hit?.occurrence).toBe("2026-09-20");

    const saved = getRow(db, "transactions", tx.id)!;
    expect(saved.recurring_id).toBe(rule.id);
    // The rule's decision fills the gaps the notification left, and with a category there is nothing
    // left for the pending queue to ask about.
    expect(saved.category_id).toBe(cat.id);
    expect(saved.pending).toBe(0);
    // The rule has moved on, so the day it would have posted itself never comes.
    expect(getRow(db, "recurring_rules", rule.id)!.next_date).toBe("2026-10-20");
    expect(postDueRecurring(db, TODAY, 7)).toEqual([]);
    expect(listRows(db, "transactions").length).toBe(1);
  });

  test("with waiting off nothing is claimed, and the rule posts on the day as it always did", () => {
    const { db, acc, rule } = fixture();
    const tx = charge(db, acc.id, { date: `${TODAY}T08:14:00+02:00`, amount_minor: -1299 });
    expect(claimRecurring(db, tx, { today: TODAY, waitDefault: 0 })).toBeNull();
    expect(postDueRecurring(db, TODAY, 0).flatMap((p) => p.days)).toEqual(["2026-09-20"]);
    expect(getRow(db, "recurring_rules", rule.id)!.next_date).toBe("2026-10-20");
    expect(listRows(db, "transactions").length).toBe(2);   // the double this whole feature exists to stop
  });

  test("a name the rule recognises claims a charge whose price has changed; an unrecognised one does not", () => {
    const { db, acc } = fixture({ match_payee: "NETFLIX.COM" });
    const risen = charge(db, acc.id, { date: `${TODAY}T08:14:00+02:00`, amount_minor: -1549 });
    expect(claimRecurring(db, risen, { today: TODAY, waitDefault: 7 })?.occurrence).toBe("2026-09-20");

    const other = fixture({ match_payee: "NETFLIX.COM" });
    const elsewhere = charge(other.db, other.acc.id, { date: `${TODAY}T08:14:00+02:00`, amount_minor: -1549, payee: "ZABKA ZE212 K.5" });
    expect(matchRecurring(other.db, elsewhere, { today: TODAY, waitDefault: 7 })).toBeNull();
  });

  test("a named match still refuses an amount from another league", () => {
    const { db, acc } = fixture({ match_payee: "NETFLIX.COM" });
    const giftCard = charge(db, acc.id, { date: `${TODAY}T08:14:00+02:00`, amount_minor: -20000 });
    expect(matchRecurring(db, giftCard, { today: TODAY, waitDefault: 7 })).toBeNull();
  });

  test("a rule with no name learns the one the bank uses from the charge it claims", () => {
    const { db, acc, rule } = fixture();
    expect(rule.match_payee).toBeNull();
    claimRecurring(db, charge(db, acc.id, { date: `${TODAY}T08:14:00+02:00`, amount_minor: -1299 }), { today: TODAY, waitDefault: 7 });
    expect(getRow(db, "recurring_rules", rule.id)!.match_payee).toBe("NETFLIX.COM AMSTERDAM");
  });

  test("the window has two ends: a charge taken early counts, one after the deadline does not", () => {
    const early = fixture();
    const before = charge(early.db, early.acc.id, { date: "2026-09-18T08:00:00+02:00", amount_minor: -1299 });
    expect(matchRecurring(early.db, before, { today: TODAY, waitDefault: 7 })?.occurrence).toBe("2026-09-20");

    const late = fixture();
    const after = charge(late.db, late.acc.id, { date: "2026-09-29T08:00:00+02:00", amount_minor: -1299 });
    expect(matchRecurring(late.db, after, { today: "2026-09-29", waitDefault: 7 })).toBeNull();

    const tooEarly = fixture();
    const wayBefore = charge(tooEarly.db, tooEarly.acc.id, { date: "2026-09-10T08:00:00+02:00", amount_minor: -1299 });
    expect(matchRecurring(tooEarly.db, wayBefore, { today: TODAY, waitDefault: 7 })).toBeNull();
  });

  test("an income rule is not settled by an expense of the same size", () => {
    const { db, acc } = fixture({ amount_minor: 500000, payee: "Salary", auto_post: 0 });
    const spent = charge(db, acc.id, { date: `${TODAY}T08:00:00+02:00`, amount_minor: -500000, payee: "Salary" });
    expect(matchRecurring(db, spent, { today: TODAY, waitDefault: 7 })).toBeNull();
  });

  test("a transfer leg and an already-claimed row are never claimed", () => {
    const { db, acc, rule } = fixture();
    const leg = createTransaction(db, { account_id: acc.id, date: `${TODAY}T08:00:00+02:00`, amount_minor: -1299, transfer_id: "tr1" });
    expect(matchRecurring(db, leg, { today: TODAY, waitDefault: 7 })).toBeNull();
    const already = createTransaction(db, { account_id: acc.id, date: `${TODAY}T08:00:00+02:00`, amount_minor: -1299, recurring_id: rule.id });
    expect(matchRecurring(db, already, { today: TODAY, waitDefault: 7 })).toBeNull();
  });

  test("only the earliest unpaid occurrence is claimable, so arrears are never settled by forgetting them", () => {
    // Three months behind and waiting: one charge pays one month, not the whole backlog.
    const { db, acc, rule } = fixture({ auto_post: 0, next_date: "2026-07-20", start_date: "2026-07-20" });
    const tx = charge(db, acc.id, { date: "2026-07-21T08:00:00+02:00", amount_minor: -1299 });
    expect(claimRecurring(db, tx, { today: TODAY, waitDefault: 7 })?.occurrence).toBe("2026-07-20");
    expect(getRow(db, "recurring_rules", rule.id)!.next_date).toBe("2026-08-20");
    // August's is owed; September's is still inside its own window and owes nothing yet.
    expect(dueManualRules(db, TODAY, 7).flatMap((d) => d.days)).toEqual(["2026-08-20"]);
    expect(waitingRules(db, TODAY, 7).flatMap((d) => d.days)).toEqual(["2026-09-20"]);
  });
});

describe("what a waiting rule does while it waits", () => {
  test("nothing is owed and nothing is posted inside the window", () => {
    const auto = fixture();
    expect(postDueRecurring(auto.db, TODAY, 7)).toEqual([]);
    expect(waitingRules(auto.db, TODAY, 7).flatMap((d) => d.days)).toEqual(["2026-09-20"]);

    const manual = fixture({ auto_post: 0 });
    expect(dueManualRules(manual.db, TODAY, 7)).toEqual([]);
    expect(waitingRules(manual.db, TODAY, 7).flatMap((d) => d.days)).toEqual(["2026-09-20"]);
  });

  test("once the window closes the rule acts as it always did — automatic posts, manual asks", () => {
    const after = "2026-09-28";   // 2026-09-20 + 7 days, and one more
    const auto = fixture();
    const posted = postDueRecurring(auto.db, after, 7);
    expect(posted.flatMap((p) => p.days)).toEqual(["2026-09-20"]);
    expect(posted[0]!.waited).toBe(true);
    expect(waitingRules(auto.db, after, 7)).toEqual([]);

    const manual = fixture({ auto_post: 0 });
    expect(dueManualRules(manual.db, after, 7).flatMap((d) => d.days)).toEqual(["2026-09-20"]);
  });

  test("the day's notification moves to the day the wait runs out and says the charge never came", () => {
    const { db } = fixture({ notify: 1, notify_days_before: 2 });
    const rules = listRows(db, "recurring_rules") as RecurringRule[];
    const plan = plannedNotifications(rules, "2026-09-18", 30, 7);
    expect(plan.filter((p) => p.occurrence === "2026-09-20")).toEqual([
      { rule_id: rules[0]!.id, occurrence: "2026-09-20", fire_day: "2026-09-18", kind: "reminder" },
      { rule_id: rules[0]!.id, occurrence: "2026-09-20", fire_day: "2026-09-28", kind: "late" },
    ]);
    // With waiting off it is the plain "due today" notification it has always been.
    expect(plannedNotifications(rules, "2026-09-18", 30, 0).find((p) => p.occurrence === "2026-09-20" && p.kind !== "reminder"))
      .toEqual({ rule_id: rules[0]!.id, occurrence: "2026-09-20", fire_day: "2026-09-20", kind: "due" });
  });

  test("a rule may want a longer rope than the default, but never none", () => {
    expect(ruleWaitDays({ wait_days: null }, 7)).toBe(7);
    expect(ruleWaitDays({ wait_days: 14 }, 7)).toBe(14);
    expect(ruleWaitDays({ wait_days: 1 }, 7)).toBe(1);
    // 0 is not a way to opt one rule out: the setting is the switch, and 0 there turns it off for all.
    expect(ruleWaitDays({ wait_days: 0 }, 7)).toBe(7);
    expect(ruleWaitDays({ wait_days: 14 }, 0)).toBe(0);
  });
});
