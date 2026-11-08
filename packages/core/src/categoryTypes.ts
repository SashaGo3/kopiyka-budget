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
 * Read a category's type through `categoryType`, never off the column:
 *   - `type` set to a known key — that, said by a person (or accepted by one from a suggestion);
 *   - `type` = "none" — no type, on purpose (a renamed preset that is no longer what it was);
 *   - `type` NULL — not said: a ready-made category answers with its `preset`, which is why nothing
 *     had to be backfilled for anyone already using the default categories, and why a preset renamed
 *     to "Їжа вдома" still takes Biedronka. A category you made answers with nothing until a type is
 *     chosen; `suggestCategoryType` proposes one from its name for the editor and the review list.
 */
import { LANGUAGES } from "@kopiyka/i18n/generated";
import { CATEGORY_PRESET, FORMER_PRESET_NAMES, presetDescription, presetKey, presetName } from "./presetData";
import type { SqlDriver } from "./db";
import { archivedCategoryIds, folderIds, listRows } from "./repo";
import { shopType } from "./shops";
import { normalizeName } from "./logos";

/** Kinds a shop can be that no ready-made category is seeded for. Names live in preset.json under the same key. */
export const EXTRA_CATEGORY_TYPES: { key: string; icon: string; folder: string }[] = [
  { key: "transport.parking", icon: "parkingsign", folder: "transport" },
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

/** What kind of category this is, or null. The one place the column is read (see the file comment). */
export function categoryType(c: Typed): string | null {
  if (c.type === NO_TYPE) return null;
  if (isCategoryType(c.type)) return c.type;
  return isCategoryType(c.preset) ? c.preset : null;
}

/** Was the answer given on the row itself, rather than taken from its preset? */
export function typeIsStated(c: Typed): boolean { return c.type === NO_TYPE || isCategoryType(c.type); }

/** The words that stand for a type: its names and keywords in every language, normalised. */
let words: { key: string; names: Set<string>; phrases: string[] }[] | null = null;
function typeWords() {
  if (words) return words;
  words = [...KNOWN].map((key) => {
    const names = new Set<string>();
    const phrases: string[] = [];
    for (const l of LANGUAGES) {
      const n = presetName(key, l.code);
      if (n) names.add(normalizeName(n));
      const d = presetDescription(key, l.code);
      if (d) for (const p of d.split(",")) { const w = normalizeName(p); if (w.length >= 4) phrases.push(w); }
    }
    for (const f of FORMER_PRESET_NAMES[key] ?? []) names.add(normalizeName(f));
    // The name's own words count as keywords too: "Coffee" is a word of "Coffee & snacks".
    for (const n of [...names]) for (const w of n.split(" ")) if (w.length >= 4) phrases.push(w);
    return { key, names, phrases };
  });
  return words;
}

const hasWord = (hay: string, w: string) => (` ${hay} `).includes(` ${w} `);

/**
 * The type a category's name suggests, or null. A name that *is* a type's name, in any language,
 * decides ("Паркування"); otherwise the longest keyword the name contains as whole words ("Kawa i
 * ciastka" → nothing, "Coffee with friends" → coffee). Only a suggestion: it is shown, and kept only
 * when a person saves it.
 */
export function suggestCategoryType(name: string, kind: "expense" | "income" = "expense"): string | null {
  const n = normalizeName(name);
  if (!n) return null;
  const inKind = new Set(CATEGORY_TYPES.filter((g) => g.kind === kind).flatMap((g) => g.types.map((t) => t.key)));
  const all = typeWords().filter((t) => inKind.has(t.key));
  const exact = all.find((t) => t.names.has(n));
  if (exact) return exact.key;
  let best: { key: string; len: number } | null = null;
  for (const t of all) for (const p of t.phrases) {
    if (p.length > (best?.len ?? 0) && (hasWord(n, p) || hasWord(p, n))) best = { key: t.key, len: p.length };
  }
  if (best) return best.key;
  // A category named after a shop ("Lidl", "Kino") is what that shop sells.
  const shop = shopType(name);
  return shop && inKind.has(shop) ? shop : null;
}

type Cat = { id: string; parent_id: string | null; archived: 0 | 1; kind: "expense" | "income"; type?: string | null; preset?: string | null };

/**
 * The categories a type would be filed into: live, pickable (not a folder, not archived) and carrying
 * that type. Several may — "Groceries" and "Lidl" both groceries — and the caller picks among them.
 */
export function categoriesOfType<T extends Cat>(cats: T[], type: string): T[] {
  const folders = folderIds(cats), gone = archivedCategoryIds(cats);
  return cats.filter((c) => !folders.has(c.id) && !gone.has(c.id) && categoryType(c) === type);
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
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const uses = new Map(db.all<{ category_id: string; n: number }>(
    `SELECT category_id, COUNT(*) AS n FROM transactions WHERE deleted=0 AND date>=? AND category_id IN (${hits.map(() => "?").join(",")}) GROUP BY category_id`,
    [since, ...hits.map((h) => h.id)]).map((r) => [r.category_id, r.n]));
  return [...hits].sort((a, b) => (uses.get(b.id) ?? 0) - (uses.get(a.id) ?? 0))[0]!.id;
}
