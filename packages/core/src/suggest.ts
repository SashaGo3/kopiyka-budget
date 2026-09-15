/**
 * Suggested budget limit from recent spend, offered as quick-pick chips in the budget sheet.
 */
import type { SqlDriver } from "./db";
import { addPeriod, budgetPeriod } from "./recurring";
import { categorySpend, inBudgetScope, listRows, tagSpend } from "./repo";
import { todayLocalDay } from "./trips";

export interface SuggestedBudget { average_minor: number; last_minor: number; max_minor: number; periods: number }

/**
 * Average, last and highest spend over the last N complete budget periods (the current,
 * still-running period is excluded), for one category (with its subcategories), one tag,
 * or all spending (both null) — one currency, one account scope. Null when there was no
 * spend at all in the window.
 */
export function suggestBudget(db: SqlDriver, o: { categoryIds: string[]; tagId: string | null; currency: string; accountIds?: string[]; startDay: number; today?: string; periods?: number }): SuggestedBudget | null {
  const n = o.periods ?? 3;
  const cats = new Map(listRows(db, "categories", "1=1").map((c) => [c.id, c]));
  const inScope = (cid: string | null) => inBudgetScope(o.categoryIds, cats, cid);
  let end = budgetPeriod(o.today ?? todayLocalDay(), o.startDay).start; // start of the current (incomplete) period
  const perPeriod: number[] = [];
  for (let i = 0; i < n; i++) {
    const { start } = budgetPeriod(addPeriod(end, "daily", -1), o.startDay);
    const pool = o.tagId ? tagSpend(db, o.tagId, { fromIso: start, toIso: end, accountIds: o.accountIds }) : categorySpend(db, start, end, o.accountIds);
    const scoped = pool.filter((s) => s.currency === o.currency && inScope(s.category_id));
    perPeriod.push(-scoped.reduce((a, s) => a + s.spent_minor, 0));
    end = start;
  }
  if (!perPeriod.some((v) => v > 0)) return null;
  return { average_minor: Math.round(perPeriod.reduce((a, b) => a + b, 0) / n), last_minor: perPeriod[0]!, max_minor: Math.max(...perPeriod), periods: n };
}
