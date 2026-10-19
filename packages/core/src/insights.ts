/**
 * Insights: small user-configured statistics. Pure functions over the DB so the
 * phone, widgets and tests share one implementation. Amounts are minor units.
 */
import type { SqlDriver } from "./db";
import type { Budget, Category, Frequency, Importance, InsightKind, RecurringRule, Transaction } from "./models";
import { normTitle } from "./detect";
import { accountBalanceMinor, budgetCategoryIds, categorySpend, getRow, inBudgetScope, jsonIds, listRows, recurringSpend, tagIdsOf, tagSpend } from "./repo";
import { addPeriod, budgetPeriod, dueOccurrences, occurrencesBetween } from "./recurring";
import { categoryImportance } from "./importance";
import { commitments } from "./commitments";
import { tripTagIds } from "./trips";
import { latestCachedRate } from "./rates";
import { convertMinor } from "./money";
import { shownPaymentIcon } from "./logos";
import { periodWindows, regularSeries, toSeries, type Series } from "./insightHistory";

export interface UpcomingTemplate { category_id: string | null; tag_ids: string[]; notes: string | null; amount_minor: number; account_id: string }

export interface InsightParams {
  title?: string;
  account_id?: string;
  /**
   * Safety buffer: the accounts whose money counts towards it (savings, the current account, cash
   * in another currency). A card saved before there could be several carries `account_id` instead.
   */
  account_ids?: string[];
  target_minor?: number;
  monthly_minor?: number;
  /**
   * Safety buffer: how many months the money is meant to cover — a goal, and an optional one. 0 is
   * "no goal" (the card just says how long the money lasts); absent is 3, what a card saved before
   * the goal could be left out always meant.
   */
  months?: number;
  /**
   * Safety buffer: a cushion for the unexpected, as a percentage on top of what a month costs (10 =
   * a month is reckoned 10% dearer than it was). Absent or 0 is none.
   */
  extra_pct?: number;
  /**
   * Regular spending: how many months of history the average is taken over (3, 6 or 12). Absent is
   * the window a card saved before it could be chosen always used: six months, or twelve weeks.
   */
  window_months?: number;
  category_ids?: string[];
  /** Rules left out of the subscriptions card. */
  exclude_rule_ids?: string[];
  templates?: UpcomingTemplate[];
  frequency?: Extract<Frequency, "weekly" | "monthly">;
  /**
   * Checklist: a chosen category (or folder) that is waited for once per tag rather than once — one
   * Insurance category paid for several people, each person a tag. Keyed by the chosen id.
   */
  category_tags?: Record<string, string[]>;
  /** Checklist: also wait for every recurring expense that falls due in the period, but those in `exclude_rule_ids`. */
  include_recurring?: boolean;
  /** Checklist, no longer read: the card now always lists only what is still to pay. Kept so older params still parse. */
  hide_done?: boolean;
  /** Checklist, no longer read: the card's sum is always what is still to pay; the details screen has the rest. */
  sum?: "left" | "total";
  /**
   * Checklist: lines marked done by hand with no payment behind them — paid in cash and not worth
   * logging, settled by someone else, not needed this time. Only for the period that starts on
   * `period`; a new period starts with nothing ticked, so the list never has to be cleaned up.
   */
  ticked?: { period: string; keys: string[] };
}

/**
 * `instant` kinds have nothing to configure but their title, so picking one is the whole setup.
 *
 * Not every `InsightKind` is offered any more: "Recurring this period" and "Upcoming payments" were
 * dropped in 1.1.0, and "Safe to spend" folded into the budgets card (`free_money`, which now says
 * what is still to be charged too). Cards of those kinds saved earlier stay in the database; the app
 * decides what to draw for them (`retiredKind`).
 */
export type OfferedInsightKind = Exclude<InsightKind, "recurring_spend" | "upcoming" | "safe_to_spend">;
export const INSIGHT_KINDS: { kind: OfferedInsightKind; title: string; hint: string; instant?: boolean }[] = [
  { instant: true, kind: "free_money", title: "Left in budgets", hint: "What is left of your budgets this period, and what is still to be charged" },
  { instant: true, kind: "days_to_salary", title: "Until salary", hint: "Days left in the period and what you can spend per day" },
  { kind: "savings_goal", title: "Savings goal", hint: "Progress of an account towards a target" },
  { kind: "account_balance", title: "Account balance", hint: "What is left on one account, and what moved this period" },
  { kind: "checklist", title: "Payments checklist", hint: "Which of these categories still have no transaction this period" },
  { kind: "subscriptions", title: "Subscriptions per year", hint: "What your recurring expenses cost yearly" },
  { kind: "regular", title: "Regular spending", hint: "Weekly or monthly average for a category" },
  { instant: true, kind: "values", title: "What it went on", hint: "This period split by how much each category matters to you" },
  { kind: "safety_buffer", title: "Safety buffer", hint: "How many months you could live on your money" },
];

/**
 * What a card of a kind no longer offered is shown as: a "Safe to spend" card is the budgets card it
 * was folded into, and the two dropped kinds are not shown at all (null). Any other kind is itself.
 */
export function retiredKind(kind: InsightKind): InsightKind | null {
  if (kind === "safe_to_spend") return "free_money";
  if (kind === "recurring_spend" || kind === "upcoming") return null;
  return kind;
}

/**
 * How many periods of history a card looks back over when it wants "your own normal". Six months is
 * long enough that one holiday does not become the baseline and short enough to still be about how
 * you live now.
 */
export const HISTORY_PERIODS = 6;

/** The consecutive budget periods ending with the one containing `today`, oldest first. */
export function recentPeriods(today: string, startDay: number, count = HISTORY_PERIODS): { start: string; end: string }[] {
  const out: { start: string; end: string }[] = [];
  let { start, end } = budgetPeriod(today, startDay);
  for (let i = 0; i < count; i++) {
    out.unshift({ start, end });
    end = start;
    start = addPeriod(start, "monthly", -1);
  }
  return out;
}

export interface RecurringSpendLine { rule: RecurringRule; title: string; currency: string; spent_minor: number; n: number }
export interface RecurringSpendResult { lines: RecurringSpendLine[]; totals: { currency: string; minor: number }[]; posted: number; due: number }

/**
 * What the recurring rules have actually cost so far in a period — posted rows only, so it is
 * money that moved rather than money that is scheduled (which is what `subscriptionsPerYear`
 * answers). `due` counts manual rules still waiting, the gap between the two figures.
 */
export function recurringSpendInsight(db: SqlDriver, o: { start: string; end: string; accountIds?: string[]; today: string }): RecurringSpendResult {
  const rules = new Map((listRows(db, "recurring_rules", "1=1") as RecurringRule[]).map((r) => [r.id, r]));
  const cats = new Map(listRows(db, "categories", "1=1").map((c) => [c.id, c.name]));
  const lines: RecurringSpendLine[] = [];
  const totals = new Map<string, number>();
  for (const row of recurringSpend(db, o.start, o.end, o.accountIds)) {
    const rule = rules.get(row.recurring_id);
    if (!rule) continue;
    const title = rule.payee || (rule.category_id ? cats.get(rule.category_id) : null) || "Recurring";
    lines.push({ rule, title, currency: row.currency, spent_minor: row.spent_minor, n: row.n });
    totals.set(row.currency, (totals.get(row.currency) ?? 0) + row.spent_minor);
  }
  lines.sort((a, b) => a.spent_minor - b.spent_minor); // most spent first (amounts are negative)
  const due = (listRows(db, "recurring_rules", "deleted=0 AND active=1 AND auto_post=0") as RecurringRule[])
    .filter((r) => dueOccurrences(r, o.today).length).length;
  return { lines, totals: [...totals].map(([currency, minor]) => ({ currency, minor })), posted: lines.reduce((a, l) => a + l.n, 0), due };
}

export function parseInsightParams(raw: string): InsightParams {
  try { const v = JSON.parse(raw); return v && typeof v === "object" ? (v as InsightParams) : {}; } catch { return {}; }
}

/**
 * Monthly budgets are a standing configuration, not per month: the newest row per category (or tag) + currency,
 * in the given account scope (null = shared budgets). One-off budgets (trips) are left out; see trips.ts.
 */
export function activeBudgets(db: SqlDriver, _end: string, budgetAccount: string | null): Budget[] {
  const rows = listRows(db, "budgets", "deleted=0 AND period='monthly'", [], "starts DESC, rowid DESC");
  const seen = new Set<string>();
  const out: Budget[] = [];
  for (const b of rows) {
    if ((b.account_id ?? null) !== budgetAccount) continue;
    const key = `${b.tag_id ? `tag:${b.tag_id}` : budgetCategoryIds(b).join("+") || "all"}|${b.currency}`;
    if (seen.has(key)) continue; seen.add(key); out.push(b);
  }
  // Then in the order you put them in. A stable sort with every `sort` still 0 changes nothing, so a
  // database that has never been reordered keeps the order it always had.
  return out.sort((a, z) => (a.sort ?? 0) - (z.sort ?? 0));
}

export interface BudgetRow { budget: Budget; spent_minor: number; children: { category_id: string | null; spent_minor: number }[] }

/**
 * Spend against each active budget; a category budget includes its subcategories, a tag budget every
 * expense carrying the tag. What a trip paid for (`tripTagIds`) counts against the trip and not here,
 * so travelling does not eat the month's budgets — a budget on the trip's own tag still sees it.
 */
export function budgetRows(db: SqlDriver, o: { start: string; end: string; accountIds?: string[]; budgetAccount: string | null }): BudgetRow[] {
  const cats = new Map(listRows(db, "categories", "1=1").map((c) => [c.id, c]));
  const trips = tripTagIds(db);
  const spend = categorySpend(db, o.start, o.end, o.accountIds, { exceptTags: trips });
  return activeBudgets(db, o.end, o.budgetAccount).map((b) => budgetRowIn(db, b, o, cats, trips, spend));
}

/** One budget against one period, counted as `budgetRows` counts it, whether or not it is one of the active ones there. */
export function budgetRow(db: SqlDriver, b: Budget, o: { start: string; end: string; accountIds?: string[] }): BudgetRow {
  const trips = tripTagIds(db);
  return budgetRowIn(db, b, o, new Map(listRows(db, "categories", "1=1").map((c) => [c.id, c])), trips, b.tag_id ? [] : categorySpend(db, o.start, o.end, o.accountIds, { exceptTags: trips }));
}

/** One budget's row for one window; `spend` is that window's `categorySpend`, shared between budgets when there are several. */
function budgetRowIn(db: SqlDriver, b: Budget, o: { start: string; end: string; accountIds?: string[] }, cats: Map<string, Category>, trips: string[], spend: ReturnType<typeof categorySpend>): BudgetRow {
  const ids = budgetCategoryIds(b);
  const pool = b.tag_id ? tagSpend(db, b.tag_id, { fromIso: o.start, toIso: o.end, accountIds: o.accountIds, exceptTags: trips }) : spend;
  const scoped = pool.filter((s) => s.currency === b.currency && inBudgetScope(ids, cats, s.category_id));
  return { budget: b, spent_minor: -scoped.reduce((a, s) => a + s.spent_minor, 0), children: scoped.map((s) => ({ category_id: s.category_id, spent_minor: -s.spent_minor })) };
}

/**
 * One budget, period by period: what it counted in each of the `count` periods ending with the one
 * containing `today`, the same way its bar does (`budgetRows`) — so the budget's details screen and
 * the bar on the Budgets screen never disagree about a month. Null when nothing was ever spent in it.
 */
export function budgetSeries(db: SqlDriver, b: Budget, o: { accountIds?: string[]; startDay: number; today: string; count?: number }): Series | null {
  const cats = new Map(listRows(db, "categories", "1=1").map((c) => [c.id, c]));
  const trips = tripTagIds(db);
  const windows = periodWindows(o.today, o.startDay, o.count ?? 12);
  return toSeries(b.currency, windows.map((w) => ({ ...w, minor: budgetRowIn(db, b, { ...w, accountIds: o.accountIds }, cats, trips, b.tag_id ? [] : categorySpend(db, w.start, w.end, o.accountIds, { exceptTags: trips })).spent_minor })));
}

export interface MoneyByCurrency { currency: string; minor: number }

/**
 * Sum of (limit − spent) over active budgets, per currency. Overall budgets count once; category
 * budgets are added only when there is no overall budget in that currency. A budget marked out of
 * the totals (`in_planned = 0`) is left out here as well — it is a yardstick, not money set aside —
 * and it does not suppress the category budgets of its currency either, because it is not counted
 * as the overall one.
 */
export function freeMoney(db: SqlDriver, o: { start: string; end: string; accountIds?: string[]; budgetAccount: string | null }): MoneyByCurrency[] {
  const rows = budgetRows(db, o).filter((r) => r.budget.in_planned !== 0);
  const out = new Map<string, number>();
  const overall = new Set(rows.filter((r) => !budgetCategoryIds(r.budget).length).map((r) => r.budget.currency));
  for (const r of rows) {
    if (budgetCategoryIds(r.budget).length && overall.has(r.budget.currency)) continue;
    out.set(r.budget.currency, (out.get(r.budget.currency) ?? 0) + r.budget.amount_minor - r.spent_minor);
  }
  return [...out].map(([currency, minor]) => ({ currency, minor }));
}

export function daysUntil(today: string, day: string): number {
  return Math.round((Date.parse(day + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 86_400_000);
}

/** Days until the next period start (salary day) and the free money spread over them. */
export function daysToSalary(db: SqlDriver, o: { today: string; startDay: number; accountIds?: string[]; budgetAccount: string | null }): { days: number; next: string; per_day: MoneyByCurrency[] } {
  const { start, end } = budgetPeriod(o.today, o.startDay);
  const days = Math.max(1, daysUntil(o.today, end));
  const free = freeMoney(db, { start, end, accountIds: o.accountIds, budgetAccount: o.budgetAccount });
  return { days, next: end, per_day: free.map((f) => ({ currency: f.currency, minor: Math.round(f.minor / days) })) };
}

export interface AccountLeftover {
  name: string; currency: string;
  /** Confirmed money, the figure the Accounts screen shows. */
  balance_minor: number;
  /** The same with the pending queue counted in; equal to `balance_minor` when nothing is waiting. */
  with_pending_minor: number;
  /** What came in and what went out of this account during the period (transfers included: they move real money). */
  in_minor: number;
  out_minor: number;
}

/**
 * What is left on one account right now — the "leftovers" card. The balance is the confirmed one,
 * with the pending queue reported beside it rather than mixed in, because a pending row is a
 * charge nobody has checked yet; `in`/`out` say what the period did to it.
 */
export function accountLeftover(db: SqlDriver, p: InsightParams, o: { start: string; end: string }): AccountLeftover | null {
  const a = p.account_id ? getRow(db, "accounts", p.account_id) : undefined;
  if (!a) return null;
  const moved = db.get<{ inn: number | null; out: number | null }>(
    `SELECT SUM(CASE WHEN amount_minor>0 THEN amount_minor ELSE 0 END) AS inn,
            SUM(CASE WHEN amount_minor<0 THEN amount_minor ELSE 0 END) AS out
     FROM transactions WHERE deleted=0 AND account_id=? AND date>=? AND date<?`, [a.id, o.start, o.end]);
  return {
    name: a.name, currency: a.currency,
    balance_minor: accountBalanceMinor(db, a.id),
    with_pending_minor: accountBalanceMinor(db, a.id, { includePending: true }),
    in_minor: moved?.inn ?? 0, out_minor: -(moved?.out ?? 0),
  };
}

export function savingsGoal(db: SqlDriver, p: InsightParams): { balance: number; target: number; currency: string; ratio: number } | null {
  const a = p.account_id ? getRow(db, "accounts", p.account_id) : undefined;
  if (!a) return null;
  const balance = accountBalanceMinor(db, a.id, { includePending: true });
  const target = p.target_minor ?? 0;
  return { balance, target, currency: a.currency, ratio: target > 0 ? Math.max(0, Math.min(1, balance / target)) : 0 };
}


/* ── What it went on: the split by importance ─────────────────────────────────────────────── */

export interface ValuePeriod {
  start: string;
  /** Spend in the period per level, positive minor units. Index 0 is everything not marked. */
  by_level: Record<Importance, number>;
  total_minor: number;
  /** Level 3 as a share of the total, 0..1; null when nothing was spent. */
  essential_share: number | null;
}

export interface ValueSplit {
  currency: string;
  /** Newest last, so the trend reads left to right. The last entry is the period being shown. */
  periods: ValuePeriod[];
  now: ValuePeriod;
  /** How much of this period's spend is in categories nobody has marked yet. */
  unmarked_minor: number;
  /**
   * What each level is made of this period: the categories, biggest first (positive minor units).
   * `null` is spend with no category, which counts as unmarked. A split you cannot trace back to
   * categories is a number to take on trust; this is what lets you check the marks behind it.
   */
  categories: Record<Importance, { category_id: string | null; minor: number }[]>;
}

/**
 * Every other screen is organised by category, which is the right axis for "what did I buy" and the
 * wrong one for "how am I living". This is the other axis: the period's spend split by how much
 * each category matters (`categoryImportance`, so a folder answers for what is inside it).
 *
 * The number to watch is not the total — it is whether the essential share is drifting up, because
 * that is what decides how much freedom there is to have. So the history comes with it rather than
 * being a separate card you have to go and compare against.
 *
 * Spend in a category nobody has marked is reported separately rather than guessed at. Folding it
 * into "in between" would make the split look complete when it is not, and the whole card is only
 * as true as the marks behind it.
 */
export function valueSplit(db: SqlDriver, o: { today: string; startDay: number; accountIds?: string[]; periods?: number }): ValueSplit[] {
  const cats = listRows(db, "categories", "1=1") as Category[];
  const level = categoryImportance(cats);
  const windows = recentPeriods(o.today, o.startDay, o.periods ?? HISTORY_PERIODS);
  const byCurrency = new Map<string, ValuePeriod[]>();
  const nowCats = new Map<string, Record<Importance, { category_id: string | null; minor: number }[]>>();
  const last = windows[windows.length - 1];
  for (const w of windows) {
    const here = new Map<string, Record<Importance, number>>();
    for (const s of categorySpend(db, w.start, w.end, o.accountIds)) {
      // Uncategorised spend is unmarked spend: nobody said what it was, let alone whether it mattered.
      const at = (s.category_id ? level.get(s.category_id) : 0) ?? 0;
      const row = here.get(s.currency) ?? { 0: 0, 1: 0, 2: 0, 3: 0 };
      row[at] += -s.spent_minor;
      here.set(s.currency, row);
      if (w === last) {
        const lists = nowCats.get(s.currency) ?? { 0: [], 1: [], 2: [], 3: [] };
        lists[at].push({ category_id: s.category_id, minor: -s.spent_minor });
        nowCats.set(s.currency, lists);
      }
    }
    for (const c of new Set([...here.keys(), ...byCurrency.keys()])) {
      const by_level = here.get(c) ?? { 0: 0, 1: 0, 2: 0, 3: 0 };
      const total_minor = by_level[0] + by_level[1] + by_level[2] + by_level[3];
      const list = byCurrency.get(c) ?? [];
      // A currency first seen in a later period gets empty periods before it, so every series is
      // the same length and the trend is read against the same months.
      while (list.length < windows.indexOf(w)) list.push({ start: windows[list.length]!.start, by_level: { 0: 0, 1: 0, 2: 0, 3: 0 }, total_minor: 0, essential_share: null });
      list.push({ start: w.start, by_level, total_minor, essential_share: total_minor > 0 ? by_level[3] / total_minor : null });
      byCurrency.set(c, list);
    }
  }
  return [...byCurrency]
    .map(([currency, periods]) => {
      const lists = nowCats.get(currency) ?? { 0: [], 1: [], 2: [], 3: [] };
      for (const lv of [0, 1, 2, 3] as const) lists[lv].sort((a, b) => b.minor - a.minor);
      return { currency, periods, now: periods[periods.length - 1]!, unmarked_minor: periods[periods.length - 1]!.by_level[0], categories: lists };
    })
    .filter((v) => v.periods.some((p) => p.total_minor > 0))
    .sort((a, b) => b.now.total_minor - a.now.total_minor);
}

/* ── Safety buffer ────────────────────────────────────────────────────────────────────────── */

export interface SafetyBuffer {
  /** The first chosen account's currency; everything else is converted into it at the latest rate. */
  currency: string;
  /** What a month of the chosen comfort level actually costs, averaged over `periods`, with the cushion (`extra_pct`) on top. */
  essential_minor: number;
  /** The same without the cushion: what a month actually cost. */
  base_minor: number;
  extra_pct: number;
  /** What the chosen accounts hold together, pending included. */
  have_minor: number;
  /** How many months you could live on that; null when no such spending is known yet. */
  months_covered: number | null;
  /** The goal in months; 0 when the card has none, and then there is no target and no bar. */
  months_wanted: number;
  target_minor: number;
  /** 0..1 against the target, for the bar; 0 with no goal. */
  ratio: number;
  periods: number;
  /** The accounts counted (live ones only). */
  account_ids: string[];
  /** What a month is measured by: categories chosen on the card, or the ones marked most important. */
  basis: "chosen" | "important";
  /** Currencies with no known rate to this one: their money and spending were left out, and the card says so. */
  missing: string[];
  /** True when the basis is "important" and nothing is marked high: the card should say why. */
  no_essentials: boolean;
}

/**
 * How many months you could live on what you have: the money in the accounts you count (savings,
 * the current account, a USD account — converted at the latest known rate), divided by what a month
 * of the life you want to keep actually costs.
 *
 * What a month costs is either the categories chosen on the card — the comfort level, say rent, food
 * and the kids' school but not restaurants — or, with none chosen, the ones marked most important
 * (rule 15), which is the honest minimum. Folders count with everything inside them. It is what
 * those categories cost from every account, not only the counted ones: rent paid from the current
 * account is still rent the savings would have to cover.
 *
 * The target is **computed, not typed**: it moves on its own as life gets more expensive, which a
 * figure you entered last year does not. That is the whole difference from `savings_goal`.
 *
 * Like `savings_goal` this ignores the scope pill. A buffer is a whole-life number.
 */
export function safetyBuffer(db: SqlDriver, p: InsightParams, o: { today: string; startDay: number }): SafetyBuffer | null {
  const ids = p.account_ids?.length ? p.account_ids : p.account_id ? [p.account_id] : [];
  const accs = ids.map((id) => getRow(db, "accounts", id)).filter((a): a is NonNullable<typeof a> => !!a && !a.deleted);
  if (!accs.length) return null;
  const currency = accs[0]!.currency;
  const missing = new Set<string>();
  const inBase = (minor: number, from: string): number | null => {
    if (from === currency) return minor;
    const r = latestCachedRate(db, from, currency);
    if (!r) { missing.add(from); return null; }
    return convertMinor(minor, from, currency, r.rate);
  };

  const cats = listRows(db, "categories", "1=1") as Category[];
  const chosen = (p.category_ids ?? []).filter((id) => cats.some((c) => c.id === id && !c.deleted));
  const basis = chosen.length ? "chosen" as const : "important" as const;
  let counted: (id: string) => boolean;
  if (basis === "chosen") {
    // A chosen folder stands for everything inside it, whatever is added to it later.
    const scope = new Set<string>();
    const add = (id: string) => { if (scope.has(id)) return; scope.add(id); for (const c of cats) if (c.parent_id === id) add(c.id); };
    chosen.forEach(add);
    counted = (id) => scope.has(id);
  } else {
    const level = categoryImportance(cats);
    counted = (id) => level.get(id) === 3;
  }

  const months = p.months === 0 ? 0 : Math.max(1, Math.round(p.months ?? 3));
  const extra = Math.max(0, Math.min(100, Math.round(p.extra_pct ?? 0)));
  // Complete periods only: the month in progress would drag the average down every time it is read.
  const windows = recentPeriods(o.today, o.startDay, HISTORY_PERIODS + 1).slice(0, -1);
  let essential = 0;
  for (const w of windows) {
    for (const s of categorySpend(db, w.start, w.end, undefined)) {
      if (!s.category_id || !counted(s.category_id)) continue;
      essential += inBase(-s.spent_minor, s.currency) ?? 0;
    }
  }
  const base_minor = Math.round(essential / windows.length);
  const essential_minor = Math.round((base_minor * (100 + extra)) / 100);
  let have_minor = 0;
  for (const a of accs) have_minor += inBase(accountBalanceMinor(db, a.id, { includePending: true }), a.currency) ?? 0;
  const target_minor = essential_minor * months;
  return {
    currency, essential_minor, base_minor, extra_pct: extra, have_minor, months_wanted: months, target_minor,
    months_covered: essential_minor > 0 ? Math.max(0, have_minor) / essential_minor : null,
    ratio: target_minor > 0 ? Math.max(0, Math.min(1, have_minor / target_minor)) : 0,
    periods: windows.length, account_ids: accs.map((a) => a.id), basis, missing: [...missing],
    no_essentials: basis === "important" && !cats.some((c) => !c.deleted && counted(c.id)),
  };
}

/* ── Safe to spend ────────────────────────────────────────────────────────────────────────── */

export interface SafeToSpend {
  days: number;
  next: string;
  free: MoneyByCurrency[];
  /** Still going to be charged between today and the next salary, out of what the budgets cover. */
  committed: MoneyByCurrency[];
  /** Free less committed, never below zero: what is genuinely yours to decide about. */
  safe: MoneyByCurrency[];
  per_day: MoneyByCurrency[];
  /** How far free less committed goes below zero, where it does: the budgets are already spoken for. */
  short: MoneyByCurrency[];
}

/**
 * `days_to_salary` divides budget headroom by the days left and does not know the rent is coming,
 * so it reads *safe* on the 3rd and is wrong on the 4th. This is the same card with the one thing
 * it was missing: everything still due before the next salary taken off first (`commitments`).
 *
 * The window starts **today**, not at the period start: a bill that has already been paid is not
 * still coming, and its rule has moved on past it anyway.
 *
 * Nothing is reserved and nothing is written. The value is in the number, not in moving money —
 * a real Reserve account would mean un-reserving it as each bill lands, which is a second state
 * machine that has to be right on two devices.
 */
export function safeToSpend(db: SqlDriver, o: { today: string; startDay: number; accountIds?: string[]; budgetAccount: string | null }): SafeToSpend {
  const { start, end } = budgetPeriod(o.today, o.startDay);
  const days = Math.max(1, daysUntil(o.today, end));
  const free = freeMoney(db, { start, end, accountIds: o.accountIds, budgetAccount: o.budgetAccount });
  // A bill only comes out of the money a budget set aside for it. Rent under no budget is not taken
  // off a Food budget's headroom, and a currency with bills but no budget has no headroom to take it
  // from — both used to drive the number below zero for money that was never budgeted to begin with.
  // With an overall budget in the currency everything is its business, debts included.
  const cats = new Map(listRows(db, "categories", "1=1").map((c) => [c.id, c]));
  const budgets = activeBudgets(db, end, o.budgetAccount).filter((b) => b.in_planned !== 0);
  const covers = (c: { currency: string; category_id: string | null; tag_ids: string[] }) => budgets.some((b) => b.currency === c.currency && (
    b.tag_id ? c.tag_ids.includes(b.tag_id) : !budgetCategoryIds(b).length || (c.category_id !== null && inBudgetScope(budgetCategoryIds(b), cats, c.category_id))));
  const owed = new Map<string, number>();
  for (const c of commitments(db, { start: o.today, end, accountIds: o.accountIds })) if (covers(c)) owed.set(c.currency, (owed.get(c.currency) ?? 0) + c.minor);
  const left = free.map((f) => ({ currency: f.currency, minor: f.minor - (owed.get(f.currency) ?? 0) }));
  // Never below zero: "safe to spend" has no negative answer. What is over goes in `short` instead.
  const safe = left.map((l) => ({ currency: l.currency, minor: Math.max(0, l.minor) }));
  const short = left.filter((l) => l.minor < 0).map((l) => ({ currency: l.currency, minor: -l.minor }));
  return {
    days, next: end, free, committed: [...owed].map(([currency, minor]) => ({ currency, minor })), safe, short,
    per_day: safe.map((s) => ({ currency: s.currency, minor: Math.round(s.minor / days) })),
  };
}

export interface ChecklistItem {
  /** Unique within the card: a category, a category and one of its tags, or a recurring rule. */
  key: string;
  category_id: string; name: string; done: boolean; spent_minor: number; currency: string | null;
  /** Set when this line waits for the category with this tag on it (`category_tags`). */
  tag_id: string | null;
  /** Set when this line is a recurring payment due in the period (`include_recurring`). */
  rule_id: string | null;
  /**
   * What a recurring line is drawn with, in `recurring_rules.icon`'s form (logos.ts): the one chosen,
   * else `logo:<slug>` for a mark its names match. Null on a category line, or for a rule that wears
   * its category's icon.
   */
  icon: string | null;
  /** A recurring line's next occurrence still to be paid; null once nothing more is due in the period. */
  due: string | null;
  /**
   * A recurring line's occurrences this period: how many were paid, and how many there are in all —
   * paid plus still owed. A skipped occurrence moved `next_date` past itself without a payment, so it
   * is in neither and the line asks for what is really still coming. Null on a category line.
   */
  occurrences: { paid: number; total: number } | null;
  /** Done because it was ticked by hand (`InsightParams.ticked`), not because a payment was found. */
  ticked: boolean;
  /**
   * What is still expected on this line, positive minor units in `expected_currency`: the rule's amount
   * for a recurring line still owed, the last payment for a category line not done yet. Null when done,
   * or when there is nothing to go by.
   */
  expected_minor: number | null;
  expected_currency: string | null;
  /**
   * What a category line came to over the period before this one, when it was paid more than once
   * there: groceries-style lines want the month's total, not whichever payment happened to be last.
   * In the last payment's currency; null on a recurring line, or with fewer than two payments.
   */
  previous: { total_minor: number; count: number; currency: string } | null;
  /** Most recent non-transfer transaction in this category (or its subcategories) before the period started, so the row can be prefilled. */
  last: { id: string; amount_minor: number; currency: string; date: string; tag_ids: string[]; notes: string | null; account_id: string; payee: string | null } | null;
}

/**
 * Which of the chosen categories already have an expense in the period. A chosen folder stands for
 * each of its categories — unless it is waited for per tag, when it stands as a whole once per tag. A
 * category with tags (`category_tags`) is one line per tag, done when an expense in it carries that
 * tag. With `include_recurring`, every active recurring expense with an occurrence in the period is a
 * line of its own as well, done once nothing more of it is due before the period ends.
 */
export function categoryChecklist(db: SqlDriver, p: InsightParams, o: { start: string; end: string; accountIds?: string[] }): ChecklistItem[] {
  const all = listRows(db, "categories", "deleted=0", [], "sort, name");
  const cats = new Map(all.map((c) => [c.id, c]));
  const accounts = new Map(listRows(db, "accounts", "1=1").map((a) => [a.id, a]));
  const kidsOf = (id: string) => all.filter((c) => c.parent_id === id).map((c) => c.id);
  const inAccounts = (accountId: string) => !o.accountIds?.length || o.accountIds.includes(accountId);
  // Every expense of the period once, so each line below is a filter rather than a query.
  const period = (listRows(db, "transactions", "deleted=0 AND transfer_id IS NULL AND amount_minor<0 AND date>=? AND date<?", [o.start, o.end]) as Transaction[]).filter((t) => inAccounts(t.account_id));
  const lastOf = (txs: Transaction[]) => {
    const t = txs.find((x) => x.date < o.start) ?? txs[0];
    return t ? { id: t.id, amount_minor: t.amount_minor, currency: accounts.get(t.account_id)?.currency ?? "", date: t.date, tag_ids: tagIdsOf(t), notes: t.notes, account_id: t.account_id, payee: t.payee } : null;
  };
  // The period before this one, the same length in months: what a line paid several times a month
  // usually comes to.
  const prevStart = addPeriod(o.start.slice(0, 10), "monthly", -1);
  const scopes = new Map<string, string[]>();
  const line = (key: string, id: string, scope: string[], tagId: string | null): ChecklistItem | null => {
    const c = cats.get(id); if (!c) return null;
    scopes.set(key, scope);
    const hit = (t: Transaction) => !!t.category_id && scope.includes(t.category_id) && (!tagId || tagIdsOf(t).includes(tagId));
    const rows = period.filter(hit);
    const history = (listRows(db, "transactions", `deleted=0 AND transfer_id IS NULL AND category_id IN (${scope.map(() => "?").join(",")})`, scope, "date DESC") as Transaction[]).filter((t) => !tagId || tagIdsOf(t).includes(tagId));
    const last = lastOf(history);
    const before = last ? history.filter((t) => t.amount_minor < 0 && t.date >= prevStart && t.date < o.start && inAccounts(t.account_id) && accounts.get(t.account_id)?.currency === last.currency) : [];
    const previous = before.length > 1 ? { total_minor: before.reduce((a, t) => a - t.amount_minor, 0), count: before.length, currency: last!.currency } : null;
    const expected = previous ? previous.total_minor : last ? Math.abs(last.amount_minor) : null;
    return {
      key, category_id: id, name: c.name, done: rows.length > 0, spent_minor: rows.reduce((a, t) => a - t.amount_minor, 0),
      currency: rows[0] ? accounts.get(rows[0].account_id)?.currency ?? null : null, tag_id: tagId, rule_id: null, icon: null, due: null, occurrences: null, ticked: false, last, previous,
      expected_minor: !rows.length && expected ? expected : null, expected_currency: !rows.length && last ? last.currency : null,
    };
  };
  const seen = new Set<string>();
  const out: ChecklistItem[] = [];
  // A tick by hand closes a line that nothing paid: done, and no longer expected to cost anything.
  // A line a payment already closed stays a payment's, tick or no tick.
  const ticked = new Set(p.ticked?.period === o.start ? p.ticked.keys : []);
  const push = (item: ChecklistItem | null) => {
    if (!item || seen.has(item.key)) return;
    seen.add(item.key);
    out.push(!item.done && ticked.has(item.key) ? { ...item, done: true, ticked: true, expected_minor: null, expected_currency: null } : item);
  };
  for (const id of p.category_ids ?? []) {
    const tags = p.category_tags?.[id] ?? [];
    const kids = kidsOf(id);
    if (tags.length) for (const tag of tags) push(line(`${id}#${tag}`, id, [id, ...kids], tag));
    else if (kids.length) for (const k of kids) push(line(k, k, [k, ...kidsOf(k)], null));
    else push(line(id, id, [id], null));
  }
  if (p.include_recurring) {
    const excluded = new Set(p.exclude_rule_ids ?? []);
    const rules = (listRows(db, "recurring_rules", "deleted=0 AND active=1 AND amount_minor<0", [], "next_date") as RecurringRule[]).filter((r) => inAccounts(r.account_id) && !excluded.has(r.id));
    for (const r of rules) {
      const posted = period.filter((t) => t.recurring_id === r.id);
      // Every occurrence still owed before the period ends — an overdue one from an earlier period
      // too: it has not been paid either. A weekly rule owes several.
      const owed = occurrencesBetween(r, "", o.end);
      if (!posted.length && !owed.length) continue; // nothing of this rule happens in the period
      const c = r.category_id ? cats.get(r.category_id) : undefined;
      const currency = accounts.get(r.account_id)?.currency ?? null;
      push({
        key: `rule:${r.id}`, category_id: r.category_id ?? "", name: r.payee || c?.name || "Recurring",
        done: !owed.length, spent_minor: posted.reduce((a, t) => a - t.amount_minor, 0),
        currency, tag_id: null, rule_id: r.id, icon: shownPaymentIcon(r), due: owed[0] ?? null, last: null, previous: null,
        occurrences: { paid: posted.length, total: posted.length + owed.length }, ticked: false,
        expected_minor: owed.length ? owed.length * Math.abs(r.amount_minor) : null, expected_currency: owed.length ? currency : null,
      });
    }
    // A recurring payment filed under a category answers for that category: Rent and the landlord's
    // rule filed under Rent are one payment, and listing both counts it twice in "to go". The rule's
    // line stays — it knows the amount and the day. A line waiting for a tag is a narrower question
    // and is left alone.
    const covered = new Set(out.filter((i) => i.rule_id && i.category_id).map((i) => i.category_id));
    return out.filter((i) => i.rule_id || i.tag_id || !(scopes.get(i.key) ?? [i.category_id]).some((id) => covered.has(id)));
  }
  return out;
}

/**
 * The same params with one checklist line ticked or unticked for the period starting `period`. Ticks
 * from an earlier period are dropped on the way, since only the current one is ever shown.
 */
export function withChecklistTick(p: InsightParams, period: string, key: string, on: boolean): InsightParams {
  const keys = new Set(p.ticked?.period === period ? p.ticked.keys : []);
  if (on) keys.add(key); else keys.delete(key);
  const { ticked: _, ...rest } = p;
  return keys.size ? { ...rest, ticked: { period, keys: [...keys] } } : rest;
}

export interface ChecklistTotal { currency: string; paid_minor: number; expected_minor: number }

/**
 * The checklist summed per currency: what has been paid on its lines this period, and what the lines
 * still open are expected to cost — their last payment, or the rule's amount. Positive minor units. An
 * open line with nothing to go by adds nothing rather than a guess.
 */
export function checklistTotals(items: ChecklistItem[]): ChecklistTotal[] {
  const out = new Map<string, ChecklistTotal>();
  const at = (c: string) => { let x = out.get(c); if (!x) { x = { currency: c, paid_minor: 0, expected_minor: 0 }; out.set(c, x); } return x; };
  for (const i of items) {
    if (i.currency && i.spent_minor) at(i.currency).paid_minor += i.spent_minor;
    if (i.expected_currency && i.expected_minor) at(i.expected_currency).expected_minor += i.expected_minor;
  }
  return [...out.values()];
}

const PER_YEAR: Record<Frequency, number> = { daily: 365, weekly: 52, monthly: 12, yearly: 1 };

export interface SubscriptionLine { rule: RecurringRule; title: string; currency: string; yearly_minor: number; per_period: string; included: boolean }

export function periodLabel(f: Frequency, interval: number): string {
  const unit = f === "daily" ? "day" : f === "weekly" ? "week" : f === "monthly" ? "month" : "year";
  return interval > 1 ? `every ${interval} ${unit}s` : `per ${unit}`;
}

/** Active expense rules annualised (monthly ×12, weekly ×52 …); totals per currency over the included ones. */
export function subscriptionsPerYear(db: SqlDriver, p: InsightParams = {}): { lines: SubscriptionLine[]; totals: MoneyByCurrency[] } {
  const accounts = new Map(listRows(db, "accounts", "1=1").map((a) => [a.id, a]));
  const cats = new Map(listRows(db, "categories", "1=1").map((c) => [c.id, c]));
  const excluded = new Set(p.exclude_rule_ids ?? []);
  const lines = (listRows(db, "recurring_rules", "deleted=0 AND active=1 AND amount_minor<0") as RecurringRule[]).map((r) => ({
    rule: r, title: r.payee || (r.category_id ? cats.get(r.category_id)?.name : null) || "Recurring",
    currency: accounts.get(r.account_id)?.currency ?? "", yearly_minor: Math.round((Math.abs(r.amount_minor) * PER_YEAR[r.frequency]) / Math.max(1, r.interval)),
    per_period: periodLabel(r.frequency, r.interval), included: !excluded.has(r.id),
  })).sort((a, b) => b.yearly_minor - a.yearly_minor);
  const totals = new Map<string, number>();
  for (const l of lines) if (l.included) totals.set(l.currency, (totals.get(l.currency) ?? 0) + l.yearly_minor);
  return { lines, totals: [...totals].map(([currency, minor]) => ({ currency, minor })) };
}

export function templateFromTransaction(t: { category_id: string | null; tag_ids: string; notes: string | null; amount_minor: number; account_id: string }): UpcomingTemplate {
  return { category_id: t.category_id, tag_ids: tagIdsOf(t), notes: t.notes?.split("\n")[0]?.trim() || null, amount_minor: t.amount_minor, account_id: t.account_id };
}

export interface UpcomingItem { template: UpcomingTemplate; done: boolean; matched_id: string | null; currency: string; category_name: string | null; tag_names: string[] }

/** Templates matched against the period: same category, same tags and same note (title). */
export function upcomingPayments(db: SqlDriver, p: InsightParams, o: { start: string; end: string }): UpcomingItem[] {
  const accounts = new Map(listRows(db, "accounts", "1=1").map((a) => [a.id, a]));
  const cats = new Map(listRows(db, "categories", "1=1").map((c) => [c.id, c]));
  const tags = new Map(listRows(db, "tags", "1=1").map((t) => [t.id, t]));
  const txs = listRows(db, "transactions", "deleted=0 AND transfer_id IS NULL AND date>=? AND date<?", [o.start, o.end], "date DESC");
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
  return (p.templates ?? []).map((tpl) => {
    const hit = txs.find((t) => (t.category_id ?? null) === (tpl.category_id ?? null) && same(tagIdsOf(t), tpl.tag_ids) && normTitle(t.notes) === normTitle(tpl.notes));
    return { template: tpl, done: !!hit, matched_id: hit?.id ?? null, currency: accounts.get(tpl.account_id)?.currency ?? "",
      category_name: tpl.category_id ? cats.get(tpl.category_id)?.name ?? null : null, tag_names: tpl.tag_ids.map((id) => tags.get(id)?.name ?? "").filter(Boolean) };
  });
}

export interface RegularSpend { currency: string; average_minor: number; periods: number; last_minor: number; frequency: "weekly" | "monthly" }

/**
 * Average spend in a category (with its subcategories) per week or month over the recent past — the
 * windows and the sums are `regularSeries`'s, which the details screen draws, so the two agree.
 */
export function regularSpending(db: SqlDriver, p: InsightParams, o: { today: string; accountIds?: string[] }): RegularSpend[] {
  const frequency = p.frequency ?? "monthly";
  // "Last" on the card is the newest window, the month still running included.
  return regularSeries(db, p, o).map((x) => ({ currency: x.currency, average_minor: x.average_minor, periods: x.periods, last_minor: x.points[x.points.length - 1]?.minor ?? 0, frequency }));
}

export { jsonIds as insightIds };
