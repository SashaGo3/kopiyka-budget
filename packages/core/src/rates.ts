import type { SqlDriver } from "./db";
import { nowMs } from "./db";

/**
 * Exchange rates from Frankfurter (ECB data, free, no key). Only called when a
 * transfer crosses currencies. Cached per day in the local DB.
 * rate = how many `quote` units per 1 `base` unit.
 */
export const FRANKFURTER = "https://api.frankfurter.dev/v1";

export function todayIso(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export function cachedRate(db: SqlDriver, base: string, quote: string, day: string): number | null {
  if (base === quote) return 1;
  const r = db.get<{ rate: number }>(`SELECT rate FROM exchange_rates WHERE base=? AND quote=? AND day=?`, [base, quote, day]);
  if (r) return r.rate;
  const inv = db.get<{ rate: number }>(`SELECT rate FROM exchange_rates WHERE base=? AND quote=? AND day=?`, [quote, base, day]);
  return inv ? 1 / inv.rate : null;
}

/** Most recent cached rate regardless of day, for offline fallback. */
export function latestCachedRate(db: SqlDriver, base: string, quote: string): { rate: number; day: string } | null {
  if (base === quote) return { rate: 1, day: todayIso() };
  const r = db.get<{ rate: number; day: string }>(`SELECT rate, day FROM exchange_rates WHERE base=? AND quote=? ORDER BY day DESC LIMIT 1`, [base, quote]);
  if (r) return r;
  const inv = db.get<{ rate: number; day: string }>(`SELECT rate, day FROM exchange_rates WHERE base=? AND quote=? ORDER BY day DESC LIMIT 1`, [quote, base]);
  return inv ? { rate: 1 / inv.rate, day: inv.day } : null;
}

export async function fetchRate(db: SqlDriver, base: string, quote: string, day = "latest", fetchFn: typeof fetch = fetch): Promise<number> {
  const b = base.toUpperCase(), q = quote.toUpperCase();
  if (b === q) return 1;
  const cacheDay = day === "latest" ? todayIso() : day;
  const cached = cachedRate(db, b, q, cacheDay);
  if (cached !== null) return cached;
  const res = await fetchFn(`${FRANKFURTER}/${day}?base=${b}&symbols=${q}`);
  if (!res.ok) throw new Error(`rates ${res.status}`);
  const json = (await res.json()) as { date: string; rates: Record<string, number> };
  const rate = json.rates[q];
  if (typeof rate !== "number") throw new Error(`no rate ${b}/${q}`);
  db.run(`INSERT OR REPLACE INTO exchange_rates(base, quote, day, rate, fetched_at) VALUES (?,?,?,?,?)`,
    [b, q, cacheDay, rate, nowMs()]);
  return rate;
}

/** Rate with graceful offline fallback to the newest cached value; null if nothing is known. */
export async function rateOrFallback(db: SqlDriver, base: string, quote: string, fetchFn: typeof fetch = fetch): Promise<{ rate: number; stale: boolean } | null> {
  try {
    return { rate: await fetchRate(db, base, quote, "latest", fetchFn), stale: false };
  } catch {
    const c = latestCachedRate(db, base, quote);
    return c ? { rate: c.rate, stale: c.day !== todayIso() } : null;
  }
}
