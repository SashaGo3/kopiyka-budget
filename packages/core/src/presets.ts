/**
 * Ready-made categories for a fresh install, and how a category that came from them is named.
 *
 * Seeding writes the name in the language the app is in at the time, and records where the row came
 * from in `categories.preset` ("food.groceries"). From then on the name shown is decided by one rule
 * (DATA.md rule 16): **a preset category is translated for as long as its stored name is still one of
 * that preset's own names, in any language.** Rename "Groceries" to "Їжа" and it is yours, shown as
 * you wrote it; leave it alone and it follows the app from English to Ukrainian and back. No flag to
 * keep in step, so a rename made on another phone, in an edited export or by an older build counts
 * the same as one made here. Icon, colour, folder — none of that matters; only the name decides.
 *
 * Read names through `categoryName`, never off the row, for the same reason `archivedCategoryIds`
 * and `categoryImportance` exist: a rule honoured by three callers and ignored by the fourth shows the
 * same category under two names.
 */
import { LANGUAGES, SOURCE } from "@kopiyka/i18n/generated";
import type { SqlDriver } from "./db";
import type { Category } from "./models";
import { createCategory, listRows } from "./repo";
import { categoryTypes, suggestCategoryTypes, typeIsStated } from "./categoryTypes";
import { nameLooksIn, suggestName } from "./commonNames";
import { CATEGORY_PRESET, FORMER_PRESET_NAMES, presetDescription, presetKey, presetName } from "./presetData";

export { CATEGORY_PRESET, presetDescription, presetKey, presetName, type PresetCategory, type PresetFolder } from "./presetData";

const norm = (s: string) => s.trim().toLocaleLowerCase();

/** Is `name` still one of this preset's own names, in any language, current or former? Case and spacing aside. */
export function isPresetName(preset: string, name: string): boolean {
  const n = norm(name);
  if (FORMER_PRESET_NAMES[preset]?.some((f) => norm(f) === n)) return true;
  return LANGUAGES.some((l) => { const own = presetName(preset, l.code); return own !== null && norm(own) === n; });
}

function isPresetDescription(preset: string, d: string): boolean {
  const n = norm(d);
  return LANGUAGES.some((l) => { const own = presetDescription(preset, l.code); return own !== null && norm(own) === n; });
}

type Named = Pick<Category, "name"> & { preset?: string | null; names?: string | null };
type Described = Pick<Category, "description"> & { preset?: string | null };

/**
 * The name to show for a category in `lang`:
 *  1. the name it was given in that language (`names`, v27) — which may be its own name, kept on purpose;
 *  2. a ready-made one's, while it still has the preset's name;
 *  3. one named in another language than `lang` — the app's language changed after it was named —
 *     in `lang` when `COMMON_NAMES` knows it ("Cats" reads «Коти»), so nobody has to translate
 *     "Rent" by hand;
 *  4. what the user wrote.
 */
export function categoryName(c: Named, lang: string): string {
  const own = categoryNames(c.names)[lang];
  if (own) return own;
  return autoName(c, lang);
}

/**
 * Every name a category goes by — as stored, as given in each language, and as shown in each language —
 * for search: typing "cats" finds «Коти» on a Ukrainian phone, and «продукти» finds "Groceries".
 */
export function categorySearchNames(c: Named): string[] {
  return [...new Set([c.name, ...Object.values(categoryNames(c.names)), ...LANGUAGES.map((l) => categoryName(c, l.code))])];
}

/** What `categoryName` shows when the category has no name of its own in `lang`. */
export function autoName(c: Named, lang: string): string {
  if (c.preset && isPresetName(c.preset, c.name)) return presetName(c.preset, lang) ?? c.name;
  if (!nameLooksIn(c.name, lang)) return suggestName(c.name, lang) ?? c.name;
  return c.name;
}

/**
 * A category's own names in other languages (`categories.names`, v27): `{"uk": "Коти"}`. Whatever is
 * not a non-empty string is dropped, and a column that is not JSON reads as none, so a hand-edited
 * backup can only lose a translation, never break a name.
 */
export function categoryNames(json: string | null | undefined): Record<string, string> {
  if (!json) return {};
  try {
    const v: unknown = JSON.parse(json);
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    const out: Record<string, string> = {};
    for (const [k, n] of Object.entries(v)) if (typeof n === "string" && n.trim()) out[k] = n.trim();
    return out;
  } catch { return {}; }
}

/**
 * What to store for `names` on category `c` (its stored `name` and `preset` as they will be saved):
 * the languages that have a name of their own, NULL when none does. A name that is what the category
 * would read anyway (`autoName`) says nothing and is left out — so it keeps following the suggestion —
 * while its own `name` kept in a language it would otherwise be translated in is stored: that is a choice.
 */
export function namesToStore(names: Record<string, string>, c: Named): string | null {
  const out: Record<string, string> = {};
  for (const [k, n] of Object.entries(names)) { const v = n.trim(); if (v && v !== autoName(c, k)) out[k] = v; }
  return Object.keys(out).length ? JSON.stringify(out) : null;
}

/** The description to show (and edit) in `lang` — the preset's while it is untouched, else the user's own. */
export function categoryDescription(c: Described, lang: string): string | null {
  if (!c.preset || !c.description || !isPresetDescription(c.preset, c.description)) return c.description;
  return presetDescription(c.preset, lang) ?? c.description;
}

/**
 * What the receipt reader matches a shop against. An untouched preset description is every language's
 * list at once: a Ukrainian receipt says "хліб" whatever language the app is in, and a phone set to
 * English still shops at Сільпо.
 */
export function categoryMatchText(c: Described): string | null {
  if (!c.preset || !c.description || !isPresetDescription(c.preset, c.description)) return c.description;
  return LANGUAGES.map((l) => presetDescription(c.preset!, l.code)).filter(Boolean).join(", ");
}

export function presetCounts(): { folders: number; categories: number } {
  return { folders: CATEGORY_PRESET.length, categories: CATEGORY_PRESET.reduce((n, f) => n + f.categories.length, 0) };
}

/**
 * Create the preset, named in `lang`. A folder or category that is already there — by preset key, or
 * by a name the preset uses in any language — is reused, so running twice adds nothing.
 */
export function seedCategories(db: SqlDriver, lang: string = SOURCE, only?: ReadonlySet<string>): { created: number; folders: Category[] } {
  const existing = listRows(db, "categories", "deleted=0");
  const find = (parent: string | null, preset: string) =>
    existing.find((c) => (c.parent_id ?? null) === parent && (c.preset === preset || isPresetName(preset, c.name)));
  let created = 0, sort = existing.length;
  const folders: Category[] = [];
  db.transaction(() => {
    for (const f of CATEGORY_PRESET) {
      const fk = presetKey(f.key);
      // Adding a few later (`only`): a folder is made only to hold one of them.
      if (only && !f.categories.some((c) => only.has(presetKey(f.key, c.key)))) continue;
      let folder = find(null, fk);
      if (!folder) {
        folder = createCategory(db, { name: presetName(fk, lang)!, parent_id: null, icon: f.icon, color: f.color, kind: f.kind, sort: sort++, preset: fk });
        existing.push(folder); created++;
      }
      folders.push(folder);
      for (const c of f.categories) {
        const ck = presetKey(f.key, c.key);
        if (only && !only.has(ck)) continue;
        if (find(folder.id, ck)) continue;
        existing.push(createCategory(db, { name: presetName(ck, lang)!, parent_id: folder.id, icon: c.icon, color: f.color, kind: f.kind, sort: sort++, description: presetDescription(ck, lang), preset: ck }));
        created++;
      }
    }
  });
  return { created, folders };
}

/**
 * The ready-made categories this database has nothing for, by key — what Settings offers to add to a
 * phone set up before they existed (1.1.2 added Parking, Bank fees, Accountant & legal, Donations).
 * "Nothing for" means no live category was made from it *and* none of yours already is that kind of
 * thing: a "Bank Fees" of your own, typed or suggested by its name, is the bank fees category already.
 */
export function missingPresets(db: SqlDriver): string[] {
  const cats = listRows(db, "categories", "deleted=0");
  const had = new Set<string>();
  const folders = new Set(cats.filter((c) => c.parent_id).map((c) => c.parent_id!));
  const byId = new Map(cats.map((c) => [c.id, c]));
  for (const c of cats) {
    if (c.preset) had.add(c.preset);
    if (folders.has(c.id)) continue;
    const said = categoryTypes(c);
    const ts = said.length || typeIsStated(c) ? said : suggestCategoryTypes(c.name, c.kind, c.parent_id ? byId.get(c.parent_id)?.name : null);
    for (const t of ts) had.add(t);
  }
  return CATEGORY_PRESET.flatMap((f) => f.categories.map((c) => presetKey(f.key, c.key))).filter((k) => !had.has(k));
}
