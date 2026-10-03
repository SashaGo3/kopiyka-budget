/**
 * The shape of the ready-made categories — keys, icons, colours — importing nothing from core, so the
 * schema's v18 backfill can read it without a cycle (schema → presets → repo → schema). Names and descriptions
 * are translations and live in packages/i18n/locales/<lang>/preset.json under the same keys:
 * `preset.food.name`, `preset.food.groceries.name`, `preset.food.groceries.description`.
 *
 * A key is forever. It is what `categories.preset` holds, and renaming one orphans every category
 * created from it on every phone (they would quietly stop being translated).
 */
import { formatToString } from "@kopiyka/i18n";
import { catalog, SOURCE } from "@kopiyka/i18n/generated";

export interface PresetCategory { key: string; icon: string }
export interface PresetFolder { key: string; icon: string; color: string; kind: "expense" | "income"; categories: PresetCategory[] }

export const CATEGORY_PRESET: PresetFolder[] = [
  { key: "food", icon: "cart.fill", color: "#FF9F0A", kind: "expense", categories: [
    { key: "groceries", icon: "cart.fill" },
    { key: "restaurants", icon: "fork.knife" },
    { key: "coffee", icon: "cup.and.saucer.fill" },
  ] },
  { key: "shopping", icon: "bag.fill", color: "#FF375F", kind: "expense", categories: [
    { key: "household", icon: "bag.fill" },
    { key: "clothes", icon: "tshirt.fill" },
    { key: "electronics", icon: "gamecontroller.fill" },
    { key: "wishes", icon: "star.fill" },
  ] },
  { key: "home", icon: "house.fill", color: "#8E8E93", kind: "expense", categories: [
    { key: "rent", icon: "house.fill" },
    { key: "utilities", icon: "bolt.fill" },
    { key: "internet", icon: "antenna.radiowaves.left.and.right" },
    { key: "furniture", icon: "wrench.and.screwdriver.fill" },
  ] },
  { key: "transport", icon: "car.fill", color: "#30D158", kind: "expense", categories: [
    { key: "car", icon: "car.fill" },
    { key: "fuel", icon: "fuelpump.fill" },
    { key: "publicTransport", icon: "bus.fill" },
    { key: "taxi", icon: "car.fill" },
  ] },
  { key: "health", icon: "cross.case.fill", color: "#FF2D55", kind: "expense", categories: [
    { key: "pharmacy", icon: "cross.case.fill" },
    { key: "doctor", icon: "heart.fill" },
    { key: "vitamins", icon: "leaf.fill" },
    { key: "gym", icon: "figure.run" },
  ] },
  { key: "personal", icon: "scissors", color: "#BF5AF2", kind: "expense", categories: [
    { key: "beauty", icon: "scissors" },
    { key: "education", icon: "book.fill" },
    { key: "hobbies", icon: "sparkles" },
  ] },
  { key: "bills", icon: "doc.text.fill", color: "#FFD60A", kind: "expense", categories: [
    { key: "subscriptions", icon: "repeat" },
    { key: "insurance", icon: "shield.fill" },
    { key: "taxes", icon: "percent" },
  ] },
  { key: "fun", icon: "airplane", color: "#0A84FF", kind: "expense", categories: [
    { key: "entertainment", icon: "film.fill" },
    { key: "travel", icon: "airplane" },
    { key: "presents", icon: "gift.fill" },
  ] },
  { key: "family", icon: "person.2.fill", color: "#FF9F0A", kind: "expense", categories: [
    { key: "kids", icon: "figure.and.child.holdinghands" },
    { key: "pets", icon: "pawprint.fill" },
  ] },
  { key: "savings", icon: "building.columns.fill", color: "#34C759", kind: "expense", categories: [
    { key: "savings", icon: "building.columns.fill" },
    { key: "investments", icon: "chart.line.uptrend.xyaxis" },
  ] },
  { key: "income", icon: "banknote.fill", color: "#34C759", kind: "income", categories: [
    { key: "salary", icon: "banknote.fill" },
    { key: "freelance", icon: "creditcard.fill" },
    { key: "gifts", icon: "gift.fill" },
    { key: "other", icon: "banknote" },
  ] },
];

/** `categories.preset` for a folder ("food") or a category in one ("food.groceries"). */
export const presetKey = (folder: string, category?: string) => (category ? `${folder}.${category}` : folder);

function text(lang: string, key: string): string | null {
  const m = catalog(lang)?.[key] ?? catalog(SOURCE)?.[key];
  return m === undefined ? null : formatToString(lang, m);
}

/** A preset's name in `lang` ("food" → "Їжа"). Null for a key no preset has (a newer build's, say). */
export function presetName(preset: string, lang: string): string | null { return text(lang, `preset.${preset}.name`); }
/** A preset's receipt-matching keywords in `lang`. */
export function presetDescription(preset: string, lang: string): string | null { return text(lang, `preset.${preset}.description`); }

/**
 * v18: tag the categories an earlier build seeded in English with their preset key, so they start
 * following the app's language. Matched on the English name under the matching folder — matching by
 * name is otherwise off limits (DATA.md rule 1), and is allowed here only because it labels a row and
 * never merges or replaces one. `updated_at` is left alone on purpose: forty untouched categories
 * stamped "just now" would win the next merge against the other phone (rule 15's warning).
 */
export function presetBackfillSql(): string[] {
  const en = (k: string) => presetName(k, "en")!.toLowerCase().replace(/'/g, "''");
  const out: string[] = [];
  for (const f of CATEGORY_PRESET) {
    out.push(`UPDATE categories SET preset='${f.key}' WHERE preset IS NULL AND parent_id IS NULL AND lower(trim(name))='${en(f.key)}'`);
    for (const c of f.categories) {
      const k = presetKey(f.key, c.key);
      out.push(`UPDATE categories SET preset='${k}' WHERE preset IS NULL AND lower(trim(name))='${en(k)}' AND parent_id IN (SELECT id FROM categories WHERE preset='${f.key}')`);
    }
  }
  return out;
}
