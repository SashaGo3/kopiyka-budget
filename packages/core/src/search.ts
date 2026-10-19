/**
 * Search: what a transaction can be found by, and how loosely. Pure, so the app decides what goes
 * into an entry (names as they are shown, in the app's language) and this decides whether it matches.
 *
 * Every word typed has to be found somewhere in the entry — "coffee kraków" narrows, it does not
 * widen — and a word is found when it is in the text as typed, or, from four letters on, close to the
 * start of one of its words: one slip allowed, two from eight letters ("starbuks", "grocceries").
 * Case and accents are ignored on both sides, in any alphabet (SQL `LIKE` folds ASCII only, so
 * "кава" never found "Кава"). A number is matched against the amounts instead: "12.50" is exactly
 * that, "12" is anything from 12.00 to 12.99 and any amount starting 12, as it always was.
 */

export interface SearchEntry {
  /** Normalised text, words separated by single spaces. */
  text: string;
  words: string[];
  /** Amounts in minor units, sign dropped: the account's and the original it was entered in. */
  amounts: number[];
}

export type SearchToken = { kind: "text"; text: string } | { kind: "number"; minor: number | null; whole: string };

/** Lower case, accents and apostrophes gone, everything that is not a letter or a digit a space. */
export function searchText(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/['’ʼ`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function searchEntry(fields: (string | null | undefined)[], amounts: (number | null | undefined)[]): SearchEntry {
  const text = searchText(fields.filter(Boolean).join(" "));
  return { text, words: text ? [...new Set(text.split(" "))] : [], amounts: amounts.filter((a): a is number => a != null).map(Math.abs) };
}

const NUMBER = /^[-+]?(\d+)(?:[.,](\d{1,2}))?$/;

export function searchTokens(q: string): SearchToken[] {
  const out: SearchToken[] = [];
  for (const raw of q.trim().split(/\s+/)) {
    if (!raw) continue;
    const n = NUMBER.exec(raw);
    if (n) { out.push({ kind: "number", whole: n[1]!, minor: n[2] !== undefined ? Number(n[1]) * 100 + Number(n[2]!.padEnd(2, "0")) : null }); continue; }
    for (const w of searchText(raw).split(" ")) if (w) out.push({ kind: "text", text: w });
  }
  return out;
}

/** Edit distance with transpositions, given up on as soon as it is past `max`. */
function within(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  let prev2: number[] = [], prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      let v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2]! + 1);
      cur.push(v); if (v < best) best = v;
    }
    if (best > max) return false;
    prev2 = prev; prev = cur;
  }
  return prev[b.length]! <= max;
}

function textFound(e: SearchEntry, token: string): boolean {
  if (e.text.includes(token)) return true;
  if (token.length < 4) return false;
  const max = token.length >= 8 ? 2 : 1;
  // Against the start of each word, a letter longer or shorter: what is typed is often half a word.
  return e.words.some((w) => w.length >= token.length - max &&
    (within(token, w.slice(0, token.length), max) || within(token, w.slice(0, token.length + 1), max) || within(token, w.slice(0, token.length - 1), max)));
}

function numberFound(e: SearchEntry, t: Extract<SearchToken, { kind: "number" }>): boolean {
  if (t.minor !== null) return e.amounts.includes(t.minor);
  if (e.amounts.some((a) => String(Math.floor(a / 100)).startsWith(t.whole))) return true;
  // A number in a name or a note ("7-eleven", "flat 12") is found at the start of a word.
  return e.words.some((w) => w.startsWith(t.whole));
}

export function searchMatches(e: SearchEntry, tokens: SearchToken[]): boolean {
  return tokens.every((t) => (t.kind === "number" ? numberFound(e, t) : textFound(e, t.text)));
}
