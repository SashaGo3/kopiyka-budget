/**
 * The history behind an insight's details screen: what the thing the card is about came to, period
 * by period, and the few numbers that summarise it. Pure functions over the DB like the cards
 * themselves (insights.ts), so a details screen and its card read the same windows and agree.
 */
import type { SqlDriver } from "./db";
import type { InsightParams } from "./insights";
import { categorySpend, getRow, inBudgetScope, listRows } from "./repo";
import { addPeriod, budgetPeriod } from "./recurring";
import { tripTagIds } from "./trips";

export interface SeriesPoint {
  start: string;
  /** Exclusive. */
  end: string;
  minor: number;
  /** The period running now: drawn, but kept out of the averages it would drag down. */
  current: boolean;
}

export interface Series {
  currency: string;
  /** Oldest first, so a chart reads left to right; ends with the current period when there is one. */
  points: SeriesPoint[];
  /** Mean over the complete periods shown. */
  average_minor: number;
  /** How many complete periods that mean covers. */
  periods: number;
  /** The most recent complete period. */
  last_minor: number;
  max_minor: number;
  /** The lowest complete period that had anything in it; a period of nothing is not a "lowest" anyone wants. */
  min_minor: number;
  /** What the running period has come to so far; null when every point is complete. */
  current_minor: number | null;
}

/**
 * Summarises points into a `Series`. History before the first period with anything in it is dropped
 * — a category taken up last spring is not averaged against the years before it existed — though a
 * running period is always kept. Null when nothing happened at all.
 *
 * `skipEmpty` leaves every period of nothing out of the numbers (they are still drawn): income is
 * the case, where a month with none logged is a month nobody wrote the salary down, not one without it.
 */
export function toSeries(currency: string, points: SeriesPoint[], o: { skipEmpty?: boolean } = {}): Series | null {
  const first = points.findIndex((p) => p.minor !== 0);
  if (first < 0) return null;
  const kept = points.slice(first);
  const done = kept.filter((p) => !p.current && (!o.skipEmpty || p.minor !== 0));
  const values = done.map((p) => p.minor);
  const nonzero = values.filter((v) => v !== 0);
  const current = kept.find((p) => p.current);
  return {
    currency, points: kept,
    average_minor: values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0,
    periods: values.length,
    last_minor: values[values.length - 1] ?? 0,
    max_minor: values.length ? Math.max(...values) : 0,
    min_minor: nonzero.length ? Math.min(...nonzero) : 0,
    current_minor: current ? current.minor : null,
  };
}

/** The `count` budget periods ending with the one containing `today`, oldest first; the last one is running. */
export function periodWindows(today: string, startDay: number, count: number): { start: string; end: string; current: boolean }[] {
  const out: { start: string; end: string; current: boolean }[] = [];
  let { start, end } = budgetPeriod(today, startDay);
  for (let i = 0; i < count; i++) {
    out.unshift({ start, end, current: i === 0 });
    end = start;
    start = budgetPeriod(addPeriod(start, "daily", -1), startDay).start;
  }
  return out;
}

/**
 * The windows "Regular spending" averages over, newest first, exactly as its card counts them: for a
 * weekly card, rolling seven-day windows ending with today; for a monthly one, calendar months ending
 * with this one. The details screen draws the same windows, so its average is the card's number.
 */
export function regularWindows(p: InsightParams, today: string): { start: string; end: string }[] {
  const freq = p.frequency ?? "monthly";
  // The window is chosen in months, the way a budget's averages are; weeks are counted inside it.
  const months = p.window_months && p.window_months > 0 ? p.window_months : null;
  const n = freq === "weekly" ? (months ? Math.round((months * 52) / 12) : 12) : months ?? 6;
  let end = freq === "weekly" ? addPeriod(today, "daily", 1) : budgetPeriod(today, 1).end;
  const out: { start: string; end: string }[] = [];
  for (let i = 0; i < n; i++) {
    const start = freq === "weekly" ? addPeriod(end, "daily", -7) : addPeriod(end, "monthly", -1);
    out.push({ start, end });
    end = start;
  }
  return out;
}

/**
 * Regular spending's history, per currency: what the card's categories (folders with what is inside
 * them) came to in each of its windows. Every window is counted, the running month too, because that
 * is what the card's average is taken over; on a weekly card each one is a whole seven days anyway.
 */
export function regularSeries(db: SqlDriver, p: InsightParams, o: { today: string; accountIds?: string[] }): Series[] {
  const ids = p.category_ids ?? [];
  if (!ids.length) return [];
  const cats = new Map(listRows(db, "categories", "1=1").map((c) => [c.id, c]));
  const scope = new Set(ids);
  const inScope = (cid: string | null) => !!cid && (scope.has(cid) || scope.has(cats.get(cid)?.parent_id ?? ""));
  const windows = regularWindows(p, o.today).reverse();
  const per = new Map<string, number[]>();
  windows.forEach((w, i) => {
    for (const s of categorySpend(db, w.start, w.end, o.accountIds)) {
      if (!inScope(s.category_id)) continue;
      const arr = per.get(s.currency) ?? new Array<number>(windows.length).fill(0);
      arr[i]! += -s.spent_minor; per.set(s.currency, arr);
    }
  });
  // A monthly card's newest window is the month still running; a weekly card's is a whole seven days.
  const running = (p.frequency ?? "monthly") === "monthly";
  return [...per].flatMap(([currency, arr]) => {
    const points = windows.map((w, i) => ({ start: w.start, end: w.end, minor: arr[i]!, current: running && i === windows.length - 1 }));
    const values = points.map((x) => x.minor), nonzero = values.filter((v) => v > 0);
    const done = running ? values.slice(0, -1) : values;
    // Not `toSeries`: the card averages over every window — the running month and the empty ones
    // before the first payment included — and the details screen has to say the same number.
    return [{ currency, points, average_minor: Math.round(values.reduce((a, b) => a + b, 0) / values.length), periods: values.length,
      last_minor: done[done.length - 1] ?? 0, max_minor: Math.max(...values), min_minor: nonzero.length ? Math.min(...nonzero) : 0,
      current_minor: running ? values[values.length - 1]! : null }];
  });
}

/**
 * Spending per budget period, per currency: for a set of categories (folders with their categories;
 * empty is all spending), measured the way the budgets are — without what a trip paid for.
 */
export function spendSeries(db: SqlDriver, o: { categoryIds: string[]; accountIds?: string[]; startDay: number; today: string; count?: number }): Series[] {
  const cats = new Map(listRows(db, "categories", "1=1").map((c) => [c.id, c]));
  const trips = tripTagIds(db);
  const windows = periodWindows(o.today, o.startDay, o.count ?? 12);
  const per = new Map<string, number[]>();
  windows.forEach((w, i) => {
    for (const s of categorySpend(db, w.start, w.end, o.accountIds, { exceptTags: trips })) {
      if (!inBudgetScope(o.categoryIds, cats, s.category_id)) continue;
      const arr = per.get(s.currency) ?? new Array<number>(windows.length).fill(0);
      arr[i]! += -s.spent_minor; per.set(s.currency, arr);
    }
  });
  return [...per].flatMap(([currency, arr]) => toSeries(currency, windows.map((w, i) => ({ ...w, minor: arr[i]! }))) ?? []);
}

export interface IncomeSource { category_id: string | null; payee: string | null; currency: string; minor: number; n: number }

/**
 * What came in per budget period, per currency: income that is earned rather than moved — no
 * transfers between your own accounts, and nothing a debt brought back (a friend repaying a loan is
 * not salary). The period starts on salary day, so one salary is one period's income. Periods with
 * nothing logged are drawn but not counted (`skipEmpty`).
 */
export function incomeSeries(db: SqlDriver, o: { accountIds?: string[]; startDay: number; today: string; count?: number }): Series[] {
  const windows = periodWindows(o.today, o.startDay, o.count ?? 12);
  const scope = o.accountIds?.length ? ` AND t.account_id IN (${o.accountIds.map(() => "?").join(",")})` : "";
  const per = new Map<string, number[]>();
  windows.forEach((w, i) => {
    const rows = db.all<{ currency: string; minor: number }>(
      `SELECT a.currency AS currency, SUM(t.amount_minor) AS minor FROM transactions t JOIN accounts a ON a.id=t.account_id
       WHERE t.deleted=0 AND t.transfer_id IS NULL AND t.debt_id IS NULL AND t.amount_minor>0 AND t.date>=? AND t.date<?${scope}
       GROUP BY a.currency`, [w.start, w.end, ...(o.accountIds?.length ? o.accountIds : [])]);
    for (const r of rows) {
      const arr = per.get(r.currency) ?? new Array<number>(windows.length).fill(0);
      arr[i]! += r.minor; per.set(r.currency, arr);
    }
  });
  // The currency paid in most often first — the salary's — rather than by the size of a number that
  // means something else in every currency.
  return [...per].flatMap(([currency, arr]) => toSeries(currency, windows.map((w, i) => ({ ...w, minor: arr[i]! })), { skipEmpty: true }) ?? [])
    .sort((a, b) => b.periods - a.periods || b.average_minor - a.average_minor);
}

/** Where a period's income came from: grouped by category and payee, biggest first. */
export function incomeSources(db: SqlDriver, o: { start: string; end: string; accountIds?: string[] }): IncomeSource[] {
  const scope = o.accountIds?.length ? ` AND t.account_id IN (${o.accountIds.map(() => "?").join(",")})` : "";
  return db.all<{ category_id: string | null; payee: string | null; currency: string; minor: number; n: number }>(
    `SELECT t.category_id AS category_id, t.payee AS payee, a.currency AS currency, SUM(t.amount_minor) AS minor, COUNT(*) AS n
     FROM transactions t JOIN accounts a ON a.id=t.account_id
     WHERE t.deleted=0 AND t.transfer_id IS NULL AND t.debt_id IS NULL AND t.amount_minor>0 AND t.date>=? AND t.date<?${scope}
     GROUP BY t.category_id, t.payee, a.currency ORDER BY minor DESC`, [o.start, o.end, ...(o.accountIds?.length ? o.accountIds : [])]);
}

export interface AccountPeriod { start: string; end: string; current: boolean; in_minor: number; out_minor: number; net_minor: number; balance_minor: number }

/**
 * One account period by period: what came in and went out (transfers included — they move real
 * money in and out of it) and the balance it ended on, oldest first. Pending rows count, as they do
 * in the savings goal: they are money already spoken for.
 */
export function accountHistory(db: SqlDriver, accountId: string, o: { startDay: number; today: string; count?: number }): { currency: string; periods: AccountPeriod[] } | null {
  const a = getRow(db, "accounts", accountId);
  if (!a) return null;
  const windows = periodWindows(o.today, o.startDay, o.count ?? 12);
  const first = db.get<{ d: string | null }>(`SELECT MIN(date) AS d FROM transactions WHERE deleted=0 AND account_id=?`, [accountId])?.d ?? null;
  const periods = windows.filter((w) => !first || w.end > first).map((w) => {
    const r = db.get<{ inn: number | null; out: number | null; bal: number | null }>(
      `SELECT SUM(CASE WHEN date>=? AND amount_minor>0 THEN amount_minor ELSE 0 END) AS inn,
              SUM(CASE WHEN date>=? AND amount_minor<0 THEN amount_minor ELSE 0 END) AS out,
              SUM(amount_minor) AS bal
       FROM transactions WHERE deleted=0 AND account_id=? AND date<?`, [w.start, w.start, accountId, w.end]);
    const inn = r?.inn ?? 0, out = -(r?.out ?? 0);
    return { ...w, in_minor: inn, out_minor: out, net_minor: inn - out, balance_minor: r?.bal ?? 0 };
  });
  return { currency: a.currency, periods };
}
