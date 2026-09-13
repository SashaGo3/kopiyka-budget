/**
 * Which currency to offer someone who has just installed the app.
 *
 * The first screen that asks for money is onboarding's "what is on your main account", and making
 * the user hunt for their own currency in a list of fifty is a poor first minute. The phone already
 * knows the answer twice over — the region set in iOS Settings, and, if location is on, the country
 * the phone is actually in — so this turns either into a currency code. It is only ever a default:
 * the picker is right there and nothing is written until the user continues.
 *
 * Countries are matched by ISO 3166-1 alpha-2. Only the currencies Kopiyka's picker actually offers
 * are listed, plus the euro area, which is most of the map. Anything unknown falls back to EUR.
 */

/** Every country that uses the euro (including the ones that adopted it without joining the EU). */
const EURO_AREA = [
  "AT", "BE", "CY", "DE", "EE", "ES", "FI", "FR", "GR", "HR", "IE", "IT", "LT", "LU", "LV", "MT",
  "NL", "PT", "SI", "SK", "AD", "MC", "SM", "VA", "ME", "XK", "BL", "GF", "GP", "MF", "MQ", "PM",
  "RE", "YT", "AX", "TF",
];

/** Countries whose money is the US dollar, either their own or adopted outright. */
const DOLLAR_AREA = ["US", "EC", "SV", "PA", "TL", "ZW", "PR", "GU", "VI", "AS", "MP", "MH", "FM", "PW", "TC", "VG", "BQ"];

const BY_COUNTRY: Record<string, string> = {
  ...Object.fromEntries(EURO_AREA.map((c) => [c, "EUR"])),
  ...Object.fromEntries(DOLLAR_AREA.map((c) => [c, "USD"])),
  PL: "PLN", UA: "UAH", GB: "GBP", GG: "GBP", JE: "GBP", IM: "GBP",
  CH: "CHF", LI: "CHF", CZ: "CZK", SE: "SEK", NO: "NOK", SJ: "NOK", DK: "DKK", FO: "DKK", GL: "DKK",
  HU: "HUF", RO: "RON", BG: "BGN", TR: "TRY", GE: "GEL", MD: "MDL", RS: "RSD", IS: "ISK",
  CA: "CAD", AU: "AUD", CX: "AUD", CC: "AUD", NF: "AUD", KI: "AUD", NR: "AUD", TV: "AUD",
  NZ: "NZD", CK: "NZD", NU: "NZD", TK: "NZD", PN: "NZD",
  JP: "JPY", CN: "CNY", KR: "KRW", IN: "INR", BT: "INR", SG: "SGD", HK: "HKD", TH: "THB",
  VN: "VND", ID: "IDR", MY: "MYR", PH: "PHP", AE: "AED", SA: "SAR",
  IL: "ILS", PS: "ILS", EG: "EGP", ZA: "ZAR", LS: "ZAR", NA: "ZAR", SZ: "ZAR",
  MX: "MXN", BR: "BRL", AR: "ARS", CL: "CLP", CO: "COP",
  KZ: "KZT", AM: "AMD", AZ: "AZN",
};

/** The currency Kopiyka should offer in `country` (ISO 3166-1 alpha-2, any case), or EUR. */
export function currencyForCountry(country: string | null | undefined): string {
  if (!country) return "EUR";
  return BY_COUNTRY[country.trim().toUpperCase()] ?? "EUR";
}

/**
 * The same, from a locale or region identifier: "pl-PL", "pl_PL", "PL", "en-GB-u-ca-gregory".
 * The region is the two-letter subtag, so a bare language ("uk") is not mistaken for a country.
 */
export function currencyForLocale(locale: string | null | undefined): string {
  return currencyForCountry(regionOfLocale(locale));
}

/** The country subtag of a locale, upper-cased: "pt-BR" → "BR". Null when it names no region. */
export function regionOfLocale(locale: string | null | undefined): string | null {
  if (!locale) return null;
  const parts = locale.replace(/_/g, "-").split("-");
  // A bare "PL" is a region on its own; otherwise take the first two-letter subtag after the language.
  if (parts.length === 1) return /^[A-Za-z]{2}$/.test(parts[0]!) && parts[0] === parts[0]!.toUpperCase() ? parts[0]!.toUpperCase() : null;
  for (const p of parts.slice(1)) if (/^[A-Za-z]{2}$/.test(p)) return p.toUpperCase();
  return null;
}
