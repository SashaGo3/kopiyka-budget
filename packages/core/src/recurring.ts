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

/**
 * Occurrence dates falling in `[from, to)`. `upcomingOccurrences` is bounded by a *count*, which is
 * the wrong bound for "what is still to be charged before payday": a weekly rule needs five and a
 * yearly one needs none, so any count that covers both generates dozens and throws most away.
 *
 * It starts at `next_date`, and `next_date` is what says an occurrence has not been dealt with yet
 * — posting advances it, and so does a real charge claiming it (`claimRecurring` → `advanceRule`,
 * DATA.md rule 13). So everything this returns has genuinely not happened, including an occurrence
 * that is already overdue: that is money still to leave, and it belongs in the window it was due in
 * rather than nowhere.
 */
export function occurrencesBetween(rule: RuleLike, from: string, to: string, guard = 500): string[] {
  if (!rule.active) return [];
  const out: string[] = [];
  let day = rule.next_date;
  for (let i = 0; i < guard && day < to; i++) {
    if (rule.end_date && day > rule.end_date) break;
    if (day >= from) out.push(day);
    const next = addPeriod(day, rule.frequency, rule.interval);
    if (next <= day) break; // a rule with no interval would otherwise never finish
    day = next;
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

/**
 * Default number of days a rule waits for the bank's own charge, when waiting is on and the rule
 * itself names no window. A week covers a standing order that slips over a weekend or a bank holiday
 * without leaving a payment unaccounted for long enough to be forgotten.
 */
export const DEFAULT_WAIT_DAYS = 7;

/**
 * How many days *early* a charge may be and still be this occurrence. Standing orders are routinely
 * taken on the last working day before the date they name, so a payment due on the 1st can land on
 * the Friday before it.
 */
export const CLAIM_LEAD_DAYS = 3;

/**
 * How long this rule waits for the real charge: its own `wait_days`, else the app-wide default.
 *
 * `waitDefault` is 0 when waiting is switched off, and that is the only way to get 0 out of here:
 * a rule may ask for a longer or shorter rope than the default, never for none, so a stored 0 (or
 * anything else that is not a whole day or more) falls back to the default rather than quietly
 * opting one rule out of the feature. 0 means the rule posts, or asks, on the day — what every rule
 * did before waiting existed.
 */
export function ruleWaitDays(rule: Pick<RecurringRule, "wait_days">, waitDefault: number): number {
  if (!(waitDefault > 0)) return 0;
  const d = rule.wait_days ?? waitDefault;
  return Number.isFinite(d) && d >= 1 ? Math.floor(d) : Math.floor(waitDefault);
}

/** The last day an occurrence can still be claimed by a real charge. */
export function claimDeadline(occurrence: string, wait: number): string {
  return addPeriod(occurrence, "daily", wait);
}

/**
 * Is this occurrence now the rule's to act on? A rule that does not wait owns it the moment the day
 * arrives; one that waits gives the charge the whole window and acts the day after it closes.
 */
export function isOwed(occurrence: string, today: string, wait: number): boolean {
  return wait <= 0 ? occurrence <= today : claimDeadline(occurrence, wait) < today;
}

/** Due occurrences the rule may now act on itself — post (automatic) or ask about (manual). */
export function overdueOccurrences(rule: RuleLike & Pick<RecurringRule, "wait_days">, today: string, waitDefault = 0): string[] {
  const wait = ruleWaitDays(rule, waitDefault);
  return dueOccurrences(rule, today).filter((occ) => isOwed(occ, today, wait));
}

/** Due occurrences still inside their window: the charge has not arrived, and nothing is owed yet. */
export function waitingOccurrences(rule: RuleLike & Pick<RecurringRule, "wait_days">, today: string, waitDefault = 0): string[] {
  const wait = ruleWaitDays(rule, waitDefault);
  return wait <= 0 ? [] : dueOccurrences(rule, today).filter((occ) => !isOwed(occ, today, wait));
}

/**
 * `reminder` — `notify_days_before` days ahead of the occurrence.
 * `due` — on the day: the transaction was posted (automatic) or is waiting to be confirmed (manual).
 * `late` — what `due` becomes for a rule that waits: it fires when the window closes, and says the
 * charge never turned up, because on the day itself there is nothing to tell you yet.
 */
export type PlannedKind = "reminder" | "due" | "late";
export interface PlannedNotification { rule_id: string; occurrence: string; fire_day: string; kind: PlannedKind }

/**
 * Local notification schedule for the next `horizonDays`, computed on device.
 * Each occurrence gets a "reminder" `notify_days_before` days earlier (when > 0) and one on the day
 * itself: for automatic rules it says the transaction was posted, for manual ones it asks to confirm.
 *
 * A rule that waits for the bank says neither of those on the day — it does not know yet whether the
 * charge is coming — so its second notification moves to the day the window closes and becomes
 * "late": by then the charge has either claimed the occurrence, and there is nothing to send, or it
 * never arrived and that is the news.
 */
export function plannedNotifications(rules: RecurringRule[], today: string, horizonDays = 60, waitDefault = 0): PlannedNotification[] {
  const horizon = addPeriod(today, "daily", horizonDays);
  const out: PlannedNotification[] = [];
  for (const r of rules) {
    if (!r.notify || !r.active || r.deleted) continue;
    const wait = ruleWaitDays(r, waitDefault);
    for (const occ of upcomingOccurrences(r, 24)) {
      if (occ > horizon) break;
      if (r.notify_days_before > 0) {
        const fire = addPeriod(occ, "daily", -r.notify_days_before);
        if (fire >= today) out.push({ rule_id: r.id, occurrence: occ, fire_day: fire, kind: "reminder" });
      }
      const day = wait > 0 ? addPeriod(claimDeadline(occ, wait), "daily", 1) : occ;
      if (day >= today && day <= horizon) out.push({ rule_id: r.id, occurrence: occ, fire_day: day, kind: wait > 0 ? "late" : "due" });
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
 * Manual rules with at least one occurrence that is now owed — the queue behind the "Recurring due"
 * row on Transactions. Automatic rules never appear here: `postDueRecurring` has already written
 * them as real transactions, so there is nothing left to decide.
 *
 * A rule that waits for the bank only reaches the queue once its window has closed. Inside the
 * window there is nothing to ask: the charge may still arrive and claim the occurrence by itself,
 * and asking first is how you end up posting it twice.
 */
export function dueManualRules(db: SqlDriver, today: string, waitDefault = 0): DueRule[] {
  const out: DueRule[] = [];
  for (const rule of listRows(db, "recurring_rules", "deleted=0 AND active=1 AND auto_post=0", [], "next_date") as RecurringRule[]) {
    const days = overdueOccurrences(rule, today, waitDefault);
    if (days.length) out.push({ rule, days });
  }
  return out;
}

/** Rules whose day has come and which are now waiting to see whether the bank charges them. */
export function waitingRules(db: SqlDriver, today: string, waitDefault = 0): DueRule[] {
  const out: DueRule[] = [];
  for (const rule of listRows(db, "recurring_rules", "deleted=0 AND active=1", [], "next_date") as RecurringRule[]) {
    const days = waitingOccurrences(rule, today, waitDefault);
    if (days.length) out.push({ rule, days });
  }
  return out;
}

export interface AutoPosted { rule: RecurringRule; days: string[]; waited: boolean }

/**
 * Post every occurrence of an auto_post rule that is now owed. Manual rules are left for the confirm
 * sheet. A rule that waits for the bank posts only once its window has closed without a charge
 * claiming the occurrence — `waited` says so, because "we never saw this leave your account, so here
 * is what the rule says" is a different thing to tell the user than "posted, as arranged".
 */
export function postDueRecurring(db: SqlDriver, today: string, waitDefault = 0): AutoPosted[] {
  const out: AutoPosted[] = [];
  db.transaction(() => {
    for (const rule of listRows(db, "recurring_rules", "deleted=0 AND active=1 AND auto_post=1") as RecurringRule[]) {
      const days = overdueOccurrences(rule, today, waitDefault);
      if (!days.length) continue;
      for (const d of days) postOccurrence(db, rule, d);
      advanceRule(db, rule, days[days.length - 1]!);
      out.push({ rule, days, waited: ruleWaitDays(rule, waitDefault) > 0 });
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
