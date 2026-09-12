/** Transaction filters: everything combinable. Serialised through picker results. */
import { humanDayTime, todayLocal } from "./dates";
export type TxType = "expense" | "income" | "transfer";
export interface TxFilter {
  type: TxType | null;
  accounts: string[];
  categories: string[]; // parent or child ids; a parent includes its children
  tags: string[];
  from: string | null; // YYYY-MM-DD inclusive
  to: string | null;   // YYYY-MM-DD exclusive
  q: string;
  pending: boolean | null;
  /** true = only future-dated rows (planned, not yet due); null = no date restriction. */
  upcoming: boolean | null;
  /** true = only rows a recurring rule posted; false = only rows it did not; null = both. */
  recurring: boolean | null;
}

export const EMPTY_FILTER: TxFilter = { type: null, accounts: [], categories: [], tags: [], from: null, to: null, q: "", pending: null, upcoming: null, recurring: null };

/** "All time" sentinel for `from`: earlier than any real date. */
export const ALL_TIME = "0000";

/** Human label for a custom range; "" when the selected period applies. */
export function rangeLabel(from: string | null, to: string | null): string {
  const open = !from || from === ALL_TIME;
  const last = to ? humanDayTime(prevDay(to)) : null;
  if (open && !last) return from === ALL_TIME ? "All time" : "";
  if (open) return `Until ${last}`;
  if (!last) return `Since ${humanDayTime(from!)}`;
  return `${humanDayTime(from!)} → ${last}`;
}

/** The day before an exclusive `to` bound, for display. */
export function prevDay(d: string): string { const [y, m, dd] = d.split("-").map(Number) as [number, number, number]; return new Date(Date.UTC(y, m - 1, dd - 1)).toISOString().slice(0, 10); }

/** Same members, order ignored. */
function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(b);
  return a.every((x) => s.has(x));
}

/**
 * How many filters the badge should show: only the ones narrowing the screen *beyond its default
 * state*, so the badge means "you filtered this" rather than "a filter object exists".
 *
 * Two things are the default, not a choice: the accounts inherited from the Budgets scope pill
 * (`defaults.accounts`), and the period the screen is already showing — picking exactly that month
 * in the filter sheet leaves the same rows on screen, so it should not read as an active filter.
 */
export function activeCount(f: TxFilter, defaults?: { accounts?: string[]; period?: { start: string; end: string } | null }): number {
  const accounts = f.accounts.length && !sameSet(f.accounts, defaults?.accounts ?? []) ? 1 : 0;
  const p = defaults?.period;
  const rangeIsPeriod = !!p && f.from === p.start && f.to === p.end;
  const range = (f.from || f.to) && !rangeIsPeriod ? 1 : 0;
  return (f.type ? 1 : 0) + accounts + (f.categories.length ? 1 : 0) + (f.tags.length ? 1 : 0) + range + (f.pending !== null ? 1 : 0) + (f.upcoming ? 1 : 0) + (f.recurring !== null ? 1 : 0);
}

/** SQL for the transactions query in TransactionList (aliases t, a, c, p). */
export function buildWhere(f: TxFilter, period: { start: string; end: string } | null, today = todayLocal()): { where: string; params: (string | number)[] } {
  const conds: string[] = []; const params: (string | number)[] = [];
  // Upcoming looks past the selected month: only an explicit "to" bounds it.
  const from = f.from ?? period?.start ?? null, to = f.to ?? (f.upcoming ? null : period?.end ?? null);
  if (f.upcoming) { conds.push("substr(t.date,1,10)>?"); params.push(today); }
  if (from) { conds.push("t.date>=?"); params.push(from); }
  if (to) { conds.push("t.date<?"); params.push(to); }
  if (f.type === "expense") conds.push("t.transfer_id IS NULL AND t.amount_minor<0");
  if (f.type === "income") conds.push("t.transfer_id IS NULL AND t.amount_minor>0");
  if (f.type === "transfer") conds.push("t.transfer_id IS NOT NULL");
  if (f.accounts.length) { conds.push(`t.account_id IN (${f.accounts.map(() => "?").join(",")})`); params.push(...f.accounts); }
  if (f.categories.length) {
    const ph = f.categories.map(() => "?").join(",");
    if (f.categories.includes("none")) conds.push(`(t.category_id IS NULL OR t.category_id IN (${ph}) OR c.parent_id IN (${ph}))`);
    else conds.push(`(t.category_id IN (${ph}) OR c.parent_id IN (${ph}))`);
    params.push(...f.categories, ...f.categories);
  }
  for (const tag of f.tags) { conds.push("t.tag_ids LIKE ?"); params.push(`%"${tag}"%`); }
  if (f.pending !== null) conds.push(`t.pending=${f.pending ? 1 : 0}`);
  if (f.recurring !== null) conds.push(`t.recurring_id IS ${f.recurring ? "NOT NULL" : "NULL"}`);
  if (f.q.trim()) {
    const q = f.q.trim(); const like = `%${q}%`;
    const parts = ["t.notes LIKE ?", "t.payee LIKE ?", "c.name LIKE ?", "p.name LIKE ?", "a.name LIKE ?"]; const qparams: (string | number)[] = [like, like, like, like, like];
    // A typed number also matches amounts: exact match in major units, or (with no decimals typed) a prefix match on the integer part.
    const amt = /^-?\d+([.,]\d{1,2})?$/.exec(q);
    if (amt) {
      const hasDecimals = !!amt[1];
      parts.push("ABS(t.amount_minor)=?"); qparams.push(Math.round(Math.abs(parseFloat(q.replace(",", "."))) * 100));
      if (!hasDecimals) { parts.push("CAST(ABS(t.amount_minor)/100 AS TEXT) LIKE ?"); qparams.push(`${q.replace(/^-/, "")}%`); }
    }
    conds.push(`(${parts.join(" OR ")})`); params.push(...qparams);
  }
  return { where: conds.length ? conds.join(" AND ") : "1=1", params };
}
