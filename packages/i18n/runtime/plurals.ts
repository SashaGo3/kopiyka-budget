/**
 * Plural categories, one function per language, written out from the Unicode CLDR rules.
 *
 * Not `Intl.PluralRules`: Hermes does not implement it, and a translation that picks the wrong form
 * on the phone but the right one in a test is worse than no translation. So the rules live here,
 * shared by the app, the compiler and the scripts, and the "plural rules" tests in `test/i18n.test.ts`
 * hold each one against Bun's own `Intl.PluralRules` for every integer up to 1000 and a spread of
 * fractions — adding a language without a correct function fails the build, not a user's sentence.
 *
 * CLDR operands: `i` is the integer part, `v` the number of visible fraction digits, `f` those digits
 * as an integer. `1.50` and `1.5` are different numbers to the rules (v = 2 vs 1), so a caller that
 * formats with fixed decimals should pass the string it actually shows.
 */
export type PluralCategory = "zero" | "one" | "two" | "few" | "many" | "other";

interface Operands { n: number; i: number; v: number; f: number }

function operands(value: number | string): Operands {
  const s = typeof value === "number" ? String(Math.abs(value)) : value.replace(/^-/, "");
  const [int = "0", frac = ""] = s.split(".");
  return { n: Math.abs(Number(s)), i: Number(int), v: frac.length, f: frac ? Number(frac) : 0 };
}

type Rule = (o: Operands) => PluralCategory;

const RULES: Record<string, Rule> = {
  en: ({ i, v }) => (i === 1 && v === 0 ? "one" : "other"),
  uk: ({ i, v }) => {
    if (v !== 0) return "other";
    const m10 = i % 10, m100 = i % 100;
    if (m10 === 1 && m100 !== 11) return "one";
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return "few";
    return "many";
  },
  pl: ({ i, v }) => {
    if (v !== 0) return "other";
    if (i === 1) return "one";
    const m10 = i % 10, m100 = i % 100;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return "few";
    return "many";
  },
  de: ({ i, v }) => (i === 1 && v === 0 ? "one" : "other"),
  es: ({ n, i, v }) => (n === 1 ? "one" : i !== 0 && i % 1_000_000 === 0 && v === 0 ? "many" : "other"),
};

/** The categories a language uses, in CLDR order — what the checker requires every plural to cover. */
export const CATEGORIES: Record<string, PluralCategory[]> = {
  en: ["one", "other"],
  uk: ["one", "few", "many", "other"],
  pl: ["one", "few", "many", "other"],
  de: ["one", "other"],
  es: ["one", "many", "other"],
};

export function hasPluralRule(lang: string): boolean { return lang in RULES; }

/** The category `value` falls in for `lang`. A language with no rule here answers "other". */
export function pluralCategory(lang: string, value: number | string): PluralCategory {
  const rule = RULES[lang];
  return rule ? rule(operands(value)) : "other";
}
