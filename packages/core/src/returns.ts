/**
 * Money that came back.
 *
 * You pay for the whole table and two people hand you their share afterwards. That is not income,
 * and it is not a second expense: the dinner simply cost you less than what left the account at the
 * till. So a return is booked *on the original row* — the amount shrinks towards zero and the row
 * remembers what was paid before, instead of a matching income row turning up in every total,
 * category breakdown and budget as if you had earned something.
 *
 * `refunded_minor` is the running signed total of everything that came back, always opposite in
 * sign to the amount, so:
 *
 *   paid   = amount_minor - refunded_minor     (what left the account)
 *   amount = paid + refunded_minor             (what it ended up costing)
 *
 * A 90.00 dinner with 30.00 returned is `amount_minor = -6000, refunded_minor = 3000`, and a second
 * friend paying 30.00 makes it `-3000 / 6000`. Nothing here writes a row of its own, so the id of
 * the dinner — and every budget, tag and photo hanging off it — stays exactly where it was (DATA.md
 * rule 1).
 */
import type { SqlDriver } from "./db";
import { getRow, save } from "./repo";
import type { Transaction } from "./models";

/** What left the account before anything came back. Equals `amount_minor` when nothing did. */
export function paidAmountMinor(t: Pick<Transaction, "amount_minor" | "refunded_minor">): number {
  return t.amount_minor - (t.refunded_minor || 0);
}

/** True when at least part of this row has come back. */
export function hasReturns(t: Pick<Transaction, "refunded_minor">): boolean {
  return !!t.refunded_minor;
}

export type ReturnCheck =
  | { ok: true; amount_minor: number; refunded_minor: number; paid_minor: number }
  | { ok: false; reason: "not-found" | "transfer" | "zero" | "wrong-direction" | "too-much" };

/**
 * What booking `deltaMinor` against `id` would do, without doing it. `deltaMinor` is signed in the
 * account currency: money coming back on an expense is positive, money handed back on an income
 * negative. The UI uses this both to refuse the impossible and to show "90.00 → 60.00" before the
 * user commits.
 */
export function checkReturn(db: SqlDriver, id: string, deltaMinor: number): ReturnCheck {
  const t = getRow(db, "transactions", id);
  if (!t || t.deleted) return { ok: false, reason: "not-found" };
  // A transfer moves money between two of your own accounts; there is no counterparty to return
  // anything, and only one of its two legs would be touched here.
  if (t.transfer_id) return { ok: false, reason: "transfer" };
  if (!deltaMinor) return { ok: false, reason: "zero" };
  // A return moves the amount towards zero. Anything else is a new expense, not money coming back.
  if (Math.sign(deltaMinor) === Math.sign(t.amount_minor)) return { ok: false, reason: "wrong-direction" };
  // Getting back more than is left would flip an expense into income, which no longer describes
  // what happened. Returning exactly the rest is fine: it lands on 0.
  if (Math.abs(deltaMinor) > Math.abs(t.amount_minor)) return { ok: false, reason: "too-much" };
  const amount_minor = t.amount_minor + deltaMinor;
  const refunded_minor = (t.refunded_minor || 0) + deltaMinor;
  return { ok: true, amount_minor, refunded_minor, paid_minor: t.amount_minor - (t.refunded_minor || 0) };
}

/**
 * Book `deltaMinor` as money returned on transaction `id` and return the updated row.
 * Throws when `checkReturn` says it cannot be done, so a caller that skipped the check still
 * cannot write a row that means nothing.
 */
export function applyReturn(db: SqlDriver, id: string, deltaMinor: number): Transaction {
  const c = checkReturn(db, id, deltaMinor);
  if (!c.ok) throw new Error(`cannot book a return on ${id}: ${c.reason}`);
  const t = getRow(db, "transactions", id)!;
  // A row that came in pending has been reviewed the moment its amount is corrected by hand.
  return save(db, "transactions", { ...t, amount_minor: c.amount_minor, refunded_minor: c.refunded_minor });
}

/**
 * Forget every return booked on the row and put the amount back to what was paid. The way out of a
 * mistyped return, since the returns themselves are a single total rather than a list.
 */
export function clearReturns(db: SqlDriver, id: string): Transaction | null {
  const t = getRow(db, "transactions", id);
  if (!t || t.deleted || !t.refunded_minor) return null;
  return save(db, "transactions", { ...t, amount_minor: paidAmountMinor(t), refunded_minor: 0 });
}
