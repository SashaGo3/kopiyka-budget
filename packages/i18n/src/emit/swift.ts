/**
 * The Swift output: `Localizable.xcstrings` (Xcode compiles it into each bundle's .lproj) and
 * `KPStrings.swift`, typed accessors over it — `L10n.Watch.title`, `L10n.Watch.daysLeft(count: 3)` —
 * that resolve through `KPL` (native/KPLocale.swift), which honours the language chosen in the app.
 *
 * Keys keep their full name in the catalogue (`native.watch.title`), so an App Intent can name one as
 * a literal `LocalizedStringResource` and iOS finds it in the same table.
 *
 * A String Catalog's plural varies the whole string, so a plural is hoisted to the top: text around
 * it is copied into every branch. `=0` becomes the catalogue's "zero" case, which iOS honours for 0 in
 * every language; any other `=N` has no Swift equivalent and is refused by the checker.
 */
import { config, outputsOf } from "../../i18n.config";
import type { Entry, Locale } from "../load";
import { argsOf, parse, type Node } from "../parse";

type Arg = { name: string; kind: "simple" | "plural" };

function orderedArgs(ast: Node[]): Arg[] {
  return [...argsOf(ast)].map(([name, a]) => ({ name, kind: a.kind === "plural" ? "plural" : "simple" }));
}

function esc(s: string) { return s.replace(/%/g, "%%"); }

/** Text of a node list with arguments as positional printf specifiers. */
function flat(ast: Node[], args: Arg[], pluralArg: string | null): string {
  let s = "";
  for (const n of ast) {
    if (n.t === "text") s += esc(n.v);
    else if (n.t === "arg") { const i = args.findIndex((a) => a.name === n.name) + 1; s += `%${i}$${args[i - 1]!.kind === "plural" ? "lld" : "@"}`; }
    else if (n.t === "pound") { const i = args.findIndex((a) => a.name === pluralArg) + 1; s += `%${i}$lld`; }
    else throw new Error(`unexpected ${n.t} in a native message`);
  }
  return s;
}

/** The message as either one string or a set of plural branches, ready for the catalogue. */
export function nativeForm(message: string, args: Arg[]): { value: string } | { plural: Record<string, string> } {
  const ast = parse(message);
  const idx = ast.findIndex((n) => n.t === "plural");
  if (idx < 0) return { value: flat(ast, args, null) };
  const p = ast[idx] as Extract<Node, { t: "plural" }>;
  const before = ast.slice(0, idx), after = ast.slice(idx + 1);
  const plural: Record<string, string> = {};
  for (const [k, branch] of Object.entries(p.cases)) {
    if (k.startsWith("=") && k !== "=0") throw new Error(`"${k}" has no native equivalent (only =0)`);
    plural[k === "=0" ? "zero" : k] = flat([...before, ...branch, ...after], args, p.name);
  }
  return { plural };
}

const SWIFT_KEYWORDS = new Set(["associatedtype", "fileprivate", "typealias", "rethrows", "throws", "Protocol", "default", "in", "for", "if", "else", "return", "switch", "case", "while", "repeat", "class", "struct", "enum", "func", "var", "let", "import", "self", "Self", "true", "false", "nil", "is", "as", "where", "do", "try", "catch", "throw", "static", "private", "public", "internal", "protocol", "extension", "operator", "init", "deinit", "subscript", "break", "continue", "fallthrough", "guard", "defer", "inout", "super", "Type", "Any"]);
/** A parameter name: a keyword in backticks, there and in the body. */
const ident = (s: string) => (SWIFT_KEYWORDS.has(s) ? `\`${s}\`` : s);
/**
 * A member or nested type: after a dot, `X.self`, `X.Type`, `X.Protocol` and `X.init` mean the type
 * itself (backticks or not), so those take a trailing underscore — `L10n.Type_`. Other keywords are
 * fine in backticks and need none at the call site: `L10n.Watch.default`.
 */
const AFTER_DOT = new Set(["self", "Self", "Type", "Protocol", "init"]);
const member = (s: string) => (AFTER_DOT.has(s) ? `${s}_` : ident(s));
const typeName = (s: string) => member(s[0]!.toUpperCase() + s.slice(1));
/** Code-point order, the same on every machine (localeCompare follows the machine's language). */
const byCodePoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * JSON the way Xcode writes a String Catalog — two-space indent and `" : "` between key and value —
 * so a save from Xcode is a no-op diff. Written out rather than patched into JSON.stringify's output,
 * where a `": ` inside a value would be rewritten too.
 */
function xcodeJson(v: unknown, indent = ""): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  const inner = indent + "  ";
  if (Array.isArray(v)) return v.length ? `[\n${v.map((x) => inner + xcodeJson(x, inner)).join(",\n")}\n${indent}]` : "[]";
  const entries = Object.entries(v).filter(([, x]) => x !== undefined);
  return entries.length ? `{\n${entries.map(([k, x]) => `${inner}${JSON.stringify(k)} : ${xcodeJson(x, inner)}`).join(",\n")}\n${indent}}` : "{}";
}

export function emitSwift(locales: Map<string, Locale>): Record<string, string> {
  const source = locales.get(config.source)!;
  const entries = [...source.values()].filter((e) => outputsOf(e.namespace).includes("swift")).sort((a, b) => byCodePoint(a.key, b.key));

  const strings: Record<string, unknown> = {};
  for (const e of entries) {
    const args = orderedArgs(parse(e.message));
    const localizations: Record<string, unknown> = {};
    for (const { code } of config.languages) {
      const m = locales.get(code)?.get(e.key);
      if (!m) continue;
      const form = nativeForm(m.message, args);
      localizations[code] = "value" in form
        ? { stringUnit: { state: "translated", value: form.value } }
        : { variations: { plural: Object.fromEntries(Object.entries(form.plural).map(([k, v]) => [k, { stringUnit: { state: "translated", value: v } }])) } };
    }
    strings[e.key] = { ...(e.note ? { comment: e.note } : {}), extractionState: "manual", localizations };
  }
  // Xcode writes the catalogue with " : " separators; matching it keeps a save from Xcode a no-op diff.
  const xcstrings = xcodeJson({ sourceLanguage: config.source, strings, version: "1.0" }) + "\n";

  // Accessors, nested by key path: native.watch.title → L10n.Watch.title
  type Tree = { groups: Map<string, Tree>; leaves: Entry[] };
  const root: Tree = { groups: new Map(), leaves: [] };
  // Accessors only for `native`: other Swift-bound namespaces (preset) are looked up by computed key.
  for (const e of entries.filter((x) => x.namespace === "native")) {
    const path = e.key.split(".").slice(1, -1);
    let t = root;
    for (const seg of path) { if (!t.groups.has(seg)) t.groups.set(seg, { groups: new Map(), leaves: [] }); t = t.groups.get(seg)!; }
    t.leaves.push(e);
  }
  const lines: string[] = [];
  const render = (t: Tree, indent: string) => {
    for (const e of t.leaves) {
      const name = member(e.key.split(".").pop()!);
      const args = orderedArgs(parse(e.message));
      if (e.note) lines.push(`${indent}/// ${e.note.replace(/\n/g, " ")}`);
      const english = e.message.replace(/\n/g, "\\n");
      lines.push(`${indent}/// "${english}"`);
      if (!args.length) lines.push(`${indent}static var ${name}: String { KPL.string(${JSON.stringify(e.key)}) }`);
      else {
        // A keyword is a fine label but not a name to read in the body: `for` is written `\`for\`` in both.
        const params = args.map((a) => `${ident(a.name)}: ${a.kind === "plural" ? "Int" : "String"}`).join(", ");
        lines.push(`${indent}static func ${name}(${params}) -> String { KPL.string(${JSON.stringify(e.key)}, ${args.map((a) => ident(a.name)).join(", ")}) }`);
      }
    }
    for (const [seg, sub] of [...t.groups].sort(([a], [b]) => byCodePoint(a, b))) {
      lines.push(`${indent}enum ${typeName(seg)} {`);
      render(sub, indent + "  ");
      lines.push(`${indent}}`);
    }
  };
  render(root, "  ");
  const swift = `// Generated by \`bun run i18n\` from packages/i18n/locales/*/native.json. Do not edit.
// The lookup itself, and how the app's language reaches the extensions, is native/KPLocale.swift.
import Foundation

enum L10n {
${lines.join("\n")}
}
`;
  return { "Localizable.xcstrings": xcstrings, "KPStrings.swift": swift };
}
