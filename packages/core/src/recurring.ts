import type { SqlDriver } from "./db";
import type { Frequency, RecurringRule } from "./models";
import { createTransaction, listRows, save } from "./repo";

/** Date arithmetic on YYYY-MM-DD strings in UTC, so no timezone surprises. */
export function addPeriod(day: string, freq: Frequency, interval: number): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  switch (freq) {
    case "daily": return iso(new Date(Date.UTC(y, m - 1, d + interval)));
    case "weekly": return iso(new Date(Date.UTC(y, m - 1, d + 7 * interval)));
    case "monthly": return clampDay(y, m - 1 + interval, d);
    case "yearly": return clampDay(y + interval, m - 1, d);
  }
}

function clampDay(y: number, monthIndex: number, d: number): string {
  const first = new Date(Date.UTC(y, monthIndex, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d, last));
  return iso(first);
}

function iso(dt: Date): string {
  return dt.toISOString().slice(0, 10);
}

type RuleLike = Pick<RecurringRule, "frequency" | "interval" | "next_date" | "end_date" | "active">;

/** Upcoming occurrence dates, starting at next_date, up to `count` or end_date. */
export function upcomingOccurrences(rule: RuleLike, count: number): string[] {
  if (!rule.active) return [];
  const out: string[] = [];
  let day = rule.next_date;
  while (out.length < count) {
    if (rule.end_date && day > rule.end_date) break;
    out.push(day);
    day = addPeriod(day, rule.frequency, rule.interval);
  }
  return out;
}

/** Occurrences with date <= today that have not been posted yet. */
export function dueOccurrences(rule: RuleLike, today: string): string[] {
  if (!rule.active) return [];
  const out: string[] = [];
  let day = rule.next_date;
  for (let guard = 0; guard < 1000 && day <= today; guard++) {
    if (rule.end_date && day > rule.end_date) break;
    out.push(day);
    day = addPeriod(day, rule.frequency, rule.interval);
  }
  return out;
}

export type PlannedKind = "reminder" | "due";
export interface PlannedNotification { rule_id: string; occurrence: string; fire_day: string; kind: PlannedKind }

/**
 * Local notification schedule for the next `horizonDays`, computed on device.
 * Each occurrence gets a "reminder" `notify_days_before` days earlier (when > 0) and a
 * "due" notification on the day itself: for automatic rules it says the transaction was
 * posted, for manual ones it asks to confirm.
 */
export function plannedNotifications(rules: RecurringRule[], today: string, horizonDays = 60): PlannedNotification[] {
  const horizon = addPeriod(today, "daily", horizonDays);
  const out: PlannedNotification[] = [];
  for (const r of rules) {
    if (!r.notify || !r.active || r.deleted) continue;
    for (const occ of upcomingOccurrences(r, 24)) {
      if (occ > horizon) break;
      if (r.notify_days_before > 0) {
        const fire = addPeriod(occ, "daily", -r.notify_days_before);
        if (fire >= today) out.push({ rule_id: r.id, occurrence: occ, fire_day: fire, kind: "reminder" });
      }
      if (occ >= today) out.push({ rule_id: r.id, occurrence: occ, fire_day: occ, kind: "due" });
    }
  }
  return out.sort((a, b) => a.fire_day.localeCompare(b.fire_day) || a.occurrence.localeCompare(b.occurrence));
}

/** Local ISO timestamp for a rule occurrence: day + time_of_day + the device offset. */
export function occurrenceTimestamp(day: string, timeOfDay: string, offsetMinutes = -new Date().getTimezoneOffset()): string {
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const a = Math.abs(offsetMinutes);
  const hh = String(Math.floor(a / 60)).padStart(2, "0"), mm = String(a % 60).padStart(2, "0");
  return `${day}T${/^\d{2}:\d{2}$/.test(timeOfDay) ? timeOfDay : "09:00"}:00${sign}${hh}:${mm}`;
}

/** Move next_date past `throughDay`. */
export function advanceRule(db: SqlDriver, rule: RecurringRule, throughDay: string): RecurringRule {
  let next = rule.next_date;
  while (next <= throughDay) next = addPeriod(next, rule.frequency, rule.interval);
  return save(db, "recurring_rules", { ...rule, next_date: next });
}

/** Post one occurrence of a rule as a transaction linked to it. */
export function postOccurrence(db: SqlDriver, rule: RecurringRule, day: string) {
  return createTransaction(db, {
    account_id: rule.account_id, date: occurrenceTimestamp(day, rule.time_of_day), amount_minor: rule.amount_minor,
    category_id: rule.category_id, payee: rule.payee, notes: rule.notes, tag_ids: rule.tag_ids, recurring_id: rule.id,
  });
}

/**
 * How many times a cadence fires in a year. Weekly is 365/7, not 52: over a year the extra
 * day or two is worth roughly a whole extra payment, and rounding it away understates a
 * weekly commitment by about 2%.
 */
export function occurrencesPerYear(freq: Frequency, interval: number): number {
  const per = freq === "daily" ? 365 : freq === "weekly" ? 365 / 7 : freq === "monthly" ? 12 : 1;
  return per / Math.max(1, interval);
}

/**
 * What a rule is worth over a year, in minor units, keeping its sign (expenses stay negative).
 * Normalising every cadence to a year is what makes a weekly language lesson and a yearly
 * insurance premium comparable in one total.
 */
export function yearlyAmountMinor(rule: Pick<RecurringRule, "amount_minor" | "frequency" | "interval">): number {
  return Math.round(rule.amount_minor * occurrencesPerYear(rule.frequency, rule.interval));
}

export interface DueRule { rule: RecurringRule; days: string[] }

/**
 * Manual rules with at least one occurrence already due — the queue behind the "Recurring due"
 * row on Transactions. Automatic rules never appear here: `postDueRecurring` has already written
 * them as real transactions, so there is nothing left to decide.
 */
export function dueManualRules(db: SqlDriver, today: string): DueRule[] {
  const out: DueRule[] = [];
  for (const rule of listRows(db, "recurring_rules", "deleted=0 AND active=1 AND auto_post=0", [], "next_date") as RecurringRule[]) {
    const days = dueOccurrences(rule, today);
    if (days.length) out.push({ rule, days });
  }
  return out;
}

export interface AutoPosted { rule: RecurringRule; days: string[] }

/** Post every due occurrence of auto_post rules (Budget Flow behaviour). Manual rules are left for the confirm sheet. */
export function postDueRecurring(db: SqlDriver, today: string): AutoPosted[] {
  const out: AutoPosted[] = [];
  db.transaction(() => {
    for (const rule of listRows(db, "recurring_rules", "deleted=0 AND active=1 AND auto_post=1") as RecurringRule[]) {
      const days = dueOccurrences(rule, today);
      if (!days.length) continue;
      for (const d of days) postOccurrence(db, rule, d);
      advanceRule(db, rule, days[days.length - 1]!);
      out.push({ rule, days });
    }
  });
  return out;
}

/** Budget period containing `day` for a budget that starts on `startDay` of each month. */
export function budgetPeriod(day: string, startDay = 1): { start: string; end: string } {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const clampStart = (yy: number, mi: number) => {
    const last = new Date(Date.UTC(yy, mi + 1, 0)).getUTCDate();
    const dt = new Date(Date.UTC(yy, mi, Math.min(startDay, last)));
    return dt.toISOString().slice(0, 10);
  };
  const thisMonth = clampStart(y, m - 1);
  const start = day >= thisMonth ? thisMonth : clampStart(y, m - 2);
  const [sy, sm] = start.split("-").map(Number) as [number, number];
  const end = clampStart(sy, sm); // next month's start (sm is 1-based, so sm as 0-based index = next month)
  return { start, end };
}
