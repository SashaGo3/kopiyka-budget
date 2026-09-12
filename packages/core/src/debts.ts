/**
 * Money lent and borrowed. A debt is deliberately NOT a transaction: lending someone cash has
 * already moved the money, and what the user wants back is a reminder, not a second entry.
 * Settling one optionally writes the transaction that records the money coming back.
 */
import type { SqlDriver } from "./db";
import type { Debt } from "./models";
import { createTransaction, getRow, listRows, save } from "./repo";
import { addPeriod } from "./recurring";

const ORDER_BY = "settled_date IS NULL DESC, due_date IS NULL, due_date, opened_date DESC";

/** Open debts first (soonest due first), then settled ones, newest first. */
export function listDebts(db: SqlDriver, opts: { settled?: boolean } = {}): Debt[] {
  const where = opts.settled === false ? "deleted=0 AND settled_date IS NULL"
    : opts.settled === true ? "deleted=0 AND settled_date IS NOT NULL"
    : "deleted=0";
  return listRows(db, "debts", where, [], ORDER_BY);
}

export interface DebtTotal { currency: string; owed_to_me_minor: number; i_owe_minor: number }

/** Open (unsettled) debts, summed per currency. */
export function debtTotals(debts: Debt[]): DebtTotal[] {
  const byCurrency = new Map<string, DebtTotal>();
  for (const d of debts) {
    if (d.settled_date) continue;
    const e = byCurrency.get(d.currency) ?? { currency: d.currency, owed_to_me_minor: 0, i_owe_minor: 0 };
    if (d.direction === "owed_to_me") e.owed_to_me_minor += d.amount_minor; else e.i_owe_minor += d.amount_minor;
    byCurrency.set(d.currency, e);
  }
  return [...byCurrency.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}

export function isOverdue(d: Debt, today: string): boolean {
  return !d.settled_date && !!d.due_date && d.due_date < today;
}

/**
 * Mark a debt paid back. When `writeTransaction` is set and the debt names an account, a
 * transaction is written there too: positive when the money is coming back (`owed_to_me`),
 * negative when it is going out (`i_owe`).
 */
export function settleDebt(db: SqlDriver, id: string, o: { day: string; dateIso?: string; writeTransaction?: boolean }): Debt | null {
  const debt = getRow(db, "debts", id);
  if (!debt || debt.deleted || debt.settled_date) return null;
  return db.transaction(() => {
    let transactionId = debt.transaction_id;
    if (o.writeTransaction && debt.account_id) {
      const tx = createTransaction(db, {
        account_id: debt.account_id,
        date: o.dateIso ?? `${o.day}T12:00:00Z`,
        amount_minor: debt.direction === "owed_to_me" ? debt.amount_minor : -debt.amount_minor,
        payee: debt.person, notes: debt.notes, source: "debt",
      });
      transactionId = tx.id;
    }
    return save(db, "debts", { ...debt, settled_date: o.day, transaction_id: transactionId });
  });
}

export interface PlannedDebtNotification { debt_id: string; fire_day: string; kind: "reminder" | "due" }

/**
 * Local notification schedule for the next `horizonDays`: a reminder the day before, and one on
 * the due day. Only the days are decided here — both fire at the debt's own `notify_time`, which
 * the scheduler reads off the row (as it does a recurring rule's `time_of_day`).
 */
export function plannedDebtNotifications(debts: Debt[], today: string, horizonDays = 60): PlannedDebtNotification[] {
  const horizon = addPeriod(today, "daily", horizonDays);
  const out: PlannedDebtNotification[] = [];
  for (const d of debts) {
    if (!d.notify || d.deleted || d.settled_date || !d.due_date) continue;
    if (d.due_date < today || d.due_date > horizon) continue;
    const reminder = addPeriod(d.due_date, "daily", -1);
    if (reminder >= today) out.push({ debt_id: d.id, fire_day: reminder, kind: "reminder" });
    out.push({ debt_id: d.id, fire_day: d.due_date, kind: "due" });
  }
  return out.sort((a, b) => a.fire_day.localeCompare(b.fire_day) || a.debt_id.localeCompare(b.debt_id));
}
