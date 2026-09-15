/** Amounts are stored as integers in minor units (cents, grosze). */
const DECIMALS: Record<string, number> = { JPY: 0, KRW: 0, HUF: 2, BHD: 3, KWD: 3 };

export function currencyDecimals(currency: string): number {
  return DECIMALS[currency.toUpperCase()] ?? 2;
}

export function toMinor(amount: number, currency: string): number {
  const f = 10 ** currencyDecimals(currency);
  return Math.round(amount * f);
}

export function fromMinor(minor: number, currency: string): number {
  return minor / 10 ** currencyDecimals(currency);
}

/** Parse "1 234,56" / "1234.56" / "-12" into minor units. Returns null on garbage. */
export function parseAmount(text: string, currency: string): number | null {
  const cleaned = text.replace(/\s/g, "").replace(",", ".");
  if (!/^-?\d*(\.\d*)?$/.test(cleaned) || cleaned === "" || cleaned === "-") return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return toMinor(n, currency);
}

/** Plain formatting without Intl so it behaves identically in Hermes and Bun. */
export function formatMinor(minor: number, currency: string, opts: { sign?: boolean; grouping?: string } = {}): string {
  const d = currencyDecimals(currency);
  const neg = minor < 0;
  const abs = Math.abs(minor).toString().padStart(d + 1, "0");
  const int = d ? abs.slice(0, -d) : abs;
  const frac = d ? abs.slice(-d) : "";
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, opts.grouping ?? " ");
  const body = frac ? `${grouped}.${frac}` : grouped;
  const sign = neg ? "-" : opts.sign ? "+" : "";
  return `${sign}${body}`;
}

/** Convert minor units between currencies. rate = quote units per 1 base unit. */
export function convertMinor(minor: number, from: string, to: string, rate: number): number {
  return toMinor(fromMinor(minor, from) * rate, to);
}

/** Sum per-currency totals into one base currency using a rate lookup (quote per 1 base). Unknown rates are skipped and reported. */
export function sumInBase(totals: { currency: string; minor: number }[], base: string, rateFor: (from: string, to: string) => number | null): { minor: number; missing: string[] } {
  let sum = 0; const missing: string[] = [];
  for (const t of totals) {
    if (t.currency === base) { sum += t.minor; continue; }
    const r = rateFor(t.currency, base);
    if (r === null) { missing.push(t.currency); continue; }
    sum += convertMinor(t.minor, t.currency, base, r);
  }
  return { minor: Math.round(sum), missing };
}

/**
 * One figure per group, all of them in the same currency, for a screen that has room for a number
 * but not for a breakdown.
 *
 * When everything involved is already in one currency — the usual case, and what looking at a single
 * foreign account gives — that currency is used and nothing is converted at all. Only a genuinely
 * mixed set falls back to `base`.
 *
 * The *currency* is one decision for all the groups, so income and expenses are never printed in two
 * different currencies side by side. Whether a number was **converted** is each group's own business:
 * zloty expenses beside dollar income are exact, and marking them approximate because something else
 * on the screen was converted says the opposite of the truth. `converted` carries the parts that did
 * need a rate, so a screen can explain the "≈" it is showing rather than leaving it to be wondered at.
 */
export function oneCurrency(
  groups: { currency: string; minor: number }[][],
  base: string,
  rateFor: (from: string, to: string) => number | null,
): { currency: string; missing: string[]; totals: { minor: number; approx: boolean; converted: { currency: string; minor: number }[] }[] } {
  const currencies = [...new Set(groups.flat().map((g) => g.currency))];
  const currency = currencies.length <= 1 ? currencies[0] ?? base : base;
  const missing = new Set<string>();
  const totals = groups.map((g) => {
    if (currency !== base) return { minor: g.reduce((a, x) => a + x.minor, 0), approx: false, converted: [] };
    const sum = sumInBase(g, base, rateFor);
    for (const m of sum.missing) missing.add(m);
    const converted = g.filter((x) => x.currency !== currency);
    return { minor: sum.minor, approx: converted.length > 0, converted };
  });
  return { currency, missing: [...missing], totals };
}
