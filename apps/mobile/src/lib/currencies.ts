/** Currencies offered by the picker: ISO code, name and symbol. Frequent European ones first, then the rest alphabetically. */
import { currencyForCountry, currencyForLocale } from "@kopiyka/core";
import { deviceLocales } from "./device";

export interface CurrencyInfo { code: string; name: string; symbol: string }

export const CURRENCY_LIST: CurrencyInfo[] = [
  { code: "PLN", name: "Polish złoty", symbol: "zł" },
  { code: "EUR", name: "Euro", symbol: "€" },
  { code: "USD", name: "US dollar", symbol: "$" },
  { code: "UAH", name: "Ukrainian hryvnia", symbol: "₴" },
  { code: "GBP", name: "British pound", symbol: "£" },
  { code: "CHF", name: "Swiss franc", symbol: "CHF" },
  { code: "CZK", name: "Czech koruna", symbol: "Kč" },
  { code: "SEK", name: "Swedish krona", symbol: "kr" },
  { code: "NOK", name: "Norwegian krone", symbol: "kr" },
  { code: "DKK", name: "Danish krone", symbol: "kr" },
  { code: "HUF", name: "Hungarian forint", symbol: "Ft" },
  { code: "RON", name: "Romanian leu", symbol: "lei" },
  { code: "BGN", name: "Bulgarian lev", symbol: "лв" },
  { code: "TRY", name: "Turkish lira", symbol: "₺" },
  { code: "GEL", name: "Georgian lari", symbol: "₾" },
  { code: "MDL", name: "Moldovan leu", symbol: "L" },
  { code: "RSD", name: "Serbian dinar", symbol: "din" },
  { code: "ISK", name: "Icelandic króna", symbol: "kr" },
  { code: "CAD", name: "Canadian dollar", symbol: "$" },
  { code: "AUD", name: "Australian dollar", symbol: "$" },
  { code: "NZD", name: "New Zealand dollar", symbol: "$" },
  { code: "JPY", name: "Japanese yen", symbol: "¥" },
  { code: "CNY", name: "Chinese yuan", symbol: "¥" },
  { code: "KRW", name: "South Korean won", symbol: "₩" },
  { code: "INR", name: "Indian rupee", symbol: "₹" },
  { code: "SGD", name: "Singapore dollar", symbol: "$" },
  { code: "HKD", name: "Hong Kong dollar", symbol: "$" },
  { code: "THB", name: "Thai baht", symbol: "฿" },
  { code: "VND", name: "Vietnamese dong", symbol: "₫" },
  { code: "IDR", name: "Indonesian rupiah", symbol: "Rp" },
  { code: "MYR", name: "Malaysian ringgit", symbol: "RM" },
  { code: "PHP", name: "Philippine peso", symbol: "₱" },
  { code: "AED", name: "UAE dirham", symbol: "د.إ" },
  { code: "SAR", name: "Saudi riyal", symbol: "﷼" },
  { code: "ILS", name: "Israeli new shekel", symbol: "₪" },
  { code: "EGP", name: "Egyptian pound", symbol: "£" },
  { code: "ZAR", name: "South African rand", symbol: "R" },
  { code: "MXN", name: "Mexican peso", symbol: "$" },
  { code: "BRL", name: "Brazilian real", symbol: "R$" },
  { code: "ARS", name: "Argentine peso", symbol: "$" },
  { code: "CLP", name: "Chilean peso", symbol: "$" },
  { code: "COP", name: "Colombian peso", symbol: "$" },
  { code: "KZT", name: "Kazakhstani tenge", symbol: "₸" },
  { code: "AMD", name: "Armenian dram", symbol: "֏" },
  { code: "AZN", name: "Azerbaijani manat", symbol: "₼" },
];

export function currencyName(code: string): string { return CURRENCY_LIST.find((c) => c.code === code)?.name ?? code; }

export function isKnownCurrency(code: string): boolean { return CURRENCY_LIST.some((c) => c.code === code); }

/**
 * The currency to open onboarding on, read off the phone rather than asked for.
 *
 * iOS knows the answer outright — Settings → General → Language & Region carries a currency, which
 * is what the region's own apps bill in. When that is a currency the picker does not offer, the
 * region itself is mapped instead (`currencyForCountry`), and a phone that reports no region at all
 * falls back to its locale. It is only a default: the picker is one tap away and nothing is written
 * until the user continues.
 *
 * `country` lets a caller that already knows where the phone actually is (a granted location fix,
 * see `lib/location.ts`) override the setting — someone who moved keeps their old region for months.
 */
export function suggestedCurrency(country?: string | null): string {
  if (country) { const c = currencyForCountry(country); if (isKnownCurrency(c)) return c; }
  const d = deviceLocales();
  if (d.currency && isKnownCurrency(d.currency)) return d.currency;
  const byRegion = d.region ? currencyForCountry(d.region) : currencyForLocale(d.locale);
  return isKnownCurrency(byRegion) ? byRegion : "EUR";
}
