/**
 * Generic, human-friendly CSV export. One row per transaction, amounts in the
 * account currency, category split into parent/child, tags pipe-separated.
 */
import type { SqlDriver } from "../db";
import { fromMinor } from "../money";
import { listRows, tagIdsOf } from "../repo";
import { toCsv } from "./parse";

export const GENERIC_COLUMNS = [
  "id", "date", "account", "currency", "amount", "type", "parent_category", "category",
  "payee", "tags", "notes", "pending", "transfer_id", "entered_amount", "entered_currency", "exchange_rate",
] as const;

export function exportGeneric(db: SqlDriver, opts: { from?: string; to?: string } = {}): string {
  const accounts = new Map(listRows(db, "accounts", "1=1").map((a) => [a.id, a]));
  const categories = new Map(listRows(db, "categories", "1=1").map((c) => [c.id, c]));
  const tags = new Map(listRows(db, "tags", "1=1").map((t) => [t.id, t]));
  const conds = ["deleted=0"]; const params: string[] = [];
  if (opts.from) { conds.push("date>=?"); params.push(opts.from); }
  if (opts.to) { conds.push("date<?"); params.push(opts.to); }
  const txs = listRows(db, "transactions", conds.join(" AND "), params, "date, rowid");
  const rows = txs.flatMap((t) => {
    const acc = accounts.get(t.account_id);
    if (!acc) return [];
    const cat = t.category_id ? categories.get(t.category_id) : undefined;
    const parent = cat?.parent_id ? categories.get(cat.parent_id) : undefined;
    return [{
      id: t.id,
      date: t.date,
      account: acc.name,
      currency: acc.currency,
      amount: fromMinor(t.amount_minor, acc.currency),
      type: t.transfer_id ? "transfer" : t.amount_minor >= 0 ? "income" : "expense",
      parent_category: parent?.name ?? (cat && !cat.parent_id ? cat.name : ""),
      category: parent ? cat!.name : "",
      payee: t.payee ?? "",
      tags: tagIdsOf(t).map((id) => tags.get(id)?.name ?? "").filter(Boolean).join("|"),
      notes: t.notes ?? "",
      pending: t.pending ? "true" : "false",
      transfer_id: t.transfer_id ?? "",
      entered_amount: t.entered_amount_minor != null && t.entered_currency ? fromMinor(t.entered_amount_minor, t.entered_currency) : "",
      entered_currency: t.entered_currency ?? "",
      exchange_rate: t.exchange_rate ?? "",
    }];
  });
  return toCsv(rows, [...GENERIC_COLUMNS]);
}
