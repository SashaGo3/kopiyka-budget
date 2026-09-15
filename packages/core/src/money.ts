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
 * foreign account gives — that currency is used and nothing is converted: the number is exact and
 * needs no rate at all. Only a genuinely mixed set falls back to `base`, and then `approx` says so,
 * because an approximate figure that does not admit it is worse than no figure.
 *
 * Groups are summed independently but share the one decision, so income and expenses (or a count's
 * worth of pending entries) are never printed in two different currencies side by side.
 */
export function oneCurrency(
  groups: { currency: string; minor: number }[][],
  base: string,
  rateFor: (from: string, to: string) => number | null,
): { currency: string; approx: boolean; missing: string[]; totals: number[] } {
  const currencies = [...new Set(groups.flat().map((g) => g.currency))];
  if (currencies.length <= 1) {
    return { currency: currencies[0] ?? base, approx: false, missing: [], totals: groups.map((g) => g.reduce((a, x) => a + x.minor, 0)) };
  }
  const sums = groups.map((g) => sumInBase(g, base, rateFor));
  return { currency: base, approx: true, missing: [...new Set(sums.flatMap((x) => x.missing))], totals: sums.map((x) => x.minor) };
}
