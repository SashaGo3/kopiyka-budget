/**
 * Four cards about where this period's money went, beside the ones in insights.ts: how each folder
 * compares with its usual, the biggest one-off purchases, the shops it went to, and the places on a
 * map. Pure functions over the database like the rest; amounts are minor units, spend positive.
 *
 * Each answers per currency — an account's currency is the only one its amounts are in (DATA.md
 * rule 6), and adding złoty to hryvnias is not a total — and, like every other spending figure,
 * leaves transfers out.
 */
import type { SqlDriver } from "./db";
import type { Category } from "./models";
import { categorySpend, distanceMeters, listRows, placeKey } from "./repo";
import { shopTerms } from "./shops";
import { addPeriod, budgetPeriod } from "./recurring";
import { tripTagIds } from "./trips";
import { normalizeName } from "./logos";
import { isMethodWord } from "./payee";

function dayDiff(a: string, b: string): number {
  const [ya, ma, da] = a.slice(0, 10).split("-").map(Number) as [number, number, number];
  const [yb, mb, db] = b.slice(0, 10).split("-").map(Number) as [number, number, number];
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86_400_000);
}

/**
 * The window of a period worth comparing, and the same stretch of the periods before it. A period
 * still running is compared day for day — the first ten days of this month against the first ten of
 * the last three — or the 10th of the month would always look frugal next to whole months.
 */
export function comparableWindows(o: { start: string; end: string; today: string; startDay: number; count: number }): { now: { start: string; end: string }; before: { start: string; end: string }[]; partial: boolean; days: number } {
  const length = dayDiff(o.start, o.end);
  const elapsed = Math.max(1, Math.min(length, dayDiff(o.start, o.today) + 1));
  const partial = elapsed < length;
  const before: { start: string; end: string }[] = [];
  let start = o.start;
  for (let i = 0; i < o.count; i++) {
    const prev = budgetPeriod(addPeriod(start, "daily", -1), o.startDay);
    const cut = addPeriod(prev.start, "daily", elapsed);
    before.push({ start: prev.start, end: partial && cut < prev.end ? cut : prev.end });
    start = prev.start;
  }
  return { now: { start: o.start, end: partial ? addPeriod(o.start, "daily", elapsed) : o.end }, before, partial, days: elapsed };
}

/* ── Month vs usual ──────────────────────────────────────────────────────────────────────────── */

export interface UsualLine {
  /** The folder, or a category with no folder: lines are per folder, so "Food" and not each shop of it. */
  category_id: string;
  now_minor: number;
  /** Mean over the periods before, zero periods included — the same mean `suggestBudget` takes. */
  usual_minor: number;
  diff_minor: number;
  /** `diff / usual`, or null when there was no usual to compare with (new spending). */
  ratio: number | null;
}
export interface MonthVsUsual { currency: string; now_minor: number; usual_minor: number; lines: UsualLine[]; partial: boolean; days: number; periods: number }

/**
 * This period against the usual, per folder: what moved, and by how much. "Usual" is the mean of the
 * `periods` periods before (three, as the budget suggestion takes), measured as budgets are — without
 * what trips paid for — and day for day while the period is still running (`comparableWindows`).
 * Uncategorised spending is in the totals but has no line: there is nothing to name it by. Lines
 * come biggest change first, either way.
 */
export function monthVsUsual(db: SqlDriver, o: { start: string; end: string; today: string; startDay: number; accountIds?: string[]; periods?: number }): MonthVsUsual[] {
  const n = o.periods ?? 3;
  const w = comparableWindows({ ...o, count: n });
  const cats = new Map((listRows(db, "categories", "1=1") as Category[]).map((c) => [c.id, c]));
  const top = (id: string | null) => { if (!id) return null; const c = cats.get(id); return c?.parent_id && cats.has(c.parent_id) ? c.parent_id : id; };
  const trips = tripTagIds(db);
  const sum = (win: { start: string; end: string }) => {
    const out = new Map<string, Map<string | null, number>>();
    for (const s of categorySpend(db, win.start, win.end, o.accountIds, { exceptTags: trips })) {
      const m = out.get(s.currency) ?? new Map<string | null, number>();
      const k = top(s.category_id);
      m.set(k, (m.get(k) ?? 0) - s.spent_minor);
      out.set(s.currency, m);
    }
    return out;
  };
  const now = sum(w.now);
  const before = w.before.map(sum);
  const currencies = new Set([...now.keys(), ...before.flatMap((b) => [...b.keys()])]);
  const out: MonthVsUsual[] = [];
  for (const currency of currencies) {
    const here = now.get(currency) ?? new Map<string | null, number>();
    const keys = new Set<string | null>([...here.keys(), ...before.flatMap((b) => [...(b.get(currency)?.keys() ?? [])])]);
    const usualOf = (k: string | null) => Math.round(before.reduce((a, b) => a + (b.get(currency)?.get(k) ?? 0), 0) / n);
    let nowTotal = 0, usualTotal = 0;
    const lines: UsualLine[] = [];
    for (const k of keys) {
      const nowMinor = here.get(k) ?? 0, usual = usualOf(k);
      nowTotal += nowMinor; usualTotal += usual;
      if (k === null || (!nowMinor && !usual)) continue;
      lines.push({ category_id: k, now_minor: nowMinor, usual_minor: usual, diff_minor: nowMinor - usual, ratio: usual ? (nowMinor - usual) / usual : null });
    }
    if (!nowTotal && !usualTotal) continue;
    lines.sort((a, b) => Math.abs(b.diff_minor) - Math.abs(a.diff_minor));
    out.push({ currency, now_minor: nowTotal, usual_minor: usualTotal, lines, partial: w.partial, days: w.days, periods: n });
  }
  return out.sort((a, b) => b.now_minor - a.now_minor);
}

/* ── Biggest one-offs ────────────────────────────────────────────────────────────────────────── */

export type OneOff = { id: string; date: string; amount_minor: number; currency: string; category_id: string | null; payee: string | null; notes: string | null; bank_note: string | null };

/**
 * The biggest single purchases of the period that nothing schedules: no recurring rule posted or
 * claimed them (rent and subscriptions are known already, and would top this every month), they are
 * not a transfer, and not a payment towards a debt (rule 19 — paying back is not buying). Per
 * currency, most spent first; `limit` of each.
 */
export function biggestOneOffs(db: SqlDriver, o: { start: string; end: string; accountIds?: string[]; limit?: number }): { currency: string; rows: OneOff[] }[] {
  const scope = o.accountIds?.length ? ` AND t.account_id IN (${o.accountIds.map(() => "?").join(",")})` : "";
  const rows = db.all<OneOff>(
    `SELECT t.id, t.date, t.amount_minor, a.currency, t.category_id, t.payee, t.notes, t.bank_note
     FROM transactions t JOIN accounts a ON a.id=t.account_id
     WHERE t.deleted=0 AND t.transfer_id IS NULL AND t.recurring_id IS NULL AND t.debt_id IS NULL AND t.amount_minor<0
       AND t.date>=? AND t.date<?${scope}
     ORDER BY t.amount_minor ASC, t.date DESC`,
    [o.start, o.end, ...(o.accountIds ?? [])]);
  const by = new Map<string, OneOff[]>();
  const spent = new Map<string, number>();
  for (const r of rows) {
    spent.set(r.currency, (spent.get(r.currency) ?? 0) - r.amount_minor);
    const list = by.get(r.currency) ?? [];
    if (list.length < (o.limit ?? 3)) list.push(r);
    by.set(r.currency, list);
  }
  return [...by].map(([currency, list]) => ({ currency, rows: list })).sort((a, b) => (spent.get(b.currency) ?? 0) - (spent.get(a.currency) ?? 0));
}

/* ── Where you shop most ─────────────────────────────────────────────────────────────────────── */

/**
 * What a shop's rows are grouped by: the first word of its name that is a name at all. Branches of
 * one chain print themselves differently ("ZABKA ZE212 K.5", "Żabka Nano 3087"), and that first word
 * is what `payeeHistory` already treats as "the same shop" — so a word with a digit in it (a branch
 * code) and a word that only says how it was paid ("BLIK", "Płatność") are passed over. Null when
 * nothing is left.
 */
export function shopKey(payee: string | null | undefined): string | null {
  // A chain everybody knows is that chain whatever the bank prints before it: "JMP S.A. BIEDRONKA
  // 1234" and a place called "Biedronka" are one shop, not "jmp" and "biedronka".
  // The shortest chain name it contains, so "Żabka Nano" and "ATB-Market" are Żabka and ATB.
  const n = ` ${normalizeName(payee ?? "")} `;
  const chain = shopTerms().filter((t) => n.includes(` ${t.term} `)).sort((x, y) => x.term.length - y.term.length)[0];
  if (chain) return chain.term;
  const words = normalizeName(payee ?? "").split(" ").filter((w) => w.length >= 2 && !/\d/.test(w) && !isMethodWord(w));
  return words[0] ?? null;
}

export interface ShopLine { key: string; name: string; spent_minor: number; count: number; prev_minor: number; category_id: string | null }

/**
 * The shops the period's money went to, most first, with what the same stretch of the period before
 * cost there (`comparableWindows`, so a running month is compared day for day). The shop is the
 * row's `payee` — the name as the bank wrote it — or, for an entry typed by hand, which has none,
 * the `place` the phone named where it was logged. A note is the person's own sentence and the
 * bank's text carries references (rule 20), so neither names a shop. Recurring payments are left
 * out: rent is not shopping. The name shown is the one the shop was written under most often.
 */
export function topShops(db: SqlDriver, o: { start: string; end: string; today: string; startDay: number; accountIds?: string[]; limit?: number }): { currency: string; shops: ShopLine[] }[] {
  const w = comparableWindows({ ...o, count: 1 });
  const scope = o.accountIds?.length ? ` AND t.account_id IN (${o.accountIds.map(() => "?").join(",")})` : "";
  // Hand-typed entries have no payee and used to be left out altogether, so a shop paid for in
  // cash or logged from the sheet never made the list however much went there.
  const read = (win: { start: string; end: string }) => db.all<{ payee: string; amount_minor: number; currency: string; category_id: string | null }>(
    `SELECT COALESCE(NULLIF(trim(t.payee), ''), NULLIF(trim(t.place), '')) AS payee, t.amount_minor, a.currency, t.category_id
     FROM transactions t JOIN accounts a ON a.id=t.account_id
     WHERE t.deleted=0 AND t.transfer_id IS NULL AND t.recurring_id IS NULL AND t.debt_id IS NULL AND t.amount_minor<0
       AND COALESCE(NULLIF(trim(t.payee), ''), NULLIF(trim(t.place), '')) IS NOT NULL AND t.date>=? AND t.date<?${scope}`,
    [win.start, win.end, ...(o.accountIds ?? [])]);
  type Acc = ShopLine & { names: Map<string, number>; cats: Map<string, number> };
  const by = new Map<string, Map<string, Acc>>();
  const entry = (currency: string, key: string) => {
    const m = by.get(currency) ?? new Map<string, Acc>(); by.set(currency, m);
    let e = m.get(key);
    if (!e) { e = { key, name: key, spent_minor: 0, count: 0, prev_minor: 0, category_id: null, names: new Map(), cats: new Map() }; m.set(key, e); }
    return e;
  };
  for (const r of read(w.now)) {
    const key = shopKey(r.payee); if (!key) continue;
    const e = entry(r.currency, key);
    e.spent_minor -= r.amount_minor; e.count++;
    const name = r.payee.trim();
    e.names.set(name, (e.names.get(name) ?? 0) + 1);
    if (r.category_id) e.cats.set(r.category_id, (e.cats.get(r.category_id) ?? 0) - r.amount_minor);
  }
  for (const r of read(w.before[0]!)) {
    const key = shopKey(r.payee); if (!key) continue;
    const e = by.get(r.currency)?.get(key);
    if (e) e.prev_minor -= r.amount_minor;
  }
  const best = <K>(m: Map<K, number>): K | null => { let k: K | null = null, v = -Infinity; for (const [kk, vv] of m) if (vv > v) { k = kk; v = vv; } return k; };
  return [...by].map(([currency, m]) => {
    const shops = [...m.values()].map(({ names, cats, ...s }) => ({ ...s, name: best(names) ?? s.key, category_id: best(cats) }))
      .sort((a, b) => b.spent_minor - a.spent_minor);
    return { currency, total: shops.reduce((a, s) => a + s.spent_minor, 0), shops: shops.slice(0, o.limit ?? 5) };
  }).sort((a, b) => b.total - a.total).map(({ currency, shops }) => ({ currency, shops }));
}

/* ── Spending map ────────────────────────────────────────────────────────────────────────────── */

/** About 150 m: one cell is "this block", which is what a fix without a name can honestly say. */
export const MAP_CELL_M = 150;

export interface SpendPlace { key: string; lat: number; lon: number; place: string | null; spent_minor: number; count: number; category_id: string | null }

/**
 * Where the period's money was spent, from the location kept with each entry. Rows are gathered into
 * places: by the place's name where it has one (the same Biedronka however the fix wandered — kept
 * apart from another town's Biedronka by a 2 km cell), otherwise by a ~150 m cell. Each place sits at
 * the spend-weighted middle of its rows. Per currency, most spent first.
 */
export function spendingPlaces(db: SqlDriver, o: { start: string; end: string; accountIds?: string[] }): { currency: string; total_minor: number; located_minor: number; places: SpendPlace[] }[] {
  const scope = o.accountIds?.length ? ` AND t.account_id IN (${o.accountIds.map(() => "?").join(",")})` : "";
  const rows = db.all<{ lat: number | null; lon: number | null; place: string | null; amount_minor: number; currency: string; category_id: string | null }>(
    `SELECT t.lat, t.lon, t.place, t.amount_minor, a.currency, t.category_id FROM transactions t JOIN accounts a ON a.id=t.account_id
     WHERE t.deleted=0 AND t.transfer_id IS NULL AND t.amount_minor<0 AND t.date>=? AND t.date<?${scope}`,
    [o.start, o.end, ...(o.accountIds ?? [])]);
  // Places are grown, not cut from a grid: a fixed grid split one shop in two whenever its fixes
  // fell either side of a cell's edge, and each half then lost to a smaller place elsewhere. Rows
  // are taken biggest first, so a place grows around where most of its money was spent.
  type Acc = { key: string; name: string; wLat: number; wLon: number; w: number; spent: number; count: number; names: Map<string, number>; cats: Map<string, number> };
  const by = new Map<string, { total: number; located: number; places: Acc[] }>();
  const sorted = [...rows].sort((a, b) => a.amount_minor - b.amount_minor);
  for (const r of sorted) {
    const spent = -r.amount_minor;
    const cur = by.get(r.currency) ?? { total: 0, located: 0, places: [] as Acc[] };
    by.set(r.currency, cur);
    cur.total += spent;
    if (r.lat == null || r.lon == null) continue;
    cur.located += spent;
    const name = r.place?.trim() ? placeKey(r.place) : "";
    const near = (e: Acc, m: number) => distanceMeters(r.lat!, r.lon!, e.wLat / e.w, e.wLon / e.w) <= m;
    // The same name within 2 km is the same shop; a fix with no name joins whatever is within 150 m.
    let e = (name ? cur.places.find((x) => x.name === name && near(x, 2000)) : undefined)
      ?? (name ? undefined : cur.places.filter((x) => near(x, MAP_CELL_M)).sort((a, b) => b.spent - a.spent)[0]);
    if (!e) { e = { key: `${name || "here"}:${cur.places.length}`, name, wLat: 0, wLon: 0, w: 0, spent: 0, count: 0, names: new Map(), cats: new Map() }; cur.places.push(e); }
    // Weighted by money, with a floor so a free (0) row still has somewhere to be.
    const weight = Math.max(spent, 1);
    e.wLat += r.lat * weight; e.wLon += r.lon * weight; e.w += weight;
    e.spent += spent; e.count++;
    if (r.place?.trim()) e.names.set(r.place.trim(), (e.names.get(r.place.trim()) ?? 0) + 1);
    if (r.category_id) e.cats.set(r.category_id, (e.cats.get(r.category_id) ?? 0) + spent);
  }
  const best = (m: Map<string, number>): string | null => { let k: string | null = null, v = -Infinity; for (const [kk, vv] of m) if (vv > v) { k = kk; v = vv; } return k; };
  return [...by].map(([currency, c]) => ({
    currency, total_minor: c.total, located_minor: c.located,
    places: c.places.map((e) => ({ key: e.key, lat: e.wLat / e.w, lon: e.wLon / e.w, place: best(e.names), spent_minor: e.spent, count: e.count, category_id: best(e.cats) }))
      .sort((a, b) => b.spent_minor - a.spent_minor),
  })).filter((c) => c.places.length).sort((a, b) => b.located_minor - a.located_minor);
}
