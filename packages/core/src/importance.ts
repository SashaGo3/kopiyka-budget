/**
 * How much a category matters, and the flow that marks all of them in one sitting.
 *
 * Spending alone cannot say which of two identical £40 lines was rent's little brother and which
 * was a whim. Only the person who spent it knows, it does not change often, and it is worth saying
 * once — the same argument as `description` on a category, a small piece of human knowledge that
 * several features then read.
 *
 * Two rules hold the whole thing together:
 *
 * - **A folder answers for its categories.** A category left at 0 inherits its folder's mark, which
 *   is why marking "Subscriptions" once also covers the twelfth thing added to it next year. Every
 *   reader goes through `categoryImportance` rather than the column, the way `archivedCategoryIds`
 *   is the one place that knows archiving a folder retires what is inside it.
 * - **Medium is what is left, not a button.** The flow asks two questions — what you could not live
 *   without, then what you could stop tomorrow — and everything neither answer claimed is Medium.
 *   Asked as a third question it would be where everything you did not want to think about goes;
 *   arrived at by elimination it honestly means "the things in between". It also makes a category
 *   marked both High and Low unreachable rather than a contradiction resolved by arbitrary rule.
 *
 * Nothing here filters or hides anything and no total changes: like `archived` (DATA.md rule 14),
 * importance is a fact about the category, not about the money.
 */
import type { SqlDriver } from "./db";
import type { Category, Importance } from "./models";
import { archivedCategoryIds, getRow, listRows, save } from "./repo";

/** Short names, for a row that has to fit. The flow asks the long questions in its own words. */
export const IMPORTANCE_NAME: Record<Importance, string> = { 0: "Not set", 1: "Low", 2: "Medium", 3: "High" };

/**
 * The categories the marking flow asks about: live, not archived (rule 14 — a category that is not
 * offered is not one to have an opinion about), and expense only, because how much an income
 * category matters is not a question anyone can answer.
 */
export function markableCategories(db: SqlDriver): Category[] {
  const all = listRows(db, "categories", "deleted=0", [], "sort, name") as Category[];
  const retired = archivedCategoryIds(all);
  return all.filter((c) => c.kind === "expense" && !retired.has(c.id));
}

/** Folder id → the categories inside it, among the ones given. */
function kidsByParent(cats: Category[]): Map<string, Category[]> {
  const out = new Map<string, Category[]>();
  for (const c of cats) {
    if (!c.parent_id) continue;
    const list = out.get(c.parent_id);
    if (list) list.push(c); else out.set(c.parent_id, [c]);
  }
  return out;
}

/**
 * The categories money can actually be filed into: everything that is not a folder. A top-level
 * category with nothing inside it is an ordinary category (DATA.md rule 5), so it is a leaf.
 */
export function markableLeaves(cats: Category[]): Category[] {
  const kids = kidsByParent(cats);
  return cats.filter((c) => !kids.get(c.id)?.length);
}

/**
 * Which categories a picked set really covers: a folder id stands for every category inside it,
 * the same meaning `/pick/categories` gives a fully ticked folder when it hands back the folder's
 * own id. Anything else stands for itself.
 */
export function coveredCategoryIds(cats: Category[], ids: string[]): Set<string> {
  const kids = kidsByParent(cats);
  const out = new Set<string>();
  for (const id of ids) {
    const inside = kids.get(id);
    if (inside?.length) for (const k of inside) out.add(k.id);
    else out.add(id);
  }
  return out;
}

/**
 * The mark for every category, from the flow's two answers. `high` and `low` are what the pickers
 * returned, a whole folder collapsed to the folder's own id; everything neither claimed is Medium.
 *
 * High wins a category that somehow appears in both, but the flow asks the second question only
 * about what the first one left, so that should not arise.
 *
 * A level that covers every category in a folder is written **on the folder**, and its categories
 * are cleared to 0 so they inherit. That is not tidiness: a category added to that folder next year
 * arrives already answered, where stamping the children would have frozen them against the folder
 * ever changing its mind. A folder whose categories disagree keeps no mark of its own, so the next
 * one added to it shows up in the "not marked" count instead of quietly taking a side.
 */
export function importanceMarks(cats: Category[], high: string[], low: string[]): Map<string, Importance> {
  const kids = kidsByParent(cats);
  const isHigh = coveredCategoryIds(cats, high);
  const isLow = coveredCategoryIds(cats, low);
  const leafLevel = (id: string): Importance => (isHigh.has(id) ? 3 : isLow.has(id) ? 1 : 2);
  const here = new Set(cats.map((c) => c.id));
  const out = new Map<string, Importance>();
  for (const c of cats) {
    const inside = kids.get(c.id);
    // A child whose folder is not in this set (income, or archived) has nobody to answer for it,
    // so it answers for itself rather than dropping out of the flow unmarked.
    if (!inside?.length) { if (!c.parent_id || !here.has(c.parent_id)) out.set(c.id, leafLevel(c.id)); continue; }
    const levels = inside.map((k) => leafLevel(k.id));
    const agreed = levels.every((l) => l === levels[0]);
    out.set(c.id, agreed ? levels[0]! : 0);
    for (const k of inside) out.set(k.id, agreed ? 0 : leafLevel(k.id));
  }
  return out;
}

/**
 * What each category's importance actually is, folder inheritance applied: its own mark when it has
 * one, otherwise its folder's. This is the function every reader calls — reading the column direct
 * is how "Subscriptions" ends up counted as unimportant because the folder was marked and the
 * categories inside it were not.
 */
export function categoryImportance(cats: { id: string; parent_id: string | null; importance: Importance }[]): Map<string, Importance> {
  const byId = new Map(cats.map((c) => [c.id, c]));
  const out = new Map<string, Importance>();
  for (const c of cats) {
    let level = c.importance;
    // Walk up while the answer is still "nothing said". One step is enough today (a folder holds
    // categories, not folders); the loop costs nothing and means a deeper tree would still resolve.
    for (let up = c.parent_id, guard = 0; !level && up && guard < 8; guard++) {
      const parent = byId.get(up);
      if (!parent) break;
      level = parent.importance;
      up = parent.parent_id;
    }
    out.set(c.id, level);
  }
  return out;
}

/**
 * How many categories money can be filed into still have no answer, directly or from their folder.
 * This is the number the Categories screen shows, and it is the load-bearing half: categories added
 * later start at 0, and nothing else will ever say that the figures built on importance have gone
 * stale.
 */
export function unmarkedCount(cats: Category[]): number {
  const level = categoryImportance(cats);
  return markableLeaves(cats).filter((c) => !level.get(c.id)).length;
}

/**
 * Which rows the marking would actually write, in the order they were given. Rows the change would
 * leave exactly as they are are skipped: an untouched row with a fresh `updated_at` wins a merge it
 * had no business winning (DATA.md rule 2), and forty categories marked at once on one of two
 * phones is the exact shape of that bug.
 */
export function importanceAffected(db: SqlDriver, marks: Map<string, Importance>): { row: Category; to: Importance }[] {
  const out: { row: Category; to: Importance }[] = [];
  for (const [id, to] of marks) {
    const row = getRow(db, "categories", id) as Category | undefined;
    if (!row || row.deleted || row.importance === to) continue;
    out.push({ row, to });
  }
  return out;
}

/** Apply the marking; returns how many rows were written. One transaction, so a preview is never half true. */
export function applyImportance(db: SqlDriver, marks: Map<string, Importance>): number {
  const affected = importanceAffected(db, marks);
  if (!affected.length) return 0;
  return db.transaction(() => {
    for (const { row, to } of affected) save(db, "categories", { ...row, importance: to });
    return affected.length;
  });
}
