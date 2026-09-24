/**
 * Insights: small user-configured statistics. Pure functions over the DB so the
 * phone, widgets and tests share one implementation. Amounts are minor units.
 */
import type { SqlDriver } from "./db";
import type { Budget, Category, Frequency, Importance, InsightKind, RecurringRule, Transaction } from "./models";
import { normTitle } from "./detect";
import { accountBalanceMinor, budgetCategoryIds, categorySpend, getRow, inBudgetScope, jsonIds, listRows, recurringSpend, tagIdsOf, tagSpend } from "./repo";
import { addPeriod, budgetPeriod, dueOccurrences } from "./recurring";
import { categoryImportance } from "./importance";
import { commitments } from "./commitments";
import { tripTagIds } from "./trips";

export interface UpcomingTemplate { category_id: string | null; tag_ids: string[]; notes: string | null; amount_minor: number; account_id: string }

export interface InsightParams {
  title?: string;
  account_id?: string;
  target_minor?: number;
  monthly_minor?: number;
  months?: number;
  category_ids?: string[];
  /** Rules left out of the subscriptions card. */
  exclude_rule_ids?: string[];
  templates?: UpcomingTemplate[];
  frequency?: Extract<Frequency, "weekly" | "monthly">;
}

/** `instant` kinds have nothing to configure but their title, so picking one is the whole setup. */
export const INSIGHT_KINDS: { kind: InsightKind; title: string; hint: string; instant?: boolean }[] = [
  { instant: true, kind: "free_money", title: "Free to spend", hint: "What is left of your budgets this period" },
  { instant: true, kind: "days_to_salary", title: "Until salary", hint: "Days left in the period and what you can spend per day" },
  { kind: "savings_goal", title: "Savings goal", hint: "Progress of an account towards a target" },
  { kind: "account_balance", title: "Account balance", hint: "What is left on one account, and what moved this period" },
  { kind: "checklist", title: "Payments checklist", hint: "Which of these categories still have no transaction this period" },
  { kind: "subscriptions", title: "Subscriptions per year", hint: "What your recurring expenses cost yearly" },
  { instant: true, kind: "recurring_spend", title: "Recurring this period", hint: "What your recurring rules have actually taken so far this period" },
  { kind: "upcoming", title: "Upcoming payments", hint: "Templates from past transactions: tap to log the same again" },
  { kind: "regular", title: "Regular spending", hint: "Weekly or monthly average for a category" },
  { instant: true, kind: "values", title: "What it went on", hint: "This period split by how much each category matters to you" },
  { kind: "safety_buffer", title: "Safety buffer", hint: "How many months of essentials an account would cover" },
  { instant: true, kind: "safe_to_spend", title: "Safe to spend", hint: "What is free once everything still coming out is taken off" },
];

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
  return activeBudgets(db, o.end, o.budgetAccount).map((b) => {
    const ids = budgetCategoryIds(b);
    const pool = b.tag_id ? tagSpend(db, b.tag_id, { fromIso: o.start, toIso: o.end, accountIds: o.accountIds, exceptTags: trips }) : spend;
    const scoped = pool.filter((s) => s.currency === b.currency && inBudgetScope(ids, cats, s.category_id));
    return { budget: b, spent_minor: -scoped.reduce((a, s) => a + s.spent_minor, 0), children: scoped.map((s) => ({ category_id: s.category_id, spent_minor: -s.spent_minor })) };
  });
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
  for (const w of windows) {
    const here = new Map<string, Record<Importance, number>>();
    for (const s of categorySpend(db, w.start, w.end, o.accountIds)) {
      // Uncategorised spend is unmarked spend: nobody said what it was, let alone whether it mattered.
      const at = (s.category_id ? level.get(s.category_id) : 0) ?? 0;
      const row = here.get(s.currency) ?? { 0: 0, 1: 0, 2: 0, 3: 0 };
      row[at] += -s.spent_minor;
      here.set(s.currency, row);
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
    .map(([currency, periods]) => ({ currency, periods, now: periods[periods.length - 1]!, unmarked_minor: periods[periods.length - 1]!.by_level[0] }))
    .filter((v) => v.periods.some((p) => p.total_minor > 0))
    .sort((a, b) => b.now.total_minor - a.now.total_minor);
}

/* ── Safety buffer ────────────────────────────────────────────────────────────────────────── */

export interface SafetyBuffer {
  currency: string;
  /** What a month of the things you could not live without actually costs, averaged over `periods`. */
  essential_minor: number;
  /** What the chosen account holds, pending included. */
  have_minor: number;
  /** How many months of essentials that covers; null when no essential spend is known yet. */
  months_covered: number | null;
  months_wanted: number;
  target_minor: number;
  /** 0..1 against the target, for the bar. */
  ratio: number;
  periods: number;
  /** True when no category is marked high: the target would be 0 and the card should say why. */
  no_essentials: boolean;
}

/**
 * "Enough to be safe" is a real number and nobody ever computes it, because it needs two things:
 * what an essential month costs, and what you have. Importance gives the first for free.
 *
 * The target is **computed, not typed**: it moves on its own as life gets more expensive, which a
 * figure you entered last year does not. That is the whole difference from `savings_goal`, and the
 * reason both exist.
 *
 * Like `savings_goal` this ignores the scope pill. A buffer is a whole-life number, and showing it
 * differently because you were looking at one account would be answering a question nobody asked.
 */
export function safetyBuffer(db: SqlDriver, p: InsightParams, o: { today: string; startDay: number }): SafetyBuffer | null {
  const a = p.account_id ? getRow(db, "accounts", p.account_id) : undefined;
  if (!a) return null;
  const cats = listRows(db, "categories", "1=1") as Category[];
  const level = categoryImportance(cats);
  const months = Math.max(1, Math.round(p.months ?? 3));
  // Complete periods only: the month in progress would drag the average down every time it is read.
  const windows = recentPeriods(o.today, o.startDay, HISTORY_PERIODS + 1).slice(0, -1);
  let essential = 0;
  for (const w of windows) {
    for (const s of categorySpend(db, w.start, w.end, undefined)) {
      if (s.currency !== a.currency) continue;
      if ((s.category_id ? level.get(s.category_id) : 0) === 3) essential += -s.spent_minor;
    }
  }
  const essential_minor = Math.round(essential / windows.length);
  const have_minor = accountBalanceMinor(db, a.id, { includePending: true });
  const target_minor = essential_minor * months;
  return {
    currency: a.currency, essential_minor, have_minor, months_wanted: months, target_minor,
    months_covered: essential_minor > 0 ? have_minor / essential_minor : null,
    ratio: target_minor > 0 ? Math.max(0, Math.min(1, have_minor / target_minor)) : 0,
    periods: windows.length,
    no_essentials: !cats.some((c) => level.get(c.id) === 3),
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
  category_id: string; name: string; done: boolean; spent_minor: number; currency: string | null;
  /** Most recent non-transfer transaction in this category (or its subcategories) before the period started, so the row can be prefilled. */
  last: { id: string; amount_minor: number; currency: string; date: string; tag_ids: string[]; notes: string | null; account_id: string; payee: string | null } | null;
}

/** Which of the chosen categories already have an expense in the period. A chosen folder stands for each of its categories. */
export function categoryChecklist(db: SqlDriver, p: InsightParams, o: { start: string; end: string; accountIds?: string[] }): ChecklistItem[] {
  const all = listRows(db, "categories", "deleted=0", [], "sort, name");
  const cats = new Map(all.map((c) => [c.id, c]));
  const accounts = new Map(listRows(db, "accounts", "1=1").map((a) => [a.id, a]));
  const spend = categorySpend(db, o.start, o.end, o.accountIds);
  const ids = [...new Set((p.category_ids ?? []).flatMap((id) => { const kids = all.filter((c) => c.parent_id === id).map((c) => c.id); return kids.length ? kids : [id]; }))];
  return ids.flatMap((id) => {
    const c = cats.get(id); if (!c) return [];
    const rows = spend.filter((s) => s.category_id === id || cats.get(s.category_id ?? "")?.parent_id === id);
    const spent = -rows.reduce((a, s) => a + s.spent_minor, 0);
    const scope = [id, ...all.filter((k) => k.parent_id === id).map((k) => k.id)];
    const txs = listRows(db, "transactions", `deleted=0 AND transfer_id IS NULL AND category_id IN (${scope.map(() => "?").join(",")})`, scope, "date DESC") as Transaction[];
    const lastTx = txs.find((t) => t.date < o.start) ?? txs[0];
    const last = lastTx ? { id: lastTx.id, amount_minor: lastTx.amount_minor, currency: accounts.get(lastTx.account_id)?.currency ?? "", date: lastTx.date, tag_ids: tagIdsOf(lastTx), notes: lastTx.notes, account_id: lastTx.account_id, payee: lastTx.payee } : null;
    return [{ category_id: id, name: c.name, done: rows.length > 0, spent_minor: spent, currency: rows[0]?.currency ?? null, last }];
  });
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

/** Average spend in a category (with its subcategories) per week or month over the recent past. */
export function regularSpending(db: SqlDriver, p: InsightParams, o: { today: string; accountIds?: string[] }): RegularSpend[] {
  const freq = p.frequency ?? "monthly";
  const n = freq === "weekly" ? 12 : 6;
  const ids = p.category_ids ?? [];
  if (!ids.length) return [];
  const cats = new Map(listRows(db, "categories", "1=1").map((c) => [c.id, c]));
  const scope = new Set(ids);
  const inScope = (cid: string | null) => !!cid && (scope.has(cid) || scope.has(cats.get(cid)?.parent_id ?? ""));
  let end = freq === "weekly" ? addPeriod(o.today, "daily", 1) : budgetPeriod(o.today, 1).end;
  const totals = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const start = freq === "weekly" ? addPeriod(end, "daily", -7) : addPeriod(end, "monthly", -1);
    for (const s of categorySpend(db, start, end, o.accountIds)) {
      if (!inScope(s.category_id)) continue;
      const arr = totals.get(s.currency) ?? new Array<number>(n).fill(0);
      arr[i]! += -s.spent_minor; totals.set(s.currency, arr);
    }
    end = start;
  }
  return [...totals].map(([currency, arr]) => ({ currency, average_minor: Math.round(arr.reduce((a, b) => a + b, 0) / n), periods: n, last_minor: arr[0] ?? 0, frequency: freq }));
}

export { jsonIds as insightIds };
