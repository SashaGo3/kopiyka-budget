/**
 * The message syntax: a deliberately small subset of ICU MessageFormat.
 *
 *   plain text                         Hello
 *   an argument                        Delete «{name}»?
 *   a plural, `#` is the number        {count, plural, =0 {None} one {# day} other {# days}}
 *   a select                           {kind, select, income {Received} other {Paid}}
 *   a tag, mapped by the caller        Tap <b>Save</b> when done
 *
 * Apostrophes follow ICU's "double optional" rule: `''` is one apostrophe, and a single one only
 * starts quoting when the next character is syntax (`{`, `}`, `<`, or `#` inside a plural). So
 * "Let's go" needs no escaping. Ukrainian is required to use ʼ (U+02BC) anyway — see check.ts.
 *
 * Anything outside the subset (`number`, `date`, `selectordinal`, offsets) is a parse error rather
 * than something one runtime understands and another ignores: three runtimes read these messages
 * and they have to agree.
 */
export type Node =
  | { t: "text"; v: string }
  | { t: "arg"; name: string }
  | { t: "pound" }
  | { t: "plural"; name: string; cases: Record<string, Node[]> }
  | { t: "select"; name: string; cases: Record<string, Node[]> }
  | { t: "tag"; name: string; children: Node[] };

export class ParseError extends Error {}

const NAME = /[A-Za-z_][A-Za-z0-9_]*/y;
const PLURAL_KEY = /(=\d+|zero|one|two|few|many|other)/y;
const SELECT_KEY = /[A-Za-z0-9_-]+/y;

export function parse(src: string): Node[] {
  let pos = 0;

  const fail = (msg: string): never => { throw new ParseError(`${msg} at ${pos} in: ${src}`); };
  const ws = () => { while (pos < src.length && /\s/.test(src[pos]!)) pos++; };
  const eat = (re: RegExp): string | null => {
    re.lastIndex = pos;
    const m = re.exec(src);
    if (!m) return null;
    pos += m[0].length;
    return m[0];
  };
  const expect = (ch: string) => { if (src[pos] !== ch) fail(`expected "${ch}"`); pos++; };

  function nodes(inPlural: boolean, closeTag: string | null): Node[] {
    const out: Node[] = [];
    let text = "";
    const flush = () => { if (text) { out.push({ t: "text", v: text }); text = ""; } };
    while (pos < src.length) {
      const ch = src[pos]!;
      if (ch === "'") {
        const next = src[pos + 1];
        if (next === "'") { text += "'"; pos += 2; continue; }
        if (next === "{" || next === "}" || next === "<" || (inPlural && next === "#")) {
          pos++;
          while (pos < src.length) {
            if (src[pos] === "'" && src[pos + 1] === "'") { text += "'"; pos += 2; continue; }
            if (src[pos] === "'") { pos++; break; }
            text += src[pos++];
          }
          continue;
        }
        text += ch; pos++; continue;
      }
      if (ch === "}") break;
      if (ch === "#" && inPlural) { flush(); out.push({ t: "pound" }); pos++; continue; }
      if (ch === "{") { flush(); out.push(argument(inPlural)); continue; }
      if (ch === "<") {
        const close = /<\/([a-z][a-z0-9]*)>/y; close.lastIndex = pos;
        const cm = close.exec(src);
        if (cm) {
          if (cm[1] !== closeTag) fail(`unexpected </${cm[1]}>`);
          flush();
          return out;
        }
        const open = /<([a-z][a-z0-9]*)>/y; open.lastIndex = pos;
        const om = open.exec(src);
        if (om) {
          flush();
          pos += om[0].length;
          const children = nodes(inPlural, om[1]!);
          const end = `</${om[1]}>`;
          if (!src.startsWith(end, pos)) fail(`unclosed <${om[1]}>`);
          pos += end.length;
          out.push({ t: "tag", name: om[1]!, children });
          continue;
        }
      }
      text += ch; pos++;
    }
    if (closeTag) fail(`unclosed <${closeTag}>`);
    flush();
    return out;
  }

  function argument(inPlural: boolean): Node {
    expect("{"); ws();
    const name = eat(NAME) ?? fail("expected an argument name");
    ws();
    if (src[pos] === "}") { pos++; return { t: "arg", name }; }
    expect(","); ws();
    const kind = eat(NAME) ?? fail("expected plural or select");
    if (kind !== "plural" && kind !== "select") fail(`"${kind}" is not supported (only plural and select)`);
    ws(); expect(","); ws();
    const cases: Record<string, Node[]> = {};
    while (src[pos] !== "}") {
      if (pos >= src.length) fail("unclosed argument");
      const key = eat(kind === "plural" ? PLURAL_KEY : SELECT_KEY) ?? fail(`expected a ${kind} case`);
      if (key in cases) fail(`case "${key}" appears twice`);
      ws(); expect("{");
      cases[key] = nodes(kind === "plural" || inPlural, null);
      expect("}"); ws();
    }
    pos++;
    if (!("other" in cases)) fail(`a ${kind} needs an "other" case`);
    return kind === "plural" ? { t: "plural", name, cases } : { t: "select", name, cases };
  }

  const out = nodes(false, null);
  if (pos < src.length) fail("unexpected }");
  return out;
}

export type ArgKind = "plural" | "select" | "simple";

/** Every argument a message takes, with how it is used. A name used two ways is reported as plural/select over simple. */
export function argsOf(ast: Node[], into = new Map<string, { kind: ArgKind; options: Set<string> }>()) {
  for (const n of ast) {
    if (n.t === "arg") { if (!into.has(n.name)) into.set(n.name, { kind: "simple", options: new Set() }); }
    else if (n.t === "plural" || n.t === "select") {
      const cur = into.get(n.name);
      const entry = cur && cur.kind !== "simple" ? cur : { kind: n.t, options: new Set<string>() };
      for (const k of Object.keys(n.cases)) entry.options.add(k);
      into.set(n.name, entry);
      for (const c of Object.values(n.cases)) argsOf(c, into);
    } else if (n.t === "tag") argsOf(n.children, into);
  }
  return into;
}

export function tagsOf(ast: Node[], into = new Set<string>()): Set<string> {
  for (const n of ast) {
    if (n.t === "tag") { into.add(n.name); tagsOf(n.children, into); }
    else if (n.t === "plural" || n.t === "select") for (const c of Object.values(n.cases)) tagsOf(c, into);
  }
  return into;
}

/** Every plural in a message, wherever it is nested. */
export function pluralsOf(ast: Node[], into: Extract<Node, { t: "plural" }>[] = []) {
  for (const n of ast) {
    if (n.t === "plural") { into.push(n); for (const c of Object.values(n.cases)) pluralsOf(c, into); }
    else if (n.t === "select") for (const c of Object.values(n.cases)) pluralsOf(c, into);
    else if (n.t === "tag") pluralsOf(n.children, into);
  }
  return into;
}

/**
 * The longest plain text the message can produce, `#` and arguments shown as `sample` — what the length
 * check measures. Lengths add up along a message, so the longest whole is the longest branch of each
 * plural or select taken independently: no need to enumerate every combination of branches.
 */
export function longest(ast: Node[], sample = "99"): string {
  const len = (s: string) => [...s].length;
  let out = "";
  for (const n of ast) {
    if (n.t === "text") out += n.v;
    else if (n.t === "arg" || n.t === "pound") out += sample;
    else if (n.t === "tag") out += longest(n.children, sample);
    else out += Object.values(n.cases).map((c) => longest(c, sample)).reduce((a, b) => (len(b) > len(a) ? b : a));
  }
  return out;
}

/**
 * The message as plain text with ICU's quoting undone: `It''s '{'x'}'` → `It's {x}`. Arguments stay
 * `{name}` and tags `<b>…</b>`, for outputs whose reader fills them in itself. A plural or select has
 * no plain form, and the checker keeps them out of every output that reads this.
 */
export function plainText(ast: Node[]): string {
  let s = "";
  for (const n of ast) {
    if (n.t === "text") s += n.v;
    else if (n.t === "arg") s += `{${n.name}}`;
    else if (n.t === "tag") s += `<${n.name}>${plainText(n.children)}</${n.name}>`;
    else throw new Error(`a ${n.t === "pound" ? "#" : n.t} has no plain-text form`);
  }
  return s;
}

/**
 * Every run of literal text, unescaped, with arguments and branch boundaries as a non-letter — what a
 * check on the words themselves (the Ukrainian apostrophe) reads, so `''` cannot hide one.
 */
export function literalText(ast: Node[]): string {
  const GAP = "\uFFFC";
  let s = "";
  for (const n of ast) {
    if (n.t === "text") s += n.v;
    else if (n.t === "arg" || n.t === "pound") s += GAP;
    else if (n.t === "tag") s += literalText(n.children);
    else s += Object.values(n.cases).map(literalText).join(GAP);
  }
  return s;
}
