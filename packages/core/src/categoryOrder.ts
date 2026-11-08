/**
 * The order categories are listed in — folders, and the categories inside each — wherever the app
 * shows them as a tree: Settings → Categories, both category pickers, Category types.
 *
 * Two answers, kept in `meta.category_order` (a preference that travels with backups, DATA.md
 * rule 7):
 *   - `custom` (the default, and what every build before this one did): `categories.sort`, the order
 *     dragged into place on the Reorder screen, then the name;
 *   - `usage`: most used first, over the last 180 days (the window the picker's "recent" uses). A
 *     folder's usage is everything filed under its categories, so the folder you use most leads.
 *     Equal usage — two categories never used, say — falls back to the custom order, so a quiet
 *     corner of the list stays where it was put rather than shuffling alphabetically.
 *
 * Ordering only ever reads: nothing about a category changes because of where it is listed, and
 * `sort` is written only by the Reorder screen — or by `keepOrder`, when a usage order is kept as the
 * custom one. (A pre-release build offered `name` too; a phone or backup still holding it reads as
 * `custom`.)
 */
import type { SqlDriver } from "./db";
import { getMeta } from "./schema";
import { getRow, save } from "./repo";

export type CategoryOrder = "custom" | "usage";
export const CATEGORY_ORDERS: readonly CategoryOrder[] = ["custom", "usage"];
export const CATEGORY_ORDER_KEY = "category_order";
export const USAGE_DAYS = 180;

/** The order in use; anything unknown (a newer build's answer) reads as the default. */
export function getCategoryOrder(db: SqlDriver): CategoryOrder {
  const v = getMeta(db, CATEGORY_ORDER_KEY);
  return (CATEGORY_ORDERS as readonly string[]).includes(v ?? "") ? (v as CategoryOrder) : "custom";
}

/**
 * How many payments each category had in the last `days`, by id — and each folder the sum of what
 * is filed directly on it and under its categories.
 */
export function categoryUsage(db: SqlDriver, days = USAGE_DAYS, now = new Date()): Map<string, number> {
  const since = new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
  const rows = db.all<{ id: string; parent_id: string | null; n: number }>(
    `SELECT c.id, c.parent_id, COUNT(t.id) AS n FROM categories c
     JOIN transactions t ON t.category_id = c.id AND t.deleted = 0 AND t.date >= ?
     WHERE c.deleted = 0 GROUP BY c.id`, [since]);
  const out = new Map<string, number>();
  for (const r of rows) {
    out.set(r.id, (out.get(r.id) ?? 0) + r.n);
    if (r.parent_id) out.set(r.parent_id, (out.get(r.parent_id) ?? 0) + r.n);
  }
  return out;
}

type Orderable = { id: string; sort: number; name: string };

/**
 * `cats` in `mode`'s order. One comparator for the whole list: callers group by folder afterwards and
 * keep the order they meet rows in, so folders come out ordered among folders and each folder's
 * categories among themselves.
 */
export function orderCategories<T extends Orderable>(cats: T[], mode: CategoryOrder, opts: { usage?: Map<string, number> } = {}): T[] {
  const custom = (a: T, b: T) => a.sort - b.sort || a.name.localeCompare(b.name);
  if (mode === "usage") {
    const uses = opts.usage ?? new Map<string, number>();
    return [...cats].sort((a, b) => (uses.get(b.id) ?? 0) - (uses.get(a.id) ?? 0) || custom(a, b));
  }
  return [...cats].sort(custom);
}

/** The categories as `listRows` gives them, put in the order the person chose. */
export function inCategoryOrder<T extends Orderable>(db: SqlDriver, cats: T[]): T[] {
  const mode = getCategoryOrder(db);
  return orderCategories(cats, mode, { usage: mode === "usage" ? categoryUsage(db) : undefined });
}

/**
 * Make the order categories are listed in now — the usage order, say — the custom one: `sort` is
 * numbered down `ordered`, and only the rows whose number changes are written (DATA.md rule 15's
 * lesson). Returns how many were written.
 */
export function keepOrder(db: SqlDriver, ordered: { id: string }[]): number {
  let n = 0;
  db.transaction(() => {
    ordered.forEach((c, i) => {
      const row = getRow(db, "categories", c.id);
      if (row && !row.deleted && row.sort !== i) { save(db, "categories", { ...row, sort: i }); n++; }
    });
  });
  return n;
}
