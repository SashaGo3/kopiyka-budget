import { describe, expect, test } from "bun:test";
import { openBunDb } from "../src/drivers/bun";
import { migrate } from "../src/schema";
import { createAccount, createDebt, getRow, listRows } from "../src/repo";
import { debtTotals, isOverdue, listDebts, plannedDebtNotifications, settleDebt } from "../src/debts";
import { DEFAULT_DEBT_NOTIFY_TIME } from "../src/models";

function seed() {
  const db = openBunDb(); migrate(db);
  const acc = createAccount(db, { name: "Main", currency: "PLN" });
  return { db, acc };
}

describe("debts", () => {
  test("listDebts filters by settled state", () => {
    const { db } = seed();
    const open = createDebt(db, { person: "Alex", amount_minor: 5000, currency: "PLN", opened_date: "2026-09-01" });
    const settled = createDebt(db, { person: "Bo", amount_minor: 2000, currency: "PLN", opened_date: "2026-08-01", settled_date: "2026-08-15" });
    expect(listDebts(db).map((d) => d.id).sort()).toEqual([open.id, settled.id].sort());
    expect(listDebts(db, { settled: false }).map((d) => d.id)).toEqual([open.id]);
    expect(listDebts(db, { settled: true }).map((d) => d.id)).toEqual([settled.id]);
  });

  test("debtTotals sums per currency and direction, open debts only", () => {
    const { db } = seed();
    createDebt(db, { person: "Alex", amount_minor: 5000, currency: "PLN", opened_date: "2026-09-01", direction: "owed_to_me" });
    createDebt(db, { person: "Bo", amount_minor: 3000, currency: "PLN", opened_date: "2026-09-02", direction: "i_owe" });
    createDebt(db, { person: "Cy", amount_minor: 1000, currency: "EUR", opened_date: "2026-09-03", direction: "owed_to_me" });
    createDebt(db, { person: "Dee", amount_minor: 9999, currency: "PLN", opened_date: "2026-08-01", settled_date: "2026-08-20" }); // excluded
    expect(debtTotals(listDebts(db))).toEqual([
      { currency: "EUR", owed_to_me_minor: 1000, i_owe_minor: 0 },
      { currency: "PLN", owed_to_me_minor: 5000, i_owe_minor: 3000 },
    ]);
  });

  test("isOverdue", () => {
    const { db } = seed();
    const overdue = createDebt(db, { person: "Alex", amount_minor: 5000, currency: "PLN", opened_date: "2026-08-01", due_date: "2026-09-01" });
    const future = createDebt(db, { person: "Bo", amount_minor: 5000, currency: "PLN", opened_date: "2026-08-01", due_date: "2026-09-20" });
    const openEnded = createDebt(db, { person: "Cy", amount_minor: 5000, currency: "PLN", opened_date: "2026-08-01" });
    expect(isOverdue(overdue, "2026-09-10")).toBe(true);
    expect(isOverdue(future, "2026-09-10")).toBe(false);
    expect(isOverdue(openEnded, "2026-09-10")).toBe(false);
    const settled = { ...overdue, settled_date: "2026-09-05" };
    expect(isOverdue(settled, "2026-09-10")).toBe(false);
  });

  test("settleDebt writes a transaction with the right sign and links it", () => {
    const { db, acc } = seed();
    const owedToMe = createDebt(db, { person: "Alex", amount_minor: 5000, currency: "PLN", opened_date: "2026-08-01", account_id: acc.id, notes: "lunch" });
    const saved1 = settleDebt(db, owedToMe.id, { day: "2026-09-10", writeTransaction: true });
    expect(saved1?.settled_date).toBe("2026-09-10");
    expect(saved1?.transaction_id).toBeTruthy();
    const tx1 = getRow(db, "transactions", saved1!.transaction_id!)!;
    expect(tx1.amount_minor).toBe(5000);
    expect(tx1.payee).toBe("Alex");
    expect(tx1.notes).toBe("lunch");
    expect(tx1.source).toBe("debt");
    expect(tx1.account_id).toBe(acc.id);

    const iOwe = createDebt(db, { person: "Bo", amount_minor: 3000, currency: "PLN", opened_date: "2026-08-01", account_id: acc.id, direction: "i_owe" });
    const saved2 = settleDebt(db, iOwe.id, { day: "2026-09-10", writeTransaction: true });
    const tx2 = getRow(db, "transactions", saved2!.transaction_id!)!;
    expect(tx2.amount_minor).toBe(-3000);
  });

  test("settleDebt without writeTransaction just marks it settled; no account means no transaction either", () => {
    const { db } = seed();
    const noAccount = createDebt(db, { person: "Cy", amount_minor: 1000, currency: "PLN", opened_date: "2026-08-01" });
    const saved = settleDebt(db, noAccount.id, { day: "2026-09-10", writeTransaction: true });
    expect(saved?.settled_date).toBe("2026-09-10");
    expect(saved?.transaction_id).toBeNull();
    expect(listRows(db, "transactions")).toHaveLength(0);
  });

  test("settleDebt returns null for a missing or already-settled debt", () => {
    const { db } = seed();
    const settled = createDebt(db, { person: "Alex", amount_minor: 1000, currency: "PLN", opened_date: "2026-08-01", settled_date: "2026-09-01" });
    expect(settleDebt(db, settled.id, { day: "2026-09-10" })).toBeNull();
    expect(settleDebt(db, "missing", { day: "2026-09-10" })).toBeNull();
  });

  test("plannedDebtNotifications: a reminder the day before and a due notification, skipping settled/notify-off/out-of-horizon debts", () => {
    const { db } = seed();
    const due = createDebt(db, { person: "Alex", amount_minor: 1000, currency: "PLN", opened_date: "2026-08-01", due_date: "2026-09-15" });
    createDebt(db, { person: "Bo", amount_minor: 1000, currency: "PLN", opened_date: "2026-08-01", due_date: "2026-09-20", settled_date: "2026-09-05" });
    createDebt(db, { person: "Cy", amount_minor: 1000, currency: "PLN", opened_date: "2026-08-01", due_date: "2026-09-25", notify: 0 });
    createDebt(db, { person: "Dee", amount_minor: 1000, currency: "PLN", opened_date: "2026-08-01", due_date: "2027-01-01" }); // past a 60-day horizon
    const planned = plannedDebtNotifications(listDebts(db), "2026-09-10");
    expect(planned).toEqual([
      { debt_id: due.id, fire_day: "2026-09-14", kind: "reminder" },
      { debt_id: due.id, fire_day: "2026-09-15", kind: "due" },
    ]);
  });

  test("a debt reminds at 08:00 unless it says otherwise, and the time survives a round trip", () => {
    const { db } = seed();
    const dflt = createDebt(db, { person: "Alex", amount_minor: 1000, currency: "PLN", opened_date: "2026-09-01", due_date: "2026-09-15" });
    expect(dflt.notify_time).toBe(DEFAULT_DEBT_NOTIFY_TIME);
    expect(getRow(db, "debts", dflt.id)!.notify_time).toBe("08:00");
    const evening = createDebt(db, { person: "Bo", amount_minor: 1000, currency: "PLN", opened_date: "2026-09-01", due_date: "2026-09-15", notify_time: "19:30" });
    expect(getRow(db, "debts", evening.id)!.notify_time).toBe("19:30");
  });

  test("plannedDebtNotifications skips the reminder when the due day is tomorrow but the reminder day is already past", () => {
    const { db } = seed();
    const due = createDebt(db, { person: "Alex", amount_minor: 1000, currency: "PLN", opened_date: "2026-08-01", due_date: "2026-09-10" });
    const planned = plannedDebtNotifications(listDebts(db), "2026-09-10");
    expect(planned).toEqual([{ debt_id: due.id, fire_day: "2026-09-10", kind: "due" }]);
  });
});
