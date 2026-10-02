/**
 * Every rule the messages have to pass before anything is generated. A failure stops `bun run i18n`
 * and `bun test`, so a broken translation never reaches a build.
 *
 *  - every language has exactly the source language's keys;
 *  - each message parses, and uses the same arguments, used the same way, and the same tags;
 *  - each plural covers every category its language has (Ukrainian: one, few, many, other) and none it
 *    does not, and the language has a plural rule the runtime knows;
 *  - `max` holds for every branch of every language;
 *  - Swift-bound messages stay inside what a String Catalog can express;
 *  - website and store text is plain text;
 *  - Ukrainian writes the apostrophe as ʼ (U+02BC), the letter, not ' or ’ (escaped as '' or not);
 *  - no two Android-bound keys share a resource name.
 *
 * Warnings do not stop anything; they are printed: an `=N` case in a message Android reads (it falls
 * back to the plural category there).
 */
import { config, outputsOf } from "../i18n.config";
import { CATEGORIES, hasPluralRule } from "../runtime/plurals";
import { androidName } from "./emit/android";
import type { Entry, Locale } from "./load";
import { argsOf, literalText, longest, parse, ParseError, pluralsOf, tagsOf, type Node } from "./parse";

export interface Problem { level: "error" | "warning"; lang: string; key: string; file?: string; message: string }

function hasKind(ast: Node[], kind: Node["t"]): boolean {
  for (const n of ast) {
    if (n.t === kind) return true;
    if (n.t === "plural" || n.t === "select") { if (Object.values(n.cases).some((c) => hasKind(c, kind))) return true; }
    else if (n.t === "tag" && hasKind(n.children, kind)) return true;
  }
  return false;
}

/** Inside a word: letters on both sides. "Let's" in English is fine; "м'ясо" in Ukrainian is not. */
const UK_APOSTROPHE = /\p{L}['’`]\p{L}/u;

export function check(locales: Map<string, Locale>): Problem[] {
  const problems: Problem[] = [];
  const err = (lang: string, e: Pick<Entry, "key" | "file">, message: string) => problems.push({ level: "error", lang, key: e.key, file: e.file, message });
  const warn = (lang: string, e: Pick<Entry, "key" | "file">, message: string) => problems.push({ level: "warning", lang, key: e.key, file: e.file, message });

  const source = locales.get(config.source);
  if (!source || source.size === 0) return [{ level: "error", lang: config.source, key: "*", message: "the source language has no messages" }];

  const parsed = new Map<string, Map<string, Node[]>>();
  for (const [lang, locale] of locales) {
    const m = new Map<string, Node[]>();
    if (!hasPluralRule(lang)) problems.push({ level: "error", lang, key: "*", message: `no plural rule for "${lang}" — add it to runtime/plurals.ts` });
    for (const e of locale.values()) {
      try { m.set(e.key, parse(e.message)); }
      catch (x) { err(lang, e, x instanceof ParseError ? x.message : String(x)); }
    }
    parsed.set(lang, m);
  }

  const src = parsed.get(config.source)!;

  // Android resource names have no dots: `a.b_c` and `a_b.c` would both be `a_b_c`.
  const resources = new Map<string, Entry>();
  for (const e of source.values()) {
    if (!outputsOf(e.namespace).includes("android")) continue;
    const name = androidName(e.key);
    const other = resources.get(name);
    if (other) err(config.source, e, `is the Android resource ${name}, the same as ${other.key} — rename one`);
    else resources.set(name, e);
  }
  for (const [lang, locale] of locales) {
    const asts = parsed.get(lang)!;
    if (lang !== config.source) {
      for (const k of source.keys()) if (!locale.has(k)) err(lang, source.get(k)!, `missing (${lang}/${source.get(k)!.namespace}.json)`);
      for (const e of locale.values()) if (!source.has(e.key)) err(lang, e, "not in the source language — renamed or removed there?");
    }
    for (const e of locale.values()) {
      const ast = asts.get(e.key);
      const srcEntry = source.get(e.key);
      const srcAst = src.get(e.key);
      if (!ast || !srcEntry) continue;
      const outs = outputsOf(srcEntry.namespace);

      // Arguments and tags match the source.
      if (srcAst && lang !== config.source) {
        const a = argsOf(ast), b = argsOf(srcAst);
        for (const [name, s] of b) {
          const t = a.get(name);
          if (!t) { err(lang, e, `does not use {${name}}`); continue; }
          if (t.kind !== s.kind) err(lang, e, `{${name}} is a ${s.kind} in ${config.source} but a ${t.kind} here`);
          if (s.kind === "select") for (const o of t.options) if (!s.options.has(o)) err(lang, e, `{${name}} has a case "${o}" the source does not`);
        }
        for (const name of a.keys()) if (!b.has(name)) err(lang, e, `uses {${name}}, which the source does not pass`);
        const ta = [...tagsOf(ast)].sort().join(), tb = [...tagsOf(srcAst)].sort().join();
        if (ta !== tb) err(lang, e, `tags <${ta}> differ from the source's <${tb}>`);
      }

      // Plural categories: exactly the language's own (plus any =N).
      const cats = CATEGORIES[lang];
      if (cats) for (const p of pluralsOf(ast)) {
        const keys = Object.keys(p.cases).filter((k) => !k.startsWith("="));
        const missing = cats.filter((c) => !keys.includes(c));
        const extra = keys.filter((k) => !cats.includes(k as never));
        if (missing.length) err(lang, e, `{${p.name}, plural} needs ${missing.join(", ")} in ${lang}`);
        if (extra.length) err(lang, e, `{${p.name}, plural} has ${extra.join(", ")}, which ${lang} never uses`);
      }

      // Length.
      if (srcEntry.max) {
        const v = longest(ast);
        if ([...v].length > srcEntry.max) err(lang, e, `"${v}" is ${[...v].length} characters, over the limit of ${srcEntry.max}`);
      }

      // What each output can carry.
      if (outs.includes("swift") || outs.includes("android")) {
        if (hasKind(ast, "select")) err(lang, e, "a String Catalog has no select — use two keys");
        if (hasKind(ast, "tag")) err(lang, e, "native messages carry no tags");
        const plurals = pluralsOf(ast);
        if (plurals.length > 1) err(lang, e, "native messages hold at most one plural");
        if (plurals.length === 1) {
          // A catalogue's plural varies the whole string by one number; it has no way to say which
          // of several arguments that is, so a plural message takes its count and nothing else.
          if (argsOf(ast).size > 1) err(lang, e, "a native plural message takes only its count — move the rest into another key");
          if (!ast.some((n) => n.t === "plural")) err(lang, e, "a native plural cannot sit inside a tag or select");
          for (const k of Object.keys(plurals[0]!.cases)) {
            if (k.startsWith("=") && k !== "=0") err(lang, e, `${k} has no native equivalent; only =0 does`);
            // Android's quantities are the language's categories only (its "zero" is used only by a
            // language that has one), so an exact case is dropped there and the number's own category
            // shows instead: "0 days" for "Nothing". Readable, but not what was written.
            else if (k.startsWith("=") && outs.includes("android")) warn(lang, e, `${k} is dropped on Android, which has no exact cases — the number's own plural form shows there instead`);
          }
        }
      }
      if (outs.includes("site") || outs.includes("store") || outs.includes("demo") || outs.includes("expo")) {
        if (hasKind(ast, "plural") || hasKind(ast, "select")) err(lang, e, "website, store, demo and Info.plist text is plain — no plural or select");
        if (outs.includes("expo") && hasKind(ast, "arg")) err(lang, e, "Info.plist strings take no arguments");
      }

      if (lang === "uk" && UK_APOSTROPHE.test(literalText(ast))) err(lang, e, "write the apostrophe as ʼ (U+02BC), not ' or ’");
    }
  }
  return problems;
}
