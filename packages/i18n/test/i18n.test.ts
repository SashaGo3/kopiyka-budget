import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CATEGORIES, hasPluralRule, pluralCategory } from "../runtime/plurals";
import { createTranslator, formatParts, formatToString } from "../runtime";
import { longest, parse, plainText } from "../src/parse";
import { compile } from "../src/compile";
import { check, type Problem } from "../src/check";
import { loadAll } from "../src/load";
import { build } from "../src/cli";
import { emitSwift, nativeForm } from "../src/emit/swift";
import { emitAndroid } from "../src/emit/android";
import { emitFlat } from "../src/emit/flat";
import { config } from "../i18n.config";

/** Message files in a temporary directory, loaded the way the real ones are. */
function load(files: Record<string, Record<string, unknown>>) {
  const dir = mkdtempSync(join(tmpdir(), "i18n-"));
  for (const [path, json] of Object.entries(files)) {
    const [lang, ns] = path.split("/");
    mkdirSync(join(dir, lang!), { recursive: true });
    writeFileSync(join(dir, lang!, `${ns}.json`), JSON.stringify(json));
  }
  return loadAll(dir);
}

describe("plural rules", () => {
  // Bun ships full ICU, so its Intl.PluralRules is the reference the hand-written rules must match.
  for (const lang of Object.keys(CATEGORIES)) {
    test(`${lang} agrees with Intl.PluralRules`, () => {
      const ref = new Intl.PluralRules(lang);
      expect([...CATEGORIES[lang]!].sort()).toEqual([...ref.resolvedOptions().pluralCategories].sort());
      for (let n = 0; n <= 1000; n++) expect([n, pluralCategory(lang, n)]).toEqual([n, ref.select(n)]);
      for (const n of [0.5, 1.5, 2.25, 11.1, 21.3]) expect([n, pluralCategory(lang, n)]).toEqual([n, ref.select(n)]);
      expect(pluralCategory(lang, 1_000_000)).toBe(ref.select(1_000_000) as never);
    });
  }
  test("every configured language has a rule", () => {
    for (const l of config.languages) expect(hasPluralRule(l.code)).toBe(true);
  });
});

describe("parse and format", () => {
  const fmt = (lang: string, src: string, vars?: Record<string, string | number>) => formatToString(lang, compile(parse(src)), vars);

  test("plain, arguments, apostrophes", () => {
    expect(fmt("en", "Let's go")).toBe("Let's go");
    expect(fmt("en", "Delete «{name}»?", { name: "Food" })).toBe("Delete «Food»?");
    expect(fmt("en", "Braces: '{'name'}' and '' one")).toBe("Braces: {name} and ' one");
    expect(compile(parse("Just text"))).toBe("Just text");
  });

  test("Ukrainian plurals, exact matches and the formatted #", () => {
    const m = "{n, plural, =0 {Нічого} one {# день} few {# дні} many {# днів} other {# дня}}";
    expect(fmt("uk", m, { n: 0 })).toBe("Нічого");
    expect(fmt("uk", m, { n: 1 })).toBe("1 день");
    expect(fmt("uk", m, { n: 3 })).toBe("3 дні");
    expect(fmt("uk", m, { n: 11 })).toBe("11 днів");
    expect(fmt("uk", m, { n: 22 })).toBe("22 дні");
    expect(fmt("uk", m, { n: 1.5 })).toBe("1,5 дня");
    expect(fmt("uk", m, { n: 2000 }).replace(/\s/g, " ")).toBe("2 000 днів");
  });

  test("a plain argument is printed as given, not regrouped", () => {
    expect(fmt("uk", "Рік {y}", { y: 2026 })).toBe("Рік 2026");
  });

  test("select and tags", () => {
    const m = "{kind, select, income {<b>Received</b> {who}} other {Paid}}";
    expect(fmt("en", m, { kind: "income", who: "Ann" })).toBe("Received Ann");
    expect(fmt("en", m, { kind: "expense" })).toBe("Paid");
    expect(formatParts("en", compile(parse(m)), { kind: "income", who: "Ann" })).toEqual([{ tag: "b", children: ["Received"] }, " Ann"]);
  });

  test("anything outside the subset is refused", () => {
    expect(() => parse("{n, number}")).toThrow();
    expect(() => parse("{n, plural, one {x}}")).toThrow();
    expect(() => parse("<b>open")).toThrow();
    expect(() => parse("{n")).toThrow();
  });

  test("the translator falls back to the source, then to the key", () => {
    const tr = createTranslator({ source: "en", catalog: (l): Record<string, string> | null => (l === "en" ? { a: "A", b: "B" } : l === "uk" ? { a: "А" } : null) });
    expect(tr.string("uk", "a")).toBe("А");
    expect(tr.string("uk", "b")).toBe("B");
    expect(tr.string("uk", "c")).toBe("c");
  });
});

describe("native form", () => {
  test("a plural is hoisted with positional specifiers; =0 becomes zero", () => {
    const f = nativeForm("Left: {n, plural, =0 {nothing} one {# day} other {# days}}!", [{ name: "n", kind: "plural" }]);
    expect(f).toEqual({ plural: { zero: "Left: nothing!", one: "Left: %1$lld day!", other: "Left: %1$lld days!" } });
    expect(nativeForm("{a} and {b} — 100%", [{ name: "a", kind: "simple" }, { name: "b", kind: "simple" }])).toEqual({ value: "%1$@ and %2$@ — 100%%" });
  });
});

describe("checker", () => {
  const line = (p: Problem) => `${p.level === "warning" ? "warning " : ""}${p.lang} ${p.key}: ${p.message}`;
  const locales = (files: Record<string, Record<string, unknown>>) => check(load(files)).map(line);

  test("a clean pair passes", () => {
    expect(locales({
      "en/x": { a: "Hi {name}", n: { message: "{c, plural, one {# day} other {# days}}", max: 12 } },
      "uk/x": { a: "Привіт, {name}", n: "{c, plural, one {# день} few {# дні} many {# днів} other {# дня}}" },
    })).toEqual([]);
  });

  test("missing keys, wrong arguments, missing categories, length and apostrophes are caught", () => {
    const out = locales({
      "en/x": { a: "Hi {name}", b: "B", n: { message: "{c, plural, one {# day} other {# days}}", max: 10 }, ap: "Meat" },
      "uk/x": { a: "Привіт", n: "{c, plural, one {# день} other {# днів якихось довгих}}", ap: "М'ясо", extra: "x" },
    });
    expect(out.some((l) => l.includes("x.b: missing"))).toBe(true);
    expect(out.some((l) => l.includes("does not use {name}"))).toBe(true);
    expect(out.some((l) => l.includes("needs few, many"))).toBe(true);
    expect(out.some((l) => l.includes("over the limit of 10"))).toBe(true);
    expect(out.some((l) => l.includes("ʼ"))).toBe(true);
    expect(out.some((l) => l.includes("x.extra: not in the source"))).toBe(true);
  });

  test("native messages stay inside what a String Catalog can say", () => {
    const out = locales({
      "en/native": { s: "{k, select, a {A} other {B}}", p: "{n, plural, one {# of {total}} other {# of {total}}}" },
      "uk/native": { s: "{k, select, a {А} other {Б}}", p: "{n, plural, one {# з {total}} few {# з {total}} many {# з {total}} other {# з {total}}}" },
    });
    expect(out.some((l) => l.includes("no select"))).toBe(true);
    expect(out.some((l) => l.includes("takes only its count"))).toBe(true);
  });
});

describe("fixes", () => {
  const fmt = (lang: string, src: string, vars?: Record<string, string | number>) => formatToString(lang, compile(parse(src)), vars);
  const days = "{n, plural, one {# day} other {# days}}";

  test("the xcstrings separators leave quotes inside a value alone", () => {
    const { "Localizable.xcstrings": xc } = emitSwift(load({ "en/native": { a: 'Tap "Save": done' }, "uk/native": { a: "Торкніться «Зберегти»" } }));
    expect(xc).toContain('"value" : "Tap \\"Save\\": done"');
    expect(JSON.parse(xc!).strings["native.a"].localizations.en.stringUnit.value).toBe('Tap "Save": done');
  });

  test("a count passed as a string prints as given, with the language's decimal separator", () => {
    expect(fmt("en", days, { n: "1.0" })).toBe("1.0 days");
    expect(fmt("uk", "{n, plural, one {# день} few {# дні} many {# днів} other {# дня}}", { n: "1.50" })).toBe("1,50 дня");
    expect(fmt("en", days, { n: 1 })).toBe("1 day");
  });

  test("a select case is never read off Object.prototype", () => {
    const m = "{k, select, a {A} other {Other}}";
    expect(fmt("en", m, { k: "constructor" })).toBe("Other");
    expect(fmt("en", m, { k: "toString" })).toBe("Other");
  });

  test("an ICU-escaped apostrophe in Ukrainian is still caught", () => {
    const out = check(load({ "en/x": { a: "Meat" }, "uk/x": { a: "М''ясо" } }));
    expect(out.some((p) => p.message.includes("ʼ"))).toBe(true);
    expect(check(load({ "en/x": { a: "Meat" }, "uk/x": { a: "Мʼясо" } }))).toEqual([]);
  });

  test("flat outputs are unescaped, placeholders kept", () => {
    const flat = emitFlat(load({ "en/site": { a: "It''s '{'x'}' for {name}", b: "Let's go" }, "uk/site": { a: "Це {name}", b: "Ходімо" } }), "site");
    expect(flat.en).toEqual({ "site.a": "It's {x} for {name}", "site.b": "Let's go" });
    expect(plainText(parse("<b>Hi</b> {who}"))).toBe("<b>Hi</b> {who}");
  });

  test("Android doubles % only where the string is formatted", () => {
    const files = emitAndroid(load({
      "en/native": { plain: "100% done", arg: "{p}% of {total}", n: "{n, plural, one {# day, 1%} other {# days, 1%}}" },
      "uk/native": { plain: "100% готово", arg: "{p}% з {total}", n: "{n, plural, one {# день, 1%} few {# дні, 1%} many {# днів, 1%} other {# дня, 1%}}" },
    }));
    const en = files["values/strings.xml"]!;
    expect(en).toContain('<string name="native_plain">100% done</string>');
    expect(en).toContain('<string name="native_arg">%1$s%% of %2$s</string>');
    expect(en).toContain('<item quantity="one">%1$d day, 1%%</item>');
  });

  test("=N cases in Android-bound messages are a warning: Android has no exact cases", () => {
    const out = check(load({
      "en/native": { n: "{n, plural, =0 {None} one {# day} other {# days}}" },
      "uk/native": { n: "{n, plural, =0 {Нічого} one {# день} few {# дні} many {# днів} other {# дня}}" },
    }));
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((p) => p.level === "warning" && p.message.includes("Android"))).toBe(true);
  });

  test("Swift keywords are escaped as parameter, member and type names", () => {
    const { "KPStrings.swift": swift } = emitSwift(load({
      "en/native": { type: { for: "For {for} in {in}", self: "Self" } },
      "uk/native": { type: { for: "Для {for} у {in}", self: "Сам" } },
    }));
    // `L10n.Type` would be the metatype, backticks or not.
    expect(swift).toContain("enum Type_ {");
    expect(swift).toContain('static func `for`(`for`: String, `in`: String) -> String { KPL.string("native.type.for", `for`, `in`) }');
    expect(swift).toContain("static var self_: String");
  });

  test("two keys landing on the same Android resource name are refused", () => {
    const out = check(load({ "en/native": { a_b: "One", a: { b: "Two" } }, "uk/native": { a_b: "Один", a: { b: "Два" } } }));
    expect(out.some((p) => p.level === "error" && p.message.includes("native_a_b"))).toBe(true);
  });

  test("Swift accessors sort by code point, not by the machine's locale", () => {
    const { "KPStrings.swift": swift } = emitSwift(load({ "en/native": { b: "b", B: "B", a: "a" }, "uk/native": { b: "b", B: "B", a: "a" } }));
    const order = [...swift!.matchAll(/native\.(\w+)"/g)].map((m) => m[1]);
    expect(order).toEqual(["B", "a", "b"]);
  });

  test("the length check sees the longest branch however many plurals there are", () => {
    // 2^8 combinations; the long branch is the last case of each, beyond any enumeration cap.
    const many = Array.from({ length: 8 }, (_, i) => `{a${i}, select, x {.} other {${i === 7 ? "a much longer branch" : "."}}}`).join("");
    expect(longest(parse(many))).toBe(".......a much longer branch");
    const out = check(load({ "en/x": { m: { message: many, max: 20 } }, "uk/x": { m: many } }));
    expect(out.some((p) => p.message.includes("over the limit of 20"))).toBe(true);
  });
});

describe("the real messages", () => {
  test("pass the checker and every generated file is up to date", () => {
    // build() throws with the full list when a message is wrong.
    const files = build();
    const stale = [...files].filter(([path, contents]) => {
      try { return require("node:fs").readFileSync(path, "utf8") !== contents; } catch { return true; }
    }).map(([p]) => p);
    expect(stale).toEqual([]);
  });
});
