import type { SqlDriver } from "./db";
import { nowMs } from "./db";
import type { Transaction } from "./models";
import { fromMinor, toMinor } from "./money";
import { getRow, save } from "./repo";

/**
 * Exchange rates from Frankfurter (ECB data, free, no key). Only called when a
 * transfer crosses currencies. Cached per day in the local DB.
 * rate = how many `quote` units per 1 `base` unit.
 */
export const FRANKFURTER = "https://api.frankfurter.dev/v1";
/**
 * The Polish central bank's table A: every currency's mid rate in złoty, UAH among them. Frankfurter
 * (the ECB) has never published the hryvnia, so a card charge in Kyiv could not be converted at all.
 * Asked only for a pair Frankfurter does not know.
 */
export const NBP = "https://api.nbp.pl/api/exchangerates/rates/a";

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
  let rate: number;
  try {
    rate = await frankfurter(b, q, day, fetchFn);
  } catch (e) {
    // Through złoty: both sides' mid rates from the same table.
    try { rate = (await nbpMid(b, day, fetchFn)) / (await nbpMid(q, day, fetchFn)); } catch { throw e; }
  }
  db.run(`INSERT OR REPLACE INTO exchange_rates(base, quote, day, rate, fetched_at) VALUES (?,?,?,?,?)`,
    [b, q, cacheDay, rate, nowMs()]);
  return rate;
}

async function frankfurter(b: string, q: string, day: string, fetchFn: typeof fetch): Promise<number> {
  const res = await fetchFn(`${FRANKFURTER}/${day}?base=${b}&symbols=${q}`);
  if (!res.ok) throw new Error(`rates ${res.status}`);
  const json = (await res.json()) as { rates?: Record<string, number> };
  const rate = json.rates?.[q];
  if (typeof rate !== "number") throw new Error(`no rate ${b}/${q}`);
  return rate;
}

/** Złoty per one unit of `code` on `day` or the last table before it (none is published at weekends). */
async function nbpMid(code: string, day: string, fetchFn: typeof fetch): Promise<number> {
  if (code === "PLN") return 1;
  const c = code.toLowerCase();
  const from = day === "latest" ? null : new Date(Date.parse(`${day}T00:00:00Z`) - 7 * 86_400_000).toISOString().slice(0, 10);
  const res = await fetchFn(from ? `${NBP}/${c}/${from}/${day}/?format=json` : `${NBP}/${c}/last/1/?format=json`);
  if (!res.ok) throw new Error(`nbp ${res.status}`);
  const json = (await res.json()) as { rates?: { mid?: number }[] };
  const mid = json.rates?.at(-1)?.mid;
  if (typeof mid !== "number" || mid <= 0) throw new Error(`no nbp rate ${code}`);
  return mid;
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

/**
 * A foreign charge the notification automation logged at **0** because no rate was cached (DATA.md
 * rule 6) is converted here once a rate can be had: at the rate of the payment's own day, into the
 * account's currency, with the sign of the bank's original. Only rows still pending — a zero cannot
 * be saved from the sheet, so anything else was settled by hand. The automation's own "no exchange
 * rate" words are taken off the bank's text (they were never the bank's); the original amount stays.
 * Returns how many rows it wrote.
 */
export async function convertWaitingCharges(db: SqlDriver, today: string, fetchFn: typeof fetch = fetch): Promise<number> {
  const rows = db.all<{ id: string; day: string; acc: string }>(
    `SELECT t.id, substr(t.date, 1, 10) AS day, a.currency AS acc FROM transactions t JOIN accounts a ON a.id = t.account_id
     WHERE t.deleted=0 AND t.pending=1 AND t.amount_minor=0 AND t.transfer_id IS NULL AND t.exchange_rate IS NULL
       AND t.entered_amount_minor IS NOT NULL AND t.entered_amount_minor<>0 AND t.entered_currency IS NOT NULL AND t.entered_currency<>a.currency`);
  let wrote = 0;
  for (const r of rows) {
    const tx = getRow(db, "transactions", r.id);
    if (!tx || !tx.entered_currency || !tx.entered_amount_minor) continue;
    let rate: number;
    try { rate = await fetchRate(db, tx.entered_currency, r.acc, r.day < today ? r.day : "latest", fetchFn); } catch { continue; }
    // Read again: the person may have typed an amount while the rate was on its way.
    const now = getRow(db, "transactions", r.id);
    if (!now || now.deleted || now.amount_minor !== 0 || !now.pending) continue;
    const amount = toMinor(fromMinor(now.entered_amount_minor!, now.entered_currency!) * rate, r.acc);
    if (amount === 0) continue;
    save(db, "transactions", { ...now, amount_minor: amount, exchange_rate: rate, bank_note: withoutNoRate(now.bank_note, now.entered_currency!) } as Transaction);
    wrote++;
  }
  return wrote;
}

/** "… · 2 272,61 UAH — no exchange rate, set the amount" → "… · 2 272,61 UAH", in any language. */
export function withoutNoRate(bankNote: string | null, currency: string): string | null {
  if (!bankNote) return bankNote;
  const parts = bankNote.split(" · ");
  const last = parts[parts.length - 1]!;
  const i = last.indexOf(" — ");
  if (i < 0 || !last.slice(0, i).includes(currency)) return bankNote;
  parts[parts.length - 1] = last.slice(0, i);
  return parts.join(" · ");
}
