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
import { CATEGORY_PRESET, presetDescription, presetKey, presetName } from "./presetData";

export { CATEGORY_PRESET, presetDescription, presetKey, presetName, type PresetCategory, type PresetFolder } from "./presetData";

const norm = (s: string) => s.trim().toLocaleLowerCase();

/** Is `name` still one of this preset's own names, in any language? Case and spacing aside. */
export function isPresetName(preset: string, name: string): boolean {
  const n = norm(name);
  return LANGUAGES.some((l) => { const own = presetName(preset, l.code); return own !== null && norm(own) === n; });
}

function isPresetDescription(preset: string, d: string): boolean {
  const n = norm(d);
  return LANGUAGES.some((l) => { const own = presetDescription(preset, l.code); return own !== null && norm(own) === n; });
}

type Named = Pick<Category, "name"> & { preset?: string | null };
type Described = Pick<Category, "description"> & { preset?: string | null };

/** The name to show for a category: its preset's, in `lang`, while unrenamed; otherwise what the user wrote. */
export function categoryName(c: Named, lang: string): string {
  if (!c.preset || !isPresetName(c.preset, c.name)) return c.name;
  return presetName(c.preset, lang) ?? c.name;
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
export function seedCategories(db: SqlDriver, lang: string = SOURCE): { created: number; folders: Category[] } {
  const existing = listRows(db, "categories", "deleted=0");
  const find = (parent: string | null, preset: string) =>
    existing.find((c) => (c.parent_id ?? null) === parent && (c.preset === preset || isPresetName(preset, c.name)));
  let created = 0, sort = existing.length;
  const folders: Category[] = [];
  db.transaction(() => {
    for (const f of CATEGORY_PRESET) {
      const fk = presetKey(f.key);
      let folder = find(null, fk);
      if (!folder) {
        folder = createCategory(db, { name: presetName(fk, lang)!, parent_id: null, icon: f.icon, color: f.color, kind: f.kind, sort: sort++, preset: fk });
        existing.push(folder); created++;
      }
      folders.push(folder);
      for (const c of f.categories) {
        const ck = presetKey(f.key, c.key);
        if (find(folder.id, ck)) continue;
        existing.push(createCategory(db, { name: presetName(ck, lang)!, parent_id: folder.id, icon: c.icon, color: f.color, kind: f.kind, sort: sort++, description: presetDescription(ck, lang), preset: ck }));
        created++;
      }
    }
  });
  return { created, folders };
}
