/**
 * What kind of thing a category is, whatever it is called (DATA.md rule 21).
 *
 * A shop's name says what it sells — Biedronka sells groceries, Orlen fuel — but not what *you* call
 * the category you file it under: "Groceries", "Їжа вдома", "Lidl & co". So a shop is matched to a
 * type (shops.ts), and the type to whichever of your categories carries it.
 *
 * The vocabulary is the ready-made categories' keys ("food.groceries") plus a few kinds no preset
 * seeds ("transport.parking"). A key is forever, like a preset's (rule 16): it is what the rows hold.
 *
 * A category may be several kinds at once ("Car": fuel and parking), so the column holds a JSON list.
 * Read it through `categoryTypes`, never off the column:
 *   - a list — said by a person (or accepted by one from a suggestion);
 *   - "[]" (or the older "none") — no type, on purpose (a renamed preset that is no longer what it was);
 *   - `type` NULL — not said: a ready-made category answers with its `preset`, which is why nothing
 *     had to be backfilled for anyone already using the default categories, and why a preset renamed
 *     to "Їжа вдома" still takes Biedronka. A category you made answers with nothing until a type is
 *     chosen; `suggestCategoryTypes` proposes some from its name for the editor and the review list.
 */
import { LANGUAGES } from "@kopiyka/i18n/generated";
import { CATEGORY_PRESET, FORMER_PRESET_NAMES, presetDescription, presetKey, presetName } from "./presetData";
import type { SqlDriver } from "./db";
import { archivedCategoryIds, folderIds, listRows } from "./repo";
import { shopType } from "./shops";
import { normalizeName } from "./logos";

/**
 * Kinds a shop can be that no ready-made category is seeded for. Names live in preset.json under the
 * same key. (Parking was one until it became a ready-made category in 1.1.2.) Cash taken out of an
 * ATM is not spending on anything yet, and a bike or scooter ride is not a car — both matter to
 * whoever has a category for them, and to nobody else's starting list.
 */
export const EXTRA_CATEGORY_TYPES: { key: string; icon: string; folder: string }[] = [
  { key: "transport.bike", icon: "bicycle", folder: "transport" },
  { key: "personal.cash", icon: "banknote", folder: "personal" },
];

/** Every type, grouped under the ready-made folder it belongs with, in the order a picker shows them. */
export const CATEGORY_TYPES: { folder: string; kind: "expense" | "income"; types: { key: string; icon: string }[] }[] = CATEGORY_PRESET.map((f) => ({
  folder: f.key,
  kind: f.kind,
  types: [
    ...f.categories.map((c) => ({ key: presetKey(f.key, c.key), icon: c.icon })),
    ...EXTRA_CATEGORY_TYPES.filter((x) => x.folder === f.key).map((x) => ({ key: x.key, icon: x.icon })),
  ],
}));

const KNOWN = new Set(CATEGORY_TYPES.flatMap((g) => g.types.map((t) => t.key)));
export const NO_TYPE = "none";

export function isCategoryType(key: string | null | undefined): key is string { return !!key && KNOWN.has(key); }

/** A type's name in `lang` ("food.groceries" → "Продукти"). */
export function categoryTypeName(key: string, lang: string): string { return presetName(key, lang) ?? key; }
export function categoryTypeIcon(key: string): string { return CATEGORY_TYPES.flatMap((g) => g.types).find((t) => t.key === key)?.icon ?? "tag.fill"; }

type Typed = { type?: string | null; preset?: string | null };

/**
 * What the column states, or null when it states nothing. A category can be several kinds of thing
 * at once — "Car" is fuel, parking and the car wash — so the column holds a JSON list
 * (`["transport.fuel","transport.parking"]`); `"[]"` and the older `"none"` are "no type, on
 * purpose", and a bare key (the first 1.1.2 build wrote one) is a list of one. Unknown keys are
 * dropped, so a newer build's type never reaches this one as an error.
 */
function statedTypes(raw: string | null | undefined): string[] | null {
  if (raw == null || raw === "") return null;
  if (raw === NO_TYPE) return [];
  if (raw.startsWith("[")) {
    try { const v = JSON.parse(raw); return Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && KNOWN.has(x)))] : null; } catch { return null; }
  }
  return KNOWN.has(raw) ? [raw] : null;
}

/** What kinds of thing this category is; empty when nothing says. The one place the column is read. */
export function categoryTypes(c: Typed): string[] {
  return statedTypes(c.type) ?? (isCategoryType(c.preset) ? [c.preset] : []);
}

/** Was the answer given on the row itself, rather than taken from its preset? */
export function typeIsStated(c: Typed): boolean { return statedTypes(c.type) !== null; }

/**
 * What to store for `types` on a row with this `preset`: NULL while the list is just what the preset
 * already says (so it keeps following it), otherwise the list — `"[]"` for "none, on purpose".
 */
export function typesToStore(types: string[], preset: string | null | undefined): string | null {
  const list = [...new Set(types.filter((x) => KNOWN.has(x)))];
  if (isCategoryType(preset) && list.length === 1 && list[0] === preset) return null;
  if (!list.length && !isCategoryType(preset)) return null;
  return JSON.stringify(list);
}

/** The words that stand for a type: its names and keywords in every language, normalised. */
let words: { key: string; names: Set<string>; phrases: string[]; own: Set<string> }[] | null = null;
function typeWords() {
  if (words) return words;
  words = [...KNOWN].map((key) => {
    const names = new Set<string>();
    const phrases: string[] = [];
    for (const l of LANGUAGES) {
      const n = presetName(key, l.code);
      if (n) names.add(normalizeName(n));
      const d = presetDescription(key, l.code);
      // Three letters is enough for a keyword someone listed on purpose: ZUS, PIT, VAT, ETF, bar.
      if (d) for (const p of d.split(",")) { const w = normalizeName(p); if (w.length >= 3) phrases.push(w); }
    }
    for (const f of FORMER_PRESET_NAMES[key] ?? []) names.add(normalizeName(f));
    // The name's own words count as keywords too: "Coffee" is a word of "Coffee & snacks".
    const own = new Set<string>();
    for (const n of [...names]) {
      phrases.push(n); // a whole name is a keyword at any length: "Car" in "Car (general)"
      for (const w of n.split(" ")) if (w.length >= 4) { phrases.push(w); own.add(w); }
    }
    for (const n of names) own.add(n);
    return { key, names, phrases, own };
  });
  return words;
}

const hasWord = (hay: string, w: string) => (` ${hay} `).includes(` ${w} `);

/**
 * The types a category's name suggests, most certain first; empty when it suggests none. A name that
 * *is* a type's name, in any language, decides on its own ("Паркування"). Otherwise every type whose
 * keyword the name contains as whole words — "Taxi & parking" is both, "Coffee with friends" is
 * coffee — and failing that, a shop the category is named after ("Lidl"). Only a suggestion: it is
 * shown, and kept only when a person saves it.
 */
export function suggestCategoryTypes(name: string, kind: "expense" | "income" = "expense", folder?: string | null): string[] {
  const own = typesForName(name, kind);
  if (!folder) return own;
  // The folder a category is in narrows what its name means and stands in when the name says nothing:
  // "Maintenance" in "Car" is the car's, and "General" in "Car" is still the car.
  const { groups: near, broad } = folderGroups(folder, kind);
  if (!near.size) return own;
  if (own.length) { const inside = own.filter((k) => near.has(k.split(".")[0]!)); return inside.length ? inside : own; }
  // Only a folder that is one kind of thing can speak for what is in it: "Car" can, "Shopping" — a
  // ready-made folder of four kinds — cannot.
  if (broad) return [];
  const fromFolder = typesForName(folder, kind);
  return fromFolder.length === 1 ? fromFolder : [];
}

/**
 * The ready-made folders a folder's name points at: itself when it is one of their names, in any
 * language ("Transport", "Транспорт"), else the folders of whatever types its name suggests ("Car").
 */
function folderGroups(folder: string, kind: "expense" | "income"): { groups: Set<string>; broad: boolean } {
  const n = normalizeName(folder);
  const out = new Set<string>();
  for (const g of CATEGORY_TYPES) {
    if (g.kind !== kind) continue;
    const names = [...LANGUAGES.map((l) => presetName(g.folder, l.code)), ...(FORMER_PRESET_NAMES[g.folder] ?? [])];
    if (names.some((x) => x && normalizeName(x) === n)) out.add(g.folder);
  }
  if (out.size) return { groups: out, broad: true };
  for (const k of typesForName(folder, kind)) out.add(k.split(".")[0]!);
  return { groups: out, broad: false };
}

function typesForName(name: string, kind: "expense" | "income"): string[] {
  const n = normalizeName(name);
  if (!n) return [];
  const inKind = new Set(CATEGORY_TYPES.filter((g) => g.kind === kind).flatMap((g) => g.types.map((t) => t.key)));
  const all = typeWords().filter((t) => inKind.has(t.key));
  const exact = all.find((t) => t.names.has(n));
  if (exact) return [exact.key];
  // Which types each matched word points at. A word that is a type's own name ("parking") belongs
  // to that type alone, even when another lists it among its keywords (Car: "parking, tolls…").
  const byWord = new Map<string, { key: string; own: boolean }[]>();
  for (const t of all) for (const p of t.phrases) {
    if (hasWord(n, p) || hasWord(p, n)) byWord.set(p, [...(byWord.get(p) ?? []), { key: t.key, own: t.own.has(p) }]);
  }
  // A keyword the name *is* ("Health" is the doctor's "health") outranks one that merely contains it
  // ("health insurance"), however long that one is.
  const hits = new Map<string, number>();
  for (const [p, list] of byWord) {
    const keep = list.some((x) => x.own) ? list.filter((x) => x.own) : list;
    const score = p === n ? 1000 : p.length;
    for (const x of keep) if (score > (hits.get(x.key) ?? 0)) hits.set(x.key, score);
  }
  const sure = [...hits].filter(([, v]) => v >= 1000);
  if (sure.length) return sure.map(([k]) => k).slice(0, 3);
  if (hits.size) return [...hits].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k);
  const shop = shopType(name);
  return shop && inKind.has(shop) ? [shop] : [];
}

/** A payee as evidence: its words without the numbers (store number, terminal, date) banks add. */
const payeeKey = (p: string | null | undefined) => (p ? normalizeName(p).split(" ").filter((w) => !/\d/.test(w)).join(" ") : "");

/**
 * What the payments filed under each category say it is, by category id — computed for every
 * category, used for the ones that have not said. Two kinds of evidence, payment by payment:
 *
 * - **Your own filing.** A payee you also pay from a category that has a type speaks for that type:
 *   "Payments" to the landlord "Rent" is paid to is rent. Only when that payee is filed under one
 *   kind of thing — Circle K under Fuel and under Eating Out says nothing either way.
 * - **The shop list** (shops.ts), for a payee nothing else of yours knows.
 *
 * Only payments with a payee count — a hand-typed row with none says nothing, for or against. A type
 * is offered when at least two payments speak for it, they are most of what speaks, and most of the
 * payments with a payee; a shop-list guess must also be a good share of the category's rows, because a
 * petrol station sells more than fuel (Sodastream refills: a few Circle K rows out of many).
 * The last two years are enough to know a category by, and keep the scan cheap.
 */
export function suggestTypesFromHistory(db: SqlDriver, since: string = new Date(Date.now() - 730 * 86_400_000).toISOString()): Map<string, string[]> {
  const cats = listRows(db, "categories", "deleted=0");
  const kindOf = new Map(cats.map((c) => [c.id, c.kind]));
  const typed = new Map(cats.map((c) => [c.id, categoryTypes(c)]).filter(([, t]) => (t as string[]).length) as [string, string[]][]);
  const rows = db.all<{ category_id: string; payee: string | null; notes: string | null; bank_note: string | null }>(
    `SELECT category_id, payee, notes, bank_note FROM transactions
     WHERE deleted=0 AND category_id IS NOT NULL AND transfer_id IS NULL AND date>=?`, [since]);

  // Which kinds of thing each payee is filed under, by the categories that say what they are.
  const filed = new Map<string, Map<string, Set<string>>>(); // payee → type → categories
  for (const r of rows) {
    const k = payeeKey(r.payee), ts = typed.get(r.category_id);
    if (!k || !ts) continue;
    const m = filed.get(k) ?? new Map<string, Set<string>>();
    for (const ty of ts) m.set(ty, (m.get(ty) ?? new Set()).add(r.category_id));
    filed.set(k, m);
  }
  const ownVote = (k: string, self: string): string | null => {
    const m = filed.get(k);
    if (!m) return null;
    const others = [...m].filter(([, ids]) => [...ids].some((id) => id !== self));
    return others.length === 1 ? others[0]![0] : null;
  };

  const per = new Map<string, { total: number; spoken: number; votes: Map<string, { n: number; own: number }> }>();
  for (const r of rows) {
    const e = per.get(r.category_id) ?? { total: 0, spoken: 0, votes: new Map() };
    per.set(r.category_id, e);
    e.total++;
    const k = payeeKey(r.payee) || payeeKey(r.bank_note);
    if (!k) continue;
    e.spoken++;
    const own = ownVote(k, r.category_id);
    const ty = own ?? shopType(r.payee, r.bank_note, r.notes);
    if (!ty) continue;
    const v = e.votes.get(ty) ?? { n: 0, own: 0 };
    v.n++; if (own) v.own++;
    e.votes.set(ty, v);
  }
  const out = new Map<string, string[]>();
  for (const [id, e] of per) {
    const kind = kindOf.get(id) ?? "expense";
    const inKind = new Set(CATEGORY_TYPES.filter((g) => g.kind === kind).flatMap((g) => g.types.map((t) => t.key)));
    const ranked = [...e.votes].filter(([k]) => inKind.has(k)).sort((a, b) => b[1].n - a[1].n);
    const top = ranked[0];
    if (!top) continue;
    const known = ranked.reduce((a, [, v]) => a + v.n, 0);
    const [type, v] = top;
    const enough = v.n >= 2 && v.n >= known * 0.6 && v.n >= e.spoken * 0.4;
    const broad = v.own > 0 || v.n >= e.total * 0.4;
    if (enough && broad) out.set(id, [type]);
  }
  return out;
}

type Cat = { id: string; parent_id: string | null; archived: 0 | 1; kind: "expense" | "income"; type?: string | null; preset?: string | null };

/**
 * The categories a type would be filed into: live, pickable (not a folder, not archived) and carrying
 * that type. Several may — "Groceries" and "Lidl" both groceries — and the caller picks among them.
 */
export function categoriesOfType<T extends Cat>(cats: T[], type: string): T[] {
  const folders = folderIds(cats), gone = archivedCategoryIds(cats);
  return cats.filter((c) => !folders.has(c.id) && !gone.has(c.id) && categoryTypes(c).includes(type));
}

/**
 * The category a well-known shop would be filed into, or null: the shop's type (shops.ts), then the
 * category of yours carrying it — the one used most in the last 90 days when several do. Only a
 * guess, for a shop history knows nothing about; the caller logs it pending (rule 21).
 */
export function categoryForShop(db: SqlDriver, ...names: (string | null | undefined)[]): string | null {
  const type = shopType(...names);
  if (!type) return null;
  const hits = categoriesOfType(listRows(db, "categories", "deleted=0", [], "sort, name"), type);
  if (hits.length <= 1) return hits[0]?.id ?? null;
  // The most specific first — "Groceries" over "Food & coffee & lunch" — then the most used lately.
  const width = (c: (typeof hits)[number]) => categoryTypes(c).length;
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const uses = new Map(db.all<{ category_id: string; n: number }>(
    `SELECT category_id, COUNT(*) AS n FROM transactions WHERE deleted=0 AND date>=? AND category_id IN (${hits.map(() => "?").join(",")}) GROUP BY category_id`,
    [since, ...hits.map((h) => h.id)]).map((r) => [r.category_id, r.n]));
  return [...hits].sort((a, b) => width(a) - width(b) || (uses.get(b.id) ?? 0) - (uses.get(a.id) ?? 0))[0]!.id;
}

/**
 * Kinds of thing whose payments say nothing about where they were made: paid in the car park beside
 * the supermarket, at the end of a ride, or from the sofa. A category whose every type is one of
 * these is left out of location suggestions unless it is let back in (`locationIgnoredIds`, repo.ts).
 * A category that is also something place-bound ("Car": fuel and parking) still counts.
 */
export const PLACELESS_TYPES: readonly string[] = [
  "transport.parking", "transport.taxi", "transport.publicTransport", "transport.bike", "personal.cash",
  "home.rent", "home.utilities", "home.internet",
  "bills.subscriptions", "bills.insurance", "bills.taxes", "bills.fees",
  "savings.savings", "savings.investments",
];
const PLACELESS = new Set(PLACELESS_TYPES);
export function isPlaceless(c: Typed): boolean { const ts = categoryTypes(c); return ts.length > 0 && ts.every((x) => PLACELESS.has(x)); }
