/**
 * Suggested budget limit from recent spend, offered as quick-pick chips in the budget sheet.
 */
import type { SqlDriver } from "./db";
import { addPeriod, budgetPeriod } from "./recurring";
import { categorySpend, inBudgetScope, listRows, tagSpend } from "./repo";
import { todayLocalDay, tripTagIds } from "./trips";

export interface SuggestedBudget {
  /** Mean over the last `periods` complete periods, zero months included: the headline suggestion. */
  average_minor: number;
  /** How many periods that mean covers. */
  periods: number;
  last_minor: number;
  /** Mean over the last `year_periods` (at most 12) periods of history; null when there is no more history than `periods`. */
  year_minor: number | null;
  year_periods: number;
  /** Mean over every period since the first one with any spending, and how many that was. */
  all_minor: number;
  all_periods: number;
  /** Highest and lowest single period over that same history. The lowest ignores periods with no
   * spending at all, which are not a budget anyone wants — they would only ever suggest zero. */
  max_minor: number;
  min_minor: number;
}

/** Five years. The walk also stops at the oldest transaction, so a young database does a handful of periods. */
const MAX_PERIODS = 60;

/**
 * What to budget, from what was actually spent: the mean over the last N complete periods (the
 * current, still-running one is excluded), the same over a year and over the whole history, the last
 * period, and the highest and lowest single period. For a set of categories (subcategories
 * included), one tag, or all spending — one currency, one account scope.
 *
 * History starts at the first period that had any spending, so a category taken up last spring is
 * not averaged against the years before it existed. Null when there was no spend at all.
 */
export function suggestBudget(db: SqlDriver, o: { categoryIds: string[]; tagId: string | null; currency: string; accountIds?: string[]; startDay: number; today?: string; periods?: number }): SuggestedBudget | null {
  const n = o.periods ?? 3;
  const cats = new Map(listRows(db, "categories", "1=1").map((c) => [c.id, c]));
  const inScope = (cid: string | null) => inBudgetScope(o.categoryIds, cats, cid);
  // One cheap question bounds the walk: there is nothing to average before the first transaction.
  const firstDay = db.get<{ d: string | null }>(`SELECT MIN(date) AS d FROM transactions WHERE deleted=0`)?.d?.slice(0, 10) ?? null;
  let end = budgetPeriod(o.today ?? todayLocalDay(), o.startDay).start; // start of the current (incomplete) period
  const perPeriod: number[] = [];
  // Measured the way the budget will be: without what trips paid for (`budgetRows`).
  const trips = tripTagIds(db);
  while (perPeriod.length < MAX_PERIODS) {
    const { start } = budgetPeriod(addPeriod(end, "daily", -1), o.startDay);
    const pool = o.tagId ? tagSpend(db, o.tagId, { fromIso: start, toIso: end, accountIds: o.accountIds, exceptTags: trips }) : categorySpend(db, start, end, o.accountIds, { exceptTags: trips });
    const scoped = pool.filter((s) => s.currency === o.currency && inScope(s.category_id));
    perPeriod.push(-scoped.reduce((a, s) => a + s.spent_minor, 0));
    end = start;
    if (perPeriod.length >= n && (!firstDay || start <= firstDay)) break;
  }
  if (!perPeriod.some((v) => v > 0)) return null;
  // Everything older than the first period that had any spending belongs to someone else's history.
  let oldest = 0;
  for (let i = 0; i < perPeriod.length; i++) if (perPeriod[i]! > 0) oldest = i;
  const history = perPeriod.slice(0, oldest + 1);
  const mean = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
  const year = history.length > n ? history.slice(0, 12) : null;
  return {
    average_minor: mean(perPeriod.slice(0, n)),
    periods: n,
    last_minor: perPeriod[0]!,
    year_minor: year ? mean(year) : null,
    year_periods: year ? year.length : 0,
    all_minor: mean(history),
    all_periods: history.length,
    max_minor: Math.max(...history),
    min_minor: Math.min(...history.filter((v) => v > 0)),
  };
}
