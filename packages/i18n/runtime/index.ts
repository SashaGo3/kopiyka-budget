/**
 * The translation runtime: everything that runs on the phone (and in Bun, for core and the scripts).
 *
 * Messages arrive already compiled (src/compile.ts), so nothing is parsed here. A message with no
 * arguments is a plain string and costs one property read; the rest are small arrays:
 *
 *   "text"                    literal text
 *   [0, name]                 an argument
 *   [1]                       `#` — the plural's number, formatted for the language (a count passed
 *                             as a string, "1.50", prints as given with the language's decimal mark)
 *   [2, name, { case: msg }]  plural ("=0", "one", "few", …, "other")
 *   [3, name, { case: msg }]  select
 *   [4, tag, msg]             a tag, handed to the caller's renderer
 *
 * The format is data, not code, on purpose: a catalogue can be swapped at runtime, loaded lazily,
 * or one day read from a file, without shipping a build.
 */
import { pluralCategory } from "./plurals";

export type Part = string | [0, string] | [1] | [2, string, Record<string, Msg>] | [3, string, Record<string, Msg>] | [4, string, Msg];
export type Msg = string | Part[];
export type Catalog = Record<string, Msg>;
export type Vars = Record<string, string | number | undefined | null>;

export { pluralCategory, hasPluralRule, CATEGORIES, type PluralCategory } from "./plurals";

/** Format a number the way the language writes it ("1 234" in Ukrainian, "1,234" in English). */
export function formatNumber(lang: string, n: number): string {
  try { return new Intl.NumberFormat(lang).format(n); } catch { return String(n); }
}

const decimals = new Map<string, string>();
/** The language's decimal mark, "." or ",". */
function decimalMark(lang: string): string {
  let d = decimals.get(lang);
  if (d === undefined) { d = formatNumber(lang, 1.5).replace(/\d/g, "") || "."; decimals.set(lang, d); }
  return d;
}

/**
 * `#`. A number is formatted for the language; a string is printed as the caller wrote it — its
 * decimals are what chose the plural form ("1.0" is "other" in English), so they must show — with only
 * the decimal mark made the language's own.
 */
function formatPound(lang: string, pound: number | string): string {
  if (typeof pound === "number") return formatNumber(lang, pound);
  return /^-?\d+\.\d+$/.test(pound) ? pound.replace(".", decimalMark(lang)) : pound;
}

const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

function pickCase(lang: string, cases: Record<string, Msg>, value: unknown): Msg {
  const n = typeof value === "number" ? value : Number(value);
  const exact = cases[`=${n}`];
  if (exact !== undefined) return exact;
  return cases[pluralCategory(lang, Number.isFinite(n) ? (typeof value === "string" ? value : n) : 0)] ?? cases.other!;
}

/**
 * Render a message to segments: strings, and `{ tag, children }` for each tag. `formatToString`
 * flattens tags away; a UI layer maps them to bold text or links.
 */
export type Segment = string | { tag: string; children: Segment[] };

export function formatParts(lang: string, msg: Msg, vars: Vars = {}, pound: number | string | null = null): Segment[] {
  if (typeof msg === "string") return [msg];
  const out: Segment[] = [];
  const push = (s: Segment) => {
    if (typeof s === "string" && typeof out[out.length - 1] === "string") out[out.length - 1] += s;
    else out.push(s);
  };
  for (const p of msg) {
    if (typeof p === "string") { push(p); continue; }
    switch (p[0]) {
      // A plain argument is printed as given: a year, a day of the month or an amount already
      // formatted by the caller must not be regrouped. Only `#`, a plural's count, is formatted.
      case 0: { const v = vars[p[1]]; push(v === undefined || v === null ? "" : String(v)); break; }
      case 1: push(pound === null ? "" : formatPound(lang, pound)); break;
      case 2: {
        const v = vars[p[1]];
        const n = typeof v === "number" ? v : Number(v ?? 0);
        // A string count keeps its own digits for `#`, the same ones that picked the case.
        const shown = typeof v === "string" && Number.isFinite(n) ? v.trim() : n;
        for (const s of formatParts(lang, pickCase(lang, p[2], v ?? 0), vars, shown)) push(s);
        break;
      }
      case 3: {
        const v = String(vars[p[1]] ?? "");
        // Own cases only: "constructor" is not a case, whatever Object.prototype says.
        for (const s of formatParts(lang, own(p[2], v) ? p[2][v]! : p[2].other!, vars, pound)) push(s);
        break;
      }
      case 4: out.push({ tag: p[1], children: formatParts(lang, p[2], vars, pound) }); break;
    }
  }
  return out;
}

function flatten(parts: Segment[]): string {
  let s = "";
  for (const p of parts) s += typeof p === "string" ? p : flatten(p.children);
  return s;
}

export function formatToString(lang: string, msg: Msg, vars?: Vars): string {
  return typeof msg === "string" ? msg : flatten(formatParts(lang, msg, vars));
}

/**
 * A translator over a set of catalogues. `lookup` falls back to the source language, then to the key
 * itself — loud in development (`onMissing`), harmless in a shipped build.
 */
export function createTranslator(opts: {
  source: string;
  catalog: (lang: string) => Catalog | null;
  onMissing?: (key: string, lang: string) => void;
}) {
  const lookup = (lang: string, key: string): { lang: string; msg: Msg } => {
    const own = opts.catalog(lang)?.[key];
    if (own !== undefined) return { lang, msg: own };
    opts.onMissing?.(key, lang);
    const src = opts.catalog(opts.source)?.[key];
    return src !== undefined ? { lang: opts.source, msg: src } : { lang, msg: key };
  };
  return {
    has: (lang: string, key: string) => opts.catalog(lang)?.[key] !== undefined,
    string: (lang: string, key: string, vars?: Vars) => { const m = lookup(lang, key); return formatToString(m.lang, m.msg, vars); },
    parts: (lang: string, key: string, vars?: Vars) => { const m = lookup(lang, key); return formatParts(m.lang, m.msg, vars); },
  };
}
