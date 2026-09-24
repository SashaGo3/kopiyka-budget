/**
 * Travel mode. A trip is a one-off budget for a tag: `period = "once"`, `tag_id` set,
 * `ended = null` while the mode is on. Being a plain row in the shared database, the
 * watch and Shortcuts see the same trip as the phone; finished trips stay as history.
 * Every expense carrying the tag counts, whatever the account or date (flights booked
 * earlier and tagged by hand count too); other currencies convert with cached rates.
 */
import type { SqlDriver } from "./db";
import type { Budget, Tag } from "./models";
import { convertMinor } from "./money";
import { latestCachedRate } from "./rates";
import { createBudget, createTag, getRow, listRows, save, tagIdsOf, tagSpend } from "./repo";
import { addPeriod } from "./recurring";

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
  if (activeTrip(db)) throw new Error("Travel mode is already on");
  const name = p.name.trim();
  if (!name) throw new Error("Name required");
  return db.transaction(() => {
    const tag = listRows(db, "tags", "deleted=0 AND lower(name)=lower(?)", [name])[0] ?? createTag(db, { name, color: "#0A84FF" });
    const starts = p.starts ?? todayLocalDay(p.today);
    const budget = createBudget(db, { tag_id: tag.id, period: "once", currency: p.currency, amount_minor: p.amount_minor, starts, ends: p.ends < starts ? starts : p.ends, account_id: null, category_id: null });
    return { budget, tag };
  });
}

/** Turn travel mode off: the trip keeps its tag and budget as history. */
export function endTrip(db: SqlDriver, budgetId: string, day = todayLocalDay()): Budget {
  const b = getRow(db, "budgets", budgetId);
  if (!b) throw new Error("Travel not found");
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
  name: string;
  currency: string;
  limit_minor: number;
  /** Everything with the tag, converted into the budget currency where a rate is cached. */
  spent_minor: number;
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
  let spent = 0;
  // Recurring payments are left out: rent and subscriptions go on at home whether or not you are
  // away, and a charge that arrived during the trip is not something the trip bought.
  for (const s of b.tag_id ? tagSpend(db, b.tag_id, { oneOff: true }) : []) {
    const rate = rateFor(s.currency, b.currency);
    if (rate == null) { unconverted.set(s.currency, (unconverted.get(s.currency) ?? 0) - s.spent_minor); continue; }
    const minor = -convertMinor(s.spent_minor, s.currency, b.currency, rate);
    spent += minor;
    byCat.set(s.category_id, (byCat.get(s.category_id) ?? 0) + minor);
  }
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
    budget: b, tag, name: tag?.name ?? "Travel", currency: b.currency, limit_minor: b.amount_minor, spent_minor: spent, remaining_minor: remaining,
    unconverted: [...unconverted].map(([currency, minor]) => ({ currency, minor })),
    by_category: [...byCat].map(([category_id, spent_minor]) => ({ category_id, spent_minor })).sort((x, y) => y.spent_minor - x.spent_minor),
    day, days, days_left: daysLeft, per_day_minor: Math.round(spent / elapsed),
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

/** A week from a day, the default planned length offered when starting a trip. */
export function defaultTripEnd(starts: string): string { return addPeriod(starts, "daily", 6); }
