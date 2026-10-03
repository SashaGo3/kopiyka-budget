/**
 * Travel mode. A trip is a one-off budget for a tag: `period = "once"`, `tag_id` set,
 * `ended = null` while the mode is on. Being a plain row in the shared database, the
 * watch and Shortcuts see the same trip as the phone; finished trips stay as history.
 * Every expense carrying the tag counts, whatever the account or date (flights booked
 * earlier and tagged by hand count too); other currencies convert with cached rates.
 */
import type { SqlDriver } from "./db";
import { KopiykaError } from "./errors";
import type { Budget, Tag } from "./models";
import { convertMinor } from "./money";
import { latestCachedRate } from "./rates";
import { createBudget, createTag, getRow, jsonIds, listRows, save, tagIdsOf, tagSpend } from "./repo";

export const TRIP_WHERE = "deleted=0 AND period='once' AND tag_id IS NOT NULL";

/** The trip travel mode is currently on for, if any (never more than one). */
export function activeTrip(db: SqlDriver): Budget | null {
  return listRows(db, "budgets", `${TRIP_WHERE} AND ended IS NULL`, [], "starts DESC, rowid DESC")[0] ?? null;
}

/** All trips, newest first (the active one included). */
export function listTrips(db: SqlDriver): Budget[] {
  return listRows(db, "budgets", TRIP_WHERE, [], "starts DESC, rowid DESC");
}

/**
 * Every tag a trip was ever run on. What carries one of these is the trip's money, not the month's:
 * the ordinary budgets leave it out (`budgetRows`), and the Spending list shows it as a group of its
 * own, so a week away does not read as a month of overspending on food and taxis.
 */
export function tripTagIds(db: SqlDriver): string[] {
  return db.all<{ tag_id: string }>(`SELECT DISTINCT tag_id FROM budgets WHERE ${TRIP_WHERE}`).map((r) => r.tag_id);
}

/** Id of the tag new expenses should carry while travel mode is on, else null. Cheap: one indexed-size query. */
export function activeTripTagId(db: SqlDriver): string | null {
  return activeTrip(db)?.tag_id ?? null;
}

/** Add the active trip's tag to a tag list (no-op when travel mode is off or the tag is already there). */
export function withTripTag(db: SqlDriver, tagIds: string[]): string[] {
  const t = activeTripTagId(db);
  return t && !tagIds.includes(t) ? [...tagIds, t] : tagIds;
}

export interface StartTrip {
  name: string;
  currency: string;
  amount_minor: number;
  /** YYYY-MM-DD; defaults to today. */
  starts?: string;
  /** Planned last day, YYYY-MM-DD (inclusive). */
  ends: string;
  today?: string;
}

/**
 * Turn travel mode on: reuse a tag with that name (case-insensitive) or create one, then
 * create the one-off budget. Fails when a trip is already running.
 */
export function startTrip(db: SqlDriver, p: StartTrip): { budget: Budget; tag: Tag } {
  if (activeTrip(db)) throw new KopiykaError("trip_running", "Travel mode is already on");
  const name = p.name.trim();
  if (!name) throw new KopiykaError("trip_name_required", "Name required");
  return db.transaction(() => {
    const tag = listRows(db, "tags", "deleted=0 AND lower(name)=lower(?)", [name])[0] ?? createTag(db, { name, color: "#0A84FF" });
    const starts = p.starts ?? todayLocalDay(p.today);
    const budget = createBudget(db, { tag_id: tag.id, period: "once", currency: p.currency, amount_minor: p.amount_minor, starts, ends: p.ends < starts ? starts : p.ends, account_id: null, category_id: null });
    return { budget, tag };
  });
}

export interface PastTrip { name: string; currency: string; amount_minor: number; starts: string; ends: string }

/**
 * Record a trip that has already happened: the same tag and one-off budget `startTrip` makes, born
 * ended on its last day. It never touches the running one — a trip in the past is history, and
 * there can be any number of those alongside the one travel mode is on for.
 */
export function addPastTrip(db: SqlDriver, p: PastTrip): { budget: Budget; tag: Tag } {
  const name = p.name.trim();
  if (!name) throw new KopiykaError("trip_name_required", "Name required");
  const ends = p.ends < p.starts ? p.starts : p.ends;
  return db.transaction(() => {
    const tag = listRows(db, "tags", "deleted=0 AND lower(name)=lower(?)", [name])[0] ?? createTag(db, { name, color: "#0A84FF" });
    const budget = createBudget(db, { tag_id: tag.id, period: "once", currency: p.currency, amount_minor: p.amount_minor, starts: p.starts, ends, ended: ends, account_id: null, category_id: null });
    return { budget, tag };
  });
}

/** Turn travel mode off: the trip keeps its tag and budget as history. */
export function endTrip(db: SqlDriver, budgetId: string, day = todayLocalDay()): Budget {
  const b = getRow(db, "budgets", budgetId);
  if (!b) throw new KopiykaError("trip_not_found", "Travel not found");
  return save(db, "budgets", { ...b, ended: day < b.starts ? b.starts : day });
}

/** Tag some existing transactions with the trip tag (flights, hotels booked before departure). Transfers and recurring payments are skipped. */
export function tagTransactions(db: SqlDriver, tagId: string, txIds: string[]): number {
  let n = 0;
  db.transaction(() => {
    for (const id of txIds) {
      const t = getRow(db, "transactions", id);
      if (!t || t.deleted || t.transfer_id || t.recurring_id) continue;
      const ids = tagIdsOf(t);
      if (ids.includes(tagId)) continue;
      save(db, "transactions", { ...t, tag_ids: JSON.stringify([...ids, tagId]) });
      n++;
    }
  });
  return n;
}

export interface TripStats {
  budget: Budget;
  tag: Tag | null;
  /** The trip's tag's name; null when the tag is gone, and the app names it in its own language. */
  name: string | null;
  currency: string;
  limit_minor: number;
  /** What counts against the budget, converted into its currency where a rate is cached. */
  spent_minor: number;
  /** The trip's payments chosen to stay outside its budget (`outside_ids`), converted; not in `spent_minor`. */
  outside_minor: number;
  remaining_minor: number;
  /** Spend in currencies with no cached rate to the budget currency (not part of spent_minor). */
  unconverted: { currency: string; minor: number }[];
  /** Per category (converted), largest first. */
  by_category: { category_id: string | null; spent_minor: number }[];
  /** Day 1 is `starts`; capped to the planned length once the trip is over. */
  day: number;
  /** Planned length in days (starts..ends inclusive). */
  days: number;
  /** Days still to come including today, 0 once the trip is over or ended. */
  days_left: number;
  /** Average spent per elapsed day. */
  per_day_minor: number;
  /** What is left per remaining day; null once the trip is over. */
  allowance_minor: number | null;
  active: boolean;
  over: boolean;
}

/** Rate lookup from the exchange_rates cache (the app fills it while online); null when unknown. */
export function cachedRateFor(db: SqlDriver): (from: string, to: string) => number | null {
  const memo = new Map<string, number | null>();
  return (from, to) => {
    if (from === to) return 1;
    const k = `${from}>${to}`;
    if (!memo.has(k)) memo.set(k, latestCachedRate(db, from, to)?.rate ?? null);
    return memo.get(k) ?? null;
  };
}

export function tripStats(db: SqlDriver, b: Budget, o: { today?: string; rateFor?: (from: string, to: string) => number | null } = {}): TripStats {
  const today = o.today ?? todayLocalDay();
  const rateFor = o.rateFor ?? cachedRateFor(db);
  const tag = b.tag_id ? getRow(db, "tags", b.tag_id) ?? null : null;
  const byCat = new Map<string | null, number>();
  const unconverted = new Map<string, number>();
  let spent = 0, during = 0, outside = 0;
  // Recurring payments are left out: rent and subscriptions go on at home whether or not you are
  // away, and a charge that arrived during the trip is not something the trip bought.
  const convert = (currency: string, minor: number): number | null => {
    const rate = rateFor(currency, b.currency);
    if (rate == null) { unconverted.set(currency, (unconverted.get(currency) ?? 0) - minor); return null; }
    return -convertMinor(minor, currency, b.currency, rate);
  };
  if (b.tag_id) {
    for (const s of tagSpend(db, b.tag_id, { oneOff: true })) {
      const minor = convert(s.currency, s.spent_minor);
      if (minor === null) continue;
      spent += minor;
      byCat.set(s.category_id, (byCat.get(s.category_id) ?? 0) + minor);
    }
    for (const s of tagSpend(db, b.tag_id, { oneOff: true, fromIso: b.starts })) {
      const minor = convert(s.currency, s.spent_minor);
      if (minor !== null) during += minor; else unconverted.set(s.currency, (unconverted.get(s.currency) ?? 0) + s.spent_minor); // counted once above
    }
    // What was chosen to stay outside the budget comes back out of it — and out of the pace when it
    // fell inside the trip's days — but stays the trip's, as `outside_minor`.
    const ids = jsonIds(b.outside_ids);
    if (ids.length) {
      const rows = db.all<{ category_id: string | null; currency: string; amount_minor: number; date: string }>(
        `SELECT t.category_id, a.currency, t.amount_minor, t.date FROM transactions t JOIN accounts a ON a.id=t.account_id
         WHERE t.deleted=0 AND t.transfer_id IS NULL AND t.recurring_id IS NULL AND t.amount_minor<0 AND t.tag_ids LIKE ? AND t.id IN (${ids.map(() => "?").join(",")})`,
        [`%"${b.tag_id}"%`, ...ids]);
      for (const r of rows) {
        const rate = rateFor(r.currency, b.currency);
        if (rate == null) { unconverted.set(r.currency, (unconverted.get(r.currency) ?? 0) + r.amount_minor); continue; }
        const minor = -convertMinor(r.amount_minor, r.currency, b.currency, rate);
        spent -= minor; outside += minor;
        if (r.date >= b.starts) during -= minor;
        const left = (byCat.get(r.category_id) ?? 0) - minor;
        if (left > 0) byCat.set(r.category_id, left); else byCat.delete(r.category_id);
      }
    }
  }
  for (const [k, v] of unconverted) if (!v) unconverted.delete(k);
  const ends = b.ends ?? b.starts;
  const last = b.ended && b.ended < ends ? b.ended : ends;
  const days = Math.max(1, daysBetween(b.starts, last) + 1);
  const active = b.ended == null;
  const cur = active ? today : b.ended!;
  const day = Math.max(1, Math.min(days, daysBetween(b.starts, cur) + 1));
  const elapsed = Math.max(1, daysBetween(b.starts, cur) + 1);
  const daysLeft = active && today <= ends ? daysBetween(today, ends) + 1 : 0;
  const remaining = b.amount_minor - spent;
  return {
    budget: b, tag, name: tag?.name ?? null, currency: b.currency, limit_minor: b.amount_minor, spent_minor: spent, remaining_minor: remaining,
    outside_minor: outside,
    unconverted: [...unconverted].map(([currency, minor]) => ({ currency, minor })),
    by_category: [...byCat].map(([category_id, spent_minor]) => ({ category_id, spent_minor })).sort((x, y) => y.spent_minor - x.spent_minor),
    // The pace is what the days cost: what was paid before them is not spread over them.
    day, days, days_left: daysLeft, per_day_minor: Math.round(during / elapsed),
    allowance_minor: daysLeft > 0 ? Math.round(remaining / daysLeft) : null,
    active, over: spent > b.amount_minor,
  };
}

/** Whole days from a to b (YYYY-MM-DD), negative when b is earlier. */
export function daysBetween(a: string, b: string): number {
  const d = (s: string) => { const [y, m, dd] = s.split("-").map(Number) as [number, number, number]; return Date.UTC(y, m - 1, dd); };
  return Math.round((d(b) - d(a)) / 86_400_000);
}

/** Today as YYYY-MM-DD in local time (or the given date). */
export function todayLocalDay(d: Date | string = new Date()): string {
  if (typeof d === "string") return d;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The planned last day offered when starting a trip: the same day. A trip is as long as you say it is. */
export function defaultTripEnd(starts: string): string { return starts; }
