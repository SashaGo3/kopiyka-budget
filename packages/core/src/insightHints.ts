/**
 * Which insight cards are worth suggesting to *you*, from what is already in the database: budgets
 * suggest the budgets card, payments you confirm by hand suggest the checklist, a savings account
 * with no goal suggests one, groceries bought five times a week suggest a weekly average. Each
 * suggestion carries the reason (a code and the numbers that make it yours) so the app can say why in
 * one line, and the settings it would be added with — or `setup` when only a person can give the
 * last one (a goal's target), so the editor opens with the rest filled in.
 *
 * Read-only and cheap: a handful of counts over the last few months, run when the Insights tab is
 * drawn. What is already on the screen is never suggested again, and neither is what was waved away
 * (`dismissed`, keys as `key` gives them).
 */
import type { SqlDriver } from "./db";
import type { Category, Insight, RecurringRule } from "./models";
import { parseInsightParams, type InsightParams, type OfferedInsightKind } from "./insights";
import { periodWindows } from "./insightHistory";
import { accountBalanceMinor, listRows } from "./repo";
import { addPeriod } from "./recurring";

export type InsightHintWhy = "history" | "savings" | "budgets" | "manual" | "recurring" | "habit" | "salary" | "usual" | "shops" | "places" | "importance";

export interface InsightHint {
  /** Stable across days, for dismissing: the kind, and the account or category it is about. */
  key: string;
  kind: OfferedInsightKind;
  params: InsightParams;
  why: InsightHintWhy;
  /** The number the reason quotes: months of history, rules, times a week… */
  count: number;
  /** The account (savings) or category (habit) the reason names. */
  ref_id?: string;
  /** Needs one more setting only a person can give; open the editor instead of adding. */
  setup?: boolean;
}

/** "Savings", "Ощадний", "Oszczędności", "Депозит", "Накопичення", "Скарбничка" — a savings account by name. */
const SAVINGS_WORDS = /saving|ощад|заощад|oszcz|депозит|deposit|lokata|накопич|скарбн|копилк|reserve|резерв/i;

/** Busy enough to be called history: a period with fewer entries than this is someone starting out. */
const ACTIVE_PERIOD_ROWS = 5;

export function suggestInsights(db: SqlDriver, o: { today: string; startDay: number; existing: Pick<Insight, "kind" | "params">[]; dismissed?: string[] }): InsightHint[] {
  const have = new Set(o.existing.map((i) => i.kind));
  const params = o.existing.map((i) => ({ kind: i.kind, p: parseInsightParams(i.params) }));
  const dismissed = new Set(o.dismissed ?? []);
  const out: InsightHint[] = [];
  const add = (h: InsightHint) => { if (!dismissed.has(h.key)) out.push(h); };
  const since90 = addPeriod(o.today, "daily", -90);

  const windows = periodWindows(o.today, o.startDay, 7).filter((w) => !w.current);
  const perWindow = windows.map((w) => db.get<{ n: number; income: number }>(
    `SELECT COUNT(*) AS n, SUM(CASE WHEN amount_minor>0 AND transfer_id IS NULL THEN 1 ELSE 0 END) AS income
     FROM transactions WHERE deleted=0 AND date>=? AND date<?`, [w.start, w.end]) ?? { n: 0, income: 0 });
  const months = perWindow.filter((w) => w.n >= ACTIVE_PERIOD_ROWS).length;

  // The future first: it is the one card about more than this month.
  if (!have.has("forecast") && months >= 2) add({ key: "forecast", kind: "forecast", params: {}, why: "history", count: months });

  // A savings or investment account with money in it and no goal watching it — by its type, or by
  // its name when it was set up as a plain bank account ("Savings - Euro"). A name only ever chooses
  // what to suggest here; it labels nothing and changes nothing (DATA.md rule 1).
  const goals = new Set(params.filter((x) => x.kind === "savings_goal").map((x) => x.p.account_id));
  const savingsLike = (a: { type: string; name: string }) => a.type === "savings" || a.type === "investment" || SAVINGS_WORDS.test(a.name);
  const unwatched = listRows(db, "accounts", "deleted=0 AND archived=0", [], "sort, name")
    .filter((a) => savingsLike(a) && !goals.has(a.id) && accountBalanceMinor(db, a.id) > 0);
  for (const a of unwatched.slice(0, 2)) {
    add({ key: `savings_goal:${a.id}`, kind: "savings_goal", params: { account_id: a.id }, why: "savings", count: 0, ref_id: a.id, setup: true });
  }

  const budgets = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM budgets WHERE deleted=0 AND period<>'once'`)?.n ?? 0;
  if (!have.has("free_money") && !have.has("safe_to_spend") && budgets > 0) add({ key: "free_money", kind: "free_money", params: {}, why: "budgets", count: budgets });

  const rules = listRows(db, "recurring_rules", "deleted=0 AND active=1 AND amount_minor<0") as RecurringRule[];
  const manual = rules.filter((r) => !r.auto_post).length;
  if (!have.has("checklist") && manual >= 2) add({ key: "checklist", kind: "checklist", params: { include_recurring: true }, why: "manual", count: manual });
  if (!have.has("subscriptions") && rules.length >= 3) add({ key: "subscriptions", kind: "subscriptions", params: {}, why: "recurring", count: rules.length });

  // The category bought most often, when it is a habit — several times a week — rather than a few
  // big purchases: a weekly average is the number that habit is lived by.
  const covered = new Set(params.filter((x) => x.kind === "regular").flatMap((x) => x.p.category_ids ?? []));
  const cats = listRows(db, "categories", "deleted=0 AND archived=0") as Category[];
  const folders = new Set(cats.map((c) => c.parent_id).filter(Boolean));
  const top = db.all<{ category_id: string; n: number }>(
    `SELECT category_id, COUNT(*) AS n FROM transactions
     WHERE deleted=0 AND amount_minor<0 AND transfer_id IS NULL AND recurring_id IS NULL AND category_id IS NOT NULL AND date>=?
     GROUP BY category_id ORDER BY n DESC LIMIT 5`, [since90]);
  const habit = top.find((x) => !folders.has(x.category_id) && !covered.has(x.category_id) && cats.some((c) => c.id === x.category_id));
  const perWeek = habit ? Math.round((habit.n / 90) * 7) : 0;
  if (habit && perWeek >= 3) add({ key: `regular:${habit.category_id}`, kind: "regular", params: { category_ids: [habit.category_id], frequency: "weekly" }, why: "habit", count: perWeek, ref_id: habit.category_id });

  const incomeMonths = perWindow.filter((w) => (w.income ?? 0) > 0).length;
  if (!have.has("days_to_salary") && incomeMonths >= 3) add({ key: "days_to_salary", kind: "days_to_salary", params: {}, why: "salary", count: incomeMonths });

  if (!have.has("month_vs_usual") && months >= 3) add({ key: "month_vs_usual", kind: "month_vs_usual", params: {}, why: "usual", count: months });

  const shops = db.get<{ n: number }>(`SELECT COUNT(DISTINCT lower(trim(payee))) AS n FROM transactions WHERE deleted=0 AND amount_minor<0 AND payee IS NOT NULL AND trim(payee)<>'' AND date>=?`, [since90])?.n ?? 0;
  if (!have.has("top_shops") && shops >= 10) add({ key: "top_shops", kind: "top_shops", params: {}, why: "shops", count: shops });

  const placed = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM transactions WHERE deleted=0 AND amount_minor<0 AND lat IS NOT NULL AND date>=?`, [since90])?.n ?? 0;
  if (!have.has("spending_map") && placed >= 10) add({ key: "spending_map", kind: "spending_map", params: {}, why: "places", count: placed });

  const marked = cats.filter((c) => c.importance > 0).length;
  if (!have.has("values") && marked >= 3) add({ key: "values", kind: "values", params: {}, why: "importance", count: marked });

  return out;
}
