/**
 * Detect recurring series (subscriptions, rent, salary, insurance) so the app can
 * suggest rules. Two signals:
 *  1. Planned rows: a future-dated transaction that already exists (e.g. a template
 *     row an import created for the next occurrence) is treated as one to build the rule from.
 *  2. History: regular gaps between transactions with the same title (payee/note)
 *     or, lacking a title, the same category and amount.
 */
import type { SqlDriver } from "./db";
import type { Frequency } from "./models";
import { addPeriod } from "./recurring";
import { createRecurring, listRows, remove } from "./repo";

export interface RecurringCandidate {
  key: string;
  account_id: string;
  category_id: string | null;
  category_name: string | null;
  title: string | null;
  amount_minor: number;
  currency: string;
  frequency: Frequency;
  interval: number;
  occurrences: number;
  last_date: string | null;
  next_date: string;
  /** 0..1 */
  confidence: number;
  tag_ids: string;
  /** Future-dated placeholder transaction this rule would replace. */
  planned_tx_id: string | null;
  /** The shop exactly as it is written on the occurrence this was built from, for `match_payee`. */
  match_payee: string | null;
  /** HH:MM taken from the planned row or the latest occurrence. */
  time_of_day: string;
  source: "planned" | "history";
}

interface Tx { id: string; account_id: string; category_id: string | null; category_name: string | null; payee: string | null; notes: string | null; amount_minor: number; date: string; tag_ids: string; currency: string }

const PERIODS: { frequency: Frequency; interval: number; days: number; tol: number; min: number }[] = [
  { frequency: "weekly", interval: 1, days: 7, tol: 2, min: 4 },
  { frequency: "weekly", interval: 2, days: 14, tol: 3, min: 4 },
  { frequency: "monthly", interval: 1, days: 30.4, tol: 5, min: 3 },
  { frequency: "monthly", interval: 2, days: 61, tol: 7, min: 3 },
  { frequency: "monthly", interval: 3, days: 91, tol: 9, min: 3 },
  { frequency: "monthly", interval: 6, days: 182, tol: 12, min: 2 },
  { frequency: "yearly", interval: 1, days: 365, tol: 20, min: 2 },
];

export function normTitle(s: string | null | undefined): string {
  return (s ?? "").split("\n")[0]!.toLowerCase().replace(/\s+/g, " ").replace(/[^\p{L}\p{N} +]/gu, "").trim();
}
function titleOf(t: Tx): string | null { return t.payee?.trim() || t.notes?.split("\n")[0]?.trim() || null; }
/** The shop as it was written on this row — the payee only: a note is a sentence, not a name. */
function matchName(t: Tx): string | null { return t.payee?.trim() || null; }
function groupKey(t: Tx): string {
  const title = normTitle(t.payee) || normTitle(t.notes);
  return title ? `${t.account_id}|t:${title}` : `${t.account_id}|c:${t.category_id ?? "-"}|${t.amount_minor}`;
}
function daysBetween(a: string, b: string): number {
  return (Date.parse(b.slice(0, 10) + "T00:00:00Z") - Date.parse(a.slice(0, 10) + "T00:00:00Z")) / 86_400_000;
}
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
function periodFromGap(days: number): { frequency: Frequency; interval: number } | null {
  for (const p of PERIODS) if (Math.abs(days - p.days) <= p.tol) return { frequency: p.frequency, interval: p.interval };
  return null;
}
/** "Subscription (Monthly)", "Yearly", "Weekly", "щомісяця"… */
export function periodFromName(name: string | null | undefined): { frequency: Frequency; interval: number } | null {
  const n = (name ?? "").toLowerCase();
  if (/week|тижд|тижн/.test(n)) return { frequency: "weekly", interval: 1 };
  if (/quarter|кварт/.test(n)) return { frequency: "monthly", interval: 3 };
  if (/year|annual|річн|рік/.test(n)) return { frequency: "yearly", interval: 1 };
  if (/month|місяц|місяч/.test(n)) return { frequency: "monthly", interval: 1 };
  if (/daily|щодня/.test(n)) return { frequency: "daily", interval: 1 };
  return null;
}

export interface DetectOptions {
  today: string;
  skipExisting?: boolean;
  /** Amount tolerance as a fraction when grouping by title (premiums drift). Default 0.15. */
  amountTolerance?: number;
}

export function detectRecurring(db: SqlDriver, opts: DetectOptions): RecurringCandidate[] {
  const txs = db.all(
    `SELECT t.id, t.account_id, t.category_id, c.name AS category_name, t.payee, t.notes, t.amount_minor, t.date, t.tag_ids, a.currency
     FROM transactions t JOIN accounts a ON a.id=t.account_id LEFT JOIN categories c ON c.id=t.category_id
     WHERE t.deleted=0 AND t.transfer_id IS NULL AND t.pending=0 AND t.recurring_id IS NULL ORDER BY t.date`) as unknown as Tx[];
  const tol = opts.amountTolerance ?? 0.15;
  const groups = new Map<string, Tx[]>();
  for (const t of txs) (groups.get(groupKey(t)) ?? groups.set(groupKey(t), []).get(groupKey(t))!).push(t);
  const existing = opts.skipExisting === false ? [] : listRows(db, "recurring_rules", "deleted=0");
  const covered = (t: Tx, freq: Frequency) => existing.some((r) => r.account_id === t.account_id && r.frequency === freq &&
    ((titleOf(t) && normTitle(r.payee) === normTitle(titleOf(t))) || (!titleOf(t) && r.category_id === t.category_id && r.amount_minor === t.amount_minor)));

  const out: RecurringCandidate[] = [];
  const done = new Set<string>();
  const pastAll = txs.filter((t) => t.date.slice(0, 10) <= opts.today);
  const tagsOf = (t: Tx): string[] => { try { const v = JSON.parse(t.tag_ids || "[]"); return Array.isArray(v) ? v : []; } catch { return []; } };
  /** Latest past row in the same account with a similar amount that shares a tag: the previous occurrence when the note changed ("SIS1-K03X" vs "Leadenhall…"). */
  const siblingByTag = (p: Tx, near: (t: Tx) => boolean): Tx | undefined => {
    const tags = tagsOf(p);
    if (!tags.length) return undefined;
    for (let i = pastAll.length - 1; i >= 0; i--) {
      const t = pastAll[i]!;
      if (t.account_id === p.account_id && near(t) && tagsOf(t).some((x) => tags.includes(x))) return t;
    }
    return undefined;
  };

  for (const [key, all] of groups) {
    const planned = all.filter((t) => t.date.slice(0, 10) > opts.today);
    const past = all.filter((t) => t.date.slice(0, 10) <= opts.today);
    const ref = planned[0] ?? past[past.length - 1]!;
    // keep amounts near the reference so one title with two price points stays sane
    const near = (t: Tx) => Math.sign(t.amount_minor) === Math.sign(ref.amount_minor) &&
      Math.abs(Math.abs(t.amount_minor) - Math.abs(ref.amount_minor)) <= Math.max(100, Math.abs(ref.amount_minor) * tol);
    const byDay = new Map<string, Tx>();
    for (const t of past.filter(near)) byDay.set(t.date.slice(0, 10), t);
    const series = [...byDay.values()];
    const gaps: number[] = [];
    for (let i = 1; i < series.length; i++) gaps.push(daysBetween(series[i - 1]!.date, series[i]!.date));

    let best: { frequency: Frequency; interval: number; score: number } | null = null;
    if (gaps.length) {
      const med = median(gaps);
      for (const p of PERIODS) {
        if (series.length < p.min || Math.abs(med - p.days) > p.tol) continue;
        const score = gaps.filter((g) => Math.abs(g - p.days) <= p.tol).length / gaps.length;
        if (!best || score > best.score) best = { frequency: p.frequency, interval: p.interval, score };
      }
      if (best && best.score < 0.6) best = null;
    }

    if (planned.length) {
      // Signal 1: a planned row is a template. Period: history > gap to previous > category name > monthly.
      const p = planned[0]!;
      const prev = series[series.length - 1] ?? siblingByTag(p, near);
      const period = best ?? (prev ? periodFromGap(daysBetween(prev.date, p.date)) : null) ?? periodFromName(p.category_name) ?? { frequency: "monthly" as Frequency, interval: 1 };
      if (covered(p, period.frequency)) continue;
      out.push({
        key, account_id: p.account_id, category_id: p.category_id, category_name: p.category_name, title: titleOf(p), amount_minor: p.amount_minor,
        currency: p.currency, frequency: period.frequency, interval: period.interval, occurrences: (series.length || (prev ? 1 : 0)) + planned.length,
        last_date: prev?.date.slice(0, 10) ?? null, next_date: p.date.slice(0, 10),
        confidence: best ? 1 : series.length ? 0.8 : prev ? (periodFromName(p.category_name) ? 0.7 : 0.6) : periodFromName(p.category_name) ? 0.7 : 0.5, tag_ids: p.tag_ids, planned_tx_id: p.id, source: "planned",
        match_payee: matchName(prev ?? p),
        time_of_day: p.date.slice(11, 16),
      });
      done.add(key);
      continue;
    }

    if (!best) continue;
    const last = series[series.length - 1]!;
    // Untitled groups (category + amount) are noisier: demand a clean simple period.
    if (!titleOf(last) && (best.score < 0.75 || best.interval !== 1)) continue;
    if (covered(last, best.frequency)) continue;
    let next = addPeriod(last.date.slice(0, 10), best.frequency, best.interval);
    while (next < opts.today) next = addPeriod(next, best.frequency, best.interval);
    out.push({
      key, account_id: last.account_id, category_id: last.category_id, category_name: last.category_name, title: titleOf(last), amount_minor: last.amount_minor,
      currency: last.currency, frequency: best.frequency, interval: best.interval, occurrences: series.length, last_date: last.date.slice(0, 10), next_date: next,
      confidence: best.score, tag_ids: last.tag_ids, planned_tx_id: null, source: "history", time_of_day: last.date.slice(11, 16),
      match_payee: matchName(last),
    });
  }
  return out.sort((a, b) => (a.source === b.source ? 0 : a.source === "planned" ? -1 : 1) || a.next_date.localeCompare(b.next_date));
}

/**
 * Turn a candidate into a recurring rule. The planned placeholder row (if any) is
 * removed because the rule now owns that occurrence and will post it on the day.
 */
export function adoptCandidate(db: SqlDriver, c: RecurringCandidate, opts: { notify?: boolean; notify_days_before?: number; auto_post?: boolean } = {}) {
  // A planned row already stood for an automatically-posted occurrence; history-derived ones ask first.
  const auto = opts.auto_post ?? c.source === "planned";
  return db.transaction(() => {
    const rule = createRecurring(db, {
      account_id: c.account_id, amount_minor: c.amount_minor, category_id: c.category_id, payee: c.title, notes: null, tag_ids: c.tag_ids, match_payee: c.match_payee,
      frequency: c.frequency, interval: c.interval, start_date: c.next_date, next_date: c.next_date, time_of_day: c.time_of_day,
      notify: opts.notify === false ? 0 : 1, notify_days_before: opts.notify_days_before ?? 1, auto_post: auto ? 1 : 0,
    });
    if (c.planned_tx_id) remove(db, "transactions", c.planned_tx_id);
    return rule;
  });
}

/**
 * Start a rule from one transaction: if history shows a series with the same title
 * (or category + amount) its period is used, otherwise monthly from that date.
 */
export function candidateFromTransaction(db: SqlDriver, txId: string, today: string): RecurringCandidate | null {
  const t = db.get(`SELECT t.*, a.currency, c.name AS category_name FROM transactions t JOIN accounts a ON a.id=t.account_id LEFT JOIN categories c ON c.id=t.category_id WHERE t.id=?`, [txId]) as unknown as Tx | undefined;
  if (!t) return null;
  const key = groupKey(t);
  const found = detectRecurring(db, { today, skipExisting: false }).find((c) => c.key === key);
  // The row the user pointed at is the better example of how this charge is written, whatever
  // occurrence the series happened to be summarised from.
  if (found) return { ...found, match_payee: matchName(t) ?? found.match_payee };
  let next = t.date.slice(0, 10);
  while (next < today) next = addPeriod(next, "monthly", 1);
  return {
    key, account_id: t.account_id, category_id: t.category_id, category_name: t.category_name, title: titleOf(t), amount_minor: t.amount_minor, currency: t.currency,
    frequency: "monthly", interval: 1, occurrences: 1, last_date: t.date.slice(0, 10), next_date: next, confidence: 0.3, tag_ids: t.tag_ids, planned_tx_id: null,
    time_of_day: t.date.slice(11, 16), source: "history", match_payee: matchName(t),
  };
}
