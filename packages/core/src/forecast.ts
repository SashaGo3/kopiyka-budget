/**
 * Siriusia sees the future: the arithmetic behind the Purrphecy card and the savings goal's forecast.
 *
 * Two halves. The first is pure money maths — compound growth, how long a target takes, what a
 * mortgage costs, the "freedom number" — over plain numbers, so every calculator on the screen is a
 * function of its sliders and nothing else. The second reads the database for the one thing a
 * calculator cannot be told: how fast *you* actually save (`moneyPace`, `goalForecast`).
 *
 * Amounts are minor units throughout, as everywhere else (DATA.md rule 6). Compounding is done in
 * floating point and every figure handed back is rounded to a whole minor unit; nothing here is
 * ever written to a row, so the rounding is only ever display.
 *
 * Rates are percentages a person types (7 = 7% a year). An investment's rate is an *effective*
 * annual one — 7% a year means the money is 7% bigger after twelve months, whatever happens inside
 * them — while a mortgage's is the nominal rate banks quote, divided by twelve, because that is how
 * the bank will compute the instalment.
 */
import type { SqlDriver } from "./db";
import type { InsightParams } from "./insights";
import { accountHistory, periodWindows } from "./insightHistory";
import { accountBalanceMinor, listRows } from "./repo";
import { convertMinor } from "./money";

/* ── Plain maths ─────────────────────────────────────────────────────────────────────────── */

/** No calculator looks further than this; a target never reached within it is "never". */
export const MAX_MONTHS = 100 * 12;

/** The monthly rate that compounds to `ratePct` a year. */
export function monthlyRate(ratePct: number): number {
  return ratePct ? Math.pow(1 + ratePct / 100, 1 / 12) - 1 : 0;
}

export interface GrowthInput {
  start_minor: number;
  monthly_minor: number;
  /** Expected yearly return, effective. */
  rate_pct: number;
  years: number;
  /** Prices rising this much a year: `real_minor` is the total in today's money. Absent is 0. */
  inflation_pct?: number;
  /** The monthly amount grows this much every year, as a salary does. Absent is 0. */
  raise_pct?: number;
}

export interface GrowthYear {
  year: number;
  /** Everything put in so far, the starting sum included. */
  contributed_minor: number;
  /** What the money earned on its own: total − contributed. */
  growth_minor: number;
  total_minor: number;
  /** The total in today's money, after inflation. */
  real_minor: number;
  /** What the money earned during this year alone. */
  earned_this_year_minor: number;
  /** What was put in during this year alone. */
  added_this_year_minor: number;
}

/**
 * Year by year, from year 0 (the starting sum) to `years`: what was put in and what it grew to,
 * paying in at the end of every month. The picture compound interest is about is the gap between
 * the two lines, so both are handed back rather than just the end.
 */
export function growth(i: GrowthInput): GrowthYear[] {
  const r = monthlyRate(i.rate_pct);
  const years = Math.max(0, Math.round(i.years));
  const inflation = (i.inflation_pct ?? 0) / 100;
  let total = i.start_minor, put = i.start_minor, monthly = i.monthly_minor;
  const out: GrowthYear[] = [{ year: 0, contributed_minor: Math.round(put), growth_minor: 0, total_minor: Math.round(total), real_minor: Math.round(total), earned_this_year_minor: 0, added_this_year_minor: 0 }];
  for (let y = 1; y <= years; y++) {
    const before = total, putBefore = put;
    for (let m = 0; m < 12; m++) {
      total = total * (1 + r) + monthly;
      put += monthly;
    }
    if (i.raise_pct) monthly *= 1 + i.raise_pct / 100;
    const added = put - putBefore;
    out.push({
      year: y,
      contributed_minor: Math.round(put),
      growth_minor: Math.round(total - put),
      total_minor: Math.round(total),
      real_minor: Math.round(total / Math.pow(1 + inflation, y)),
      earned_this_year_minor: Math.round(total - before - added),
      added_this_year_minor: Math.round(added),
    });
  }
  return out;
}

/**
 * The first year in which the money earned more on its own than was paid into it — the moment the
 * snowball starts rolling by itself. Null when it does not happen within the years given.
 */
export function crossoverYear(years: GrowthYear[]): number | null {
  const y = years.find((x) => x.year > 0 && x.earned_this_year_minor > 0 && x.earned_this_year_minor >= x.added_this_year_minor);
  return y ? y.year : null;
}

/** How many years money takes to double at `ratePct` a year. Null at no growth. */
export function doublingYears(ratePct: number): number | null {
  return ratePct > 0 ? Math.log(2) / Math.log(1 + ratePct / 100) : null;
}

/**
 * Whole months until `have`, plus `monthly` at the end of every month, growing at `ratePct`,
 * reaches `target`. 0 when it is already there; null when it never gets there (within `MAX_MONTHS`).
 */
export function monthsToTarget(o: { have_minor: number; monthly_minor: number; rate_pct: number; target_minor: number }): number | null {
  if (o.have_minor >= o.target_minor) return 0;
  const r = monthlyRate(o.rate_pct);
  if (o.monthly_minor <= 0 && (r <= 0 || o.have_minor <= 0)) return null;
  let total = o.have_minor;
  for (let m = 1; m <= MAX_MONTHS; m++) {
    total = total * (1 + r) + o.monthly_minor;
    if (total >= o.target_minor) return m;
  }
  return null;
}

/**
 * What has to be put away every month for `have` to reach `target` in `months`, growing at
 * `ratePct`. 0 when what is there already gets there on its own.
 */
export function requiredMonthly(o: { have_minor: number; target_minor: number; months: number; rate_pct: number }): number {
  const n = Math.max(1, Math.round(o.months));
  const r = monthlyRate(o.rate_pct);
  const grown = o.have_minor * Math.pow(1 + r, n);
  const gap = o.target_minor - grown;
  if (gap <= 0) return 0;
  const factor = r ? (Math.pow(1 + r, n) - 1) / r : n;
  return Math.ceil(gap / factor);
}

/** `minor` in today's money `years` from now, prices rising `inflationPct` a year. */
export function realValue(minor: number, inflationPct: number, years: number): number {
  return Math.round(minor / Math.pow(1 + inflationPct / 100, years));
}

export interface Mortgage {
  principal_minor: number;
  monthly_minor: number;
  months: number;
  total_minor: number;
  interest_minor: number;
  /** What is still owed at the end of each year, year 0 being the whole loan. */
  balance_by_year: number[];
}

/**
 * An annuity loan: the same instalment every month for `years`, at a nominal `ratePct` a year
 * (twelfth of it monthly, as banks compute it). `extra_minor` is overpaid every month on top of the
 * instalment, which shortens the loan rather than lowering the instalment — `months` and the
 * interest say what that saved.
 */
export function mortgage(o: { principal_minor: number; rate_pct: number; years: number; extra_minor?: number }): Mortgage {
  const P = Math.max(0, o.principal_minor);
  const n = Math.max(1, Math.round(o.years * 12));
  const r = o.rate_pct / 100 / 12;
  const instalment = P === 0 ? 0 : r ? (P * r) / (1 - Math.pow(1 + r, -n)) : P / n;
  const extra = Math.max(0, o.extra_minor ?? 0);
  let owed = P, paid = 0, months = 0;
  const byYear = [Math.round(P)];
  while (owed > 0.5 && months < MAX_MONTHS) {
    const interest = owed * r;
    const pay = Math.min(owed + interest, instalment + extra);
    owed = owed + interest - pay;
    paid += pay;
    months++;
    if (months % 12 === 0) byYear.push(Math.max(0, Math.round(owed)));
  }
  if (months % 12 !== 0) byYear.push(0);
  return { principal_minor: Math.round(P), monthly_minor: Math.round(instalment), months, total_minor: Math.round(paid), interest_minor: Math.round(paid - P), balance_by_year: byYear };
}

/**
 * The "freedom number": the money that pays for a year of life forever if no more than
 * `withdrawPct` of it is taken out each year — 25 years of spending at the classic 4%.
 */
export function freedomNumber(yearlySpendMinor: number, withdrawPct = 4): number {
  return withdrawPct > 0 ? Math.round((yearlySpendMinor * 100) / withdrawPct) : 0;
}

/** `iso` plus `months` calendar months, as the first of that month ("2026-11-09" + 3 → "2027-02-01"). */
export function monthAfter(iso: string, months: number): string {
  const [y, m] = iso.split("-").map(Number) as [number, number];
  const at = new Date(Date.UTC(y, m - 1 + months, 1));
  return at.toISOString().slice(0, 10);
}

/**
 * Whole months from `from` to `to` — how many monthly payments still fit before a deadline. A
 * deadline later this month is 0; a deadline in the past is negative.
 */
export function monthsBetween(from: string, to: string): number {
  const [y1, m1, d1] = from.split("-").map(Number) as [number, number, number];
  const [y2, m2, d2] = to.split("-").map(Number) as [number, number, number];
  return (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0);
}

/* ── What the calculators start from ──────────────────────────────────────────────────────── */

/**
 * The Purrphecy card's settings, kept in its `params` (so they travel with backups and to the
 * other device like any card's — DATA.md rule 12) rather than in `meta`. Every field is optional;
 * `futureInputs` fills in the rest. Amounts are minor units of `currency`.
 */
export interface FutureInputs {
  /** Which currency the card speaks; absent is the app's base currency. Every account is converted into it. */
  currency?: string;
  /** The accounts your pace is read from; absent (or empty) is every account that counts towards net worth. */
  account_ids?: string[];
  /** Expected yearly return on investments. */
  rate_pct?: number;
  /** What a savings account pays. */
  deposit_pct?: number;
  inflation_pct?: number;
  years?: number;
  /** Compound interest: the starting sum and monthly amount; absent is what you have and save now. */
  start_minor?: number;
  monthly_minor?: number;
  /** Compound interest: how much the monthly amount grows each year, as a salary does. */
  raise_pct?: number;
  home_price_minor?: number;
  down_pct?: number;
  mortgage_rate_pct?: number;
  mortgage_years?: number;
  /** Overpaid on the mortgage every month. */
  mortgage_extra_minor?: number;
  /** Small habits: the category whose spending is weighed, and how much of it could go. */
  habit_category_id?: string;
  habit_cut_pct?: number;
  /** Freedom: the share of the pot taken out each year. */
  withdraw_pct?: number;
}

export const FUTURE_DEFAULTS = {
  rate_pct: 7, deposit_pct: 4, inflation_pct: 3, years: 20,
  down_pct: 20, mortgage_rate_pct: 7, mortgage_years: 25, habit_cut_pct: 50, withdraw_pct: 4,
} as const;

/* ── Reading the database ─────────────────────────────────────────────────────────────────── */

export interface MoneyPace {
  currency: string;
  /** Everything held in this currency now: every live account that counts towards net worth. */
  balance_minor: number;
  /** Average per complete period: what came in (earned, not moved), what went out, and the difference. */
  income_minor: number;
  spend_minor: number;
  net_minor: number;
  /** How many complete periods the averages are over (up to `periods`). */
  periods: number;
  /** net / income, 0…1 (negative when spending more than comes in); null without income. */
  savings_rate: number | null;
}

/**
 * How fast money is actually piling up, per currency: the average budget period over the last
 * `periods` complete ones, over every account that counts towards net worth or the ones picked
 * (`accountIds`). Money moved between two of those accounts is not counted (it is neither earned
 * nor spent); moved in from, or out to, an account outside them it is, because for these accounts
 * it arrived or left. A running period is left out too, as it would pull every average down. What a
 * trip cost *is* counted — unlike the budgets, the future does not care which holiday the money
 * went on.
 *
 * Sorted the way the app would pick "your" currency: the one income comes in most often, then the
 * one with the most money in it.
 */
export function moneyPace(db: SqlDriver, o: { today: string; startDay: number; periods?: number; accountIds?: string[] }): MoneyPace[] {
  const count = o.periods ?? 6;
  const windows = periodWindows(o.today, o.startDay, count + 1).filter((w) => !w.current);
  const balances: { currency: string; minor: number }[] = [];
  // Accounts picked by hand are taken at their word, net worth or not; otherwise net worth decides.
  const ids = o.accountIds?.length ? o.accountIds : null;
  const which = ids ? `a.id IN (${ids.map(() => "?").join(",")})` : "a.include_in_net_worth=1";
  const whichArgs = ids ?? [];
  for (const a of listRows(db, "accounts", ids ? `deleted=0 AND id IN (${ids.map(() => "?").join(",")})` : "deleted=0 AND include_in_net_worth=1", whichArgs)) {
    const minor = accountBalanceMinor(db, a.id, { includePending: true });
    const b = balances.find((x) => x.currency === a.currency);
    if (b) b.minor += minor; else balances.push({ currency: a.currency, minor });
  }
  const per = new Map<string, { income: number[]; spend: number[] }>();
  windows.forEach((w, i) => {
    const rows = db.all<{ currency: string; income: number | null; spend: number | null }>(
      `SELECT a.currency AS currency,
              SUM(CASE WHEN t.amount_minor>0 AND t.debt_id IS NULL AND t.person_id IS NULL THEN t.amount_minor ELSE 0 END) AS income,
              SUM(CASE WHEN t.amount_minor<0 THEN -t.amount_minor WHEN t.debt_id IS NOT NULL OR t.person_id IS NOT NULL THEN -t.amount_minor ELSE 0 END) AS spend
       FROM transactions t JOIN accounts a ON a.id=t.account_id
       WHERE t.deleted=0 AND a.deleted=0 AND ${which} AND t.date>=? AND t.date<?
         AND (t.transfer_id IS NULL OR NOT EXISTS (
           SELECT 1 FROM transactions o JOIN accounts oa ON oa.id=o.account_id
           WHERE o.transfer_id=t.transfer_id AND o.id<>t.id AND o.deleted=0 AND ${which.replaceAll("a.", "oa.")}))
       GROUP BY a.currency`, [...whichArgs, w.start, w.end, ...whichArgs]);
    for (const r of rows) {
      const e = per.get(r.currency) ?? { income: new Array<number>(windows.length).fill(0), spend: new Array<number>(windows.length).fill(0) };
      e.income[i] = r.income ?? 0; e.spend[i] = r.spend ?? 0; per.set(r.currency, e);
    }
  });
  const currencies = new Set([...per.keys(), ...balances.filter((b) => b.minor).map((b) => b.currency)]);
  const out: (MoneyPace & { incomePeriods: number })[] = [];
  for (const currency of currencies) {
    const e = per.get(currency);
    // History starts at the first period anything happened in: a currency taken up last month is
    // not averaged against the months before it existed.
    const first = e ? windows.findIndex((_, i) => e.income[i]! || e.spend[i]!) : -1;
    const idx = first < 0 ? [] : windows.map((_, i) => i).slice(first);
    const avg = (arr: number[] | undefined) => (arr && idx.length ? Math.round(idx.reduce((a, i) => a + arr[i]!, 0) / idx.length) : 0);
    const income = avg(e?.income), spend = avg(e?.spend);
    out.push({
      currency, balance_minor: balances.find((b) => b.currency === currency)?.minor ?? 0,
      income_minor: income, spend_minor: spend, net_minor: income - spend, periods: idx.length,
      savings_rate: income > 0 ? (income - spend) / income : null,
      incomePeriods: e ? idx.filter((i) => e.income[i]! > 0).length : 0,
    });
  }
  return out.sort((a, b) => b.incomePeriods - a.incomePeriods || b.balance_minor - a.balance_minor)
    .map(({ incomePeriods: _, ...p }) => p);
}

/**
 * Every currency's pace as one, in `currency`. A salary paid in dollars and a life spent in złoty is
 * one person saving, not one currency losing money and another piling it up: each currency's
 * balance and average month are converted at the latest known rate and added. A currency with no
 * rate yet is left out and named in `missing`, so the screen can say so instead of guessing.
 */
export function paceIn(paces: MoneyPace[], currency: string, rateFor: (from: string, to: string) => number | null): (MoneyPace & { missing: string[] }) | null {
  if (!paces.length) return null;
  let balance = 0, income = 0, spend = 0, periods = 0;
  const missing: string[] = [];
  for (const p of paces) {
    const rate = p.currency === currency ? 1 : rateFor(p.currency, currency);
    if (rate == null) { missing.push(p.currency); continue; }
    const c = (m: number) => (p.currency === currency ? m : convertMinor(m, p.currency, currency, rate));
    balance += c(p.balance_minor); income += c(p.income_minor); spend += c(p.spend_minor);
    periods = Math.max(periods, p.periods);
  }
  return { currency, balance_minor: balance, income_minor: income, spend_minor: spend, net_minor: income - spend, periods, savings_rate: income > 0 ? (income - spend) / income : null, missing };
}

/** The Purrphecy card's inputs with every gap filled: from the card, else the defaults, else your pace. */
export function futureInputs(f: FutureInputs | undefined, pace: MoneyPace | null): Required<Omit<FutureInputs, "habit_category_id" | "account_ids">> & { habit_category_id: string | null; account_ids: string[] } {
  const x = f ?? {};
  const monthly = x.monthly_minor ?? Math.max(0, pace?.net_minor ?? 0);
  return {
    currency: x.currency ?? pace?.currency ?? "EUR",
    rate_pct: x.rate_pct ?? FUTURE_DEFAULTS.rate_pct,
    deposit_pct: x.deposit_pct ?? FUTURE_DEFAULTS.deposit_pct,
    inflation_pct: x.inflation_pct ?? FUTURE_DEFAULTS.inflation_pct,
    years: x.years ?? FUTURE_DEFAULTS.years,
    start_minor: x.start_minor ?? Math.max(0, pace?.balance_minor ?? 0),
    monthly_minor: monthly,
    raise_pct: x.raise_pct ?? 0,
    // A home about ten years of saving at your pace, rounded: a number in the right world, not a guess at your city.
    home_price_minor: x.home_price_minor ?? Math.max(10_000_00, roundNice((pace?.income_minor ?? 0) * 12 * 8)),
    down_pct: x.down_pct ?? FUTURE_DEFAULTS.down_pct,
    mortgage_rate_pct: x.mortgage_rate_pct ?? FUTURE_DEFAULTS.mortgage_rate_pct,
    mortgage_years: x.mortgage_years ?? FUTURE_DEFAULTS.mortgage_years,
    mortgage_extra_minor: x.mortgage_extra_minor ?? 0,
    habit_category_id: x.habit_category_id ?? null,
    account_ids: x.account_ids ?? [],
    habit_cut_pct: x.habit_cut_pct ?? FUTURE_DEFAULTS.habit_cut_pct,
    withdraw_pct: x.withdraw_pct ?? FUTURE_DEFAULTS.withdraw_pct,
  };
}

/** Two significant figures, in whole major units: 1 234 567.89 → 1 200 000.00. */
export function roundNice(minor: number): number {
  if (minor <= 0) return 0;
  const major = minor / 100;
  const p = Math.pow(10, Math.max(0, Math.floor(Math.log10(major)) - 1));
  return Math.round(major / p) * p * 100;
}

/* ── A savings goal, forecast ─────────────────────────────────────────────────────────────── */

/**
 * Siriusia's verdict on a goal:
 * - `done`: the money is there.
 * - `on_track`: the pace reaches it by the deadline.
 * - `behind`: it does not, or the deadline has passed.
 * - `stalled`: the balance is not growing at all, so there is no "when".
 * - `open`: growing, and no deadline to measure it against — only an ETA.
 */
export type GoalStatus = "done" | "on_track" | "behind" | "stalled" | "open";

export interface GoalMilestone {
  pct: 25 | 50 | 75 | 100;
  minor: number;
  /** The period the balance first ended at or above it, when it has. */
  reached: string | null;
  /** When the pace gets it there, when it has not yet (first of that month). */
  eta: string | null;
}

export interface GoalForecast {
  currency: string;
  balance_minor: number;
  target_minor: number;
  ratio: number;
  /** Average change of the balance per complete period, up to six of them; null without one. */
  pace_minor: number | null;
  /** Months still needed at that pace, and the month it lands in. */
  months_left: number | null;
  eta: string | null;
  deadline: string | null;
  /** Monthly payments still fitting before the deadline. */
  months_to_deadline: number | null;
  /** What has to go in every month from now to make the deadline. */
  need_minor: number | null;
  status: GoalStatus;
  /** The balance at the end of each period, oldest first; the running period last. */
  history: { start: string; balance_minor: number; current: boolean }[];
  milestones: GoalMilestone[];
}

/**
 * Where a savings goal is heading, from the account's own history: how fast it has been growing,
 * when that pace reaches the target, and — with a deadline — whether it gets there in time and what
 * it would take. No interest is assumed here: this is the honest "at the rate you are going"; the
 * screen shows what investing would add beside it.
 */
export function goalForecast(db: SqlDriver, p: InsightParams, o: { today: string; startDay: number }): GoalForecast | null {
  if (!p.account_id) return null;
  const h = accountHistory(db, p.account_id, { startDay: o.startDay, today: o.today, count: 12 });
  if (!h) return null;
  // What the card says the account holds (pending included), not the end of the running period,
  // which would count a payment planned for later this month as already made.
  const balance = accountBalanceMinor(db, p.account_id, { includePending: true });
  const target = p.target_minor ?? 0;
  const done = h.periods.filter((x) => !x.current).slice(-6);
  const pace = done.length ? Math.round(done.reduce((a, x) => a + x.net_minor, 0) / done.length) : null;
  const toGo = target - balance;
  const months_left = toGo <= 0 ? 0 : pace && pace > 0 ? Math.ceil(toGo / pace) : null;
  const deadline = p.deadline ?? null;
  const months_to_deadline = deadline ? monthsBetween(o.today, deadline) : null;
  const need = deadline && toGo > 0 ? (months_to_deadline! > 0 ? Math.ceil(toGo / months_to_deadline!) : toGo) : deadline ? 0 : null;
  let status: GoalStatus;
  if (target > 0 && toGo <= 0) status = "done";
  else if (!pace || pace <= 0) status = deadline && months_to_deadline! < 0 ? "behind" : "stalled";
  else if (deadline) status = months_to_deadline! > 0 && pace >= need! ? "on_track" : "behind";
  else status = "open";
  const milestones = ([25, 50, 75, 100] as const).map((pct) => {
    const minor = Math.round((target * pct) / 100);
    const hit = h.periods.find((x) => x.balance_minor >= minor && minor > 0);
    const left = minor - balance;
    const eta = hit || left <= 0 || !pace || pace <= 0 ? null : monthAfter(o.today, Math.ceil(left / pace));
    return { pct, minor, reached: hit ? hit.start : left <= 0 ? o.today : null, eta };
  });
  return {
    currency: h.currency, balance_minor: balance, target_minor: target,
    ratio: target > 0 ? Math.max(0, Math.min(1, balance / target)) : 0,
    pace_minor: pace, months_left, eta: months_left ? monthAfter(o.today, months_left) : null,
    deadline, months_to_deadline, need_minor: need, status,
    history: h.periods.map((x) => ({ start: x.start, balance_minor: x.balance_minor, current: x.current })),
    milestones,
  };
}
