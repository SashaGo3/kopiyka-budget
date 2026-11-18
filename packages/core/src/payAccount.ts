import type { SqlDriver } from "./db";

/**
 * The account a payment in `currency` is most likely made from — a receipt photographed abroad, say.
 * Nothing is stored for it (DATA.md rule 9's arrangement): it is read off the expenses each time, so
 * paying once from another account is what teaches it, and there is nothing to back up or keep in step.
 *
 * 1. The account of the newest expense in that currency: one on an account held in it, or one
 *    converted from it (`entered_currency`). A transfer, a friend's share or a deleted row says
 *    nothing about how you pay.
 * 2. Failing that, an account held in that currency (the first in your order).
 * 3. Failing that, `fallback` — the account the sheet was opened on.
 *
 * Archived accounts are never offered.
 */
export function payAccountFor(db: SqlDriver, currency: string, fallback: string | null): string | null {
  const live = "a.deleted=0 AND a.archived=0";
  const last = db.get<{ id: string }>(
    `SELECT a.id FROM transactions t JOIN accounts a ON a.id = t.account_id
     WHERE t.deleted=0 AND t.amount_minor < 0 AND t.transfer_id IS NULL AND t.person_id IS NULL AND ${live}
       AND (a.currency = ? OR t.entered_currency = ?)
     ORDER BY t.date DESC, t.rowid DESC LIMIT 1`, [currency, currency]);
  if (last) return last.id;
  const held = db.get<{ id: string }>(`SELECT a.id FROM accounts a WHERE ${live} AND a.currency = ? ORDER BY a.sort, a.rowid LIMIT 1`, [currency]);
  return held?.id ?? fallback;
}
