/**
 * What to call a budget in a list.
 *
 * Its own name when it has been given one, and otherwise the thing it covers — the tag, the
 * categories, or "Everything" — which is what every budget was called before a name was a column.
 * Kept here rather than in each screen so the Budgets list, the reorder sheet and the Planned sheet
 * cannot drift into calling the same budget three different things.
 */
import { budgetCategoryIds, listRows, type Budget } from "@kopiyka/core";
import { db } from "@/db";

export function budgetTitle(b: Budget, names?: { cats: Map<string, string>; tags: Map<string, string> }): string {
  const n = b.name?.trim();
  if (n) return n;
  const cats = names?.cats ?? new Map(listRows(db, "categories", "1=1").map((c) => [c.id, c.name]));
  const tags = names?.tags ?? new Map(listRows(db, "tags", "1=1").map((t) => [t.id, t.name]));
  if (b.tag_id) return `#${tags.get(b.tag_id) ?? "tag"}`;
  const ids = budgetCategoryIds(b);
  if (!ids.length) return "Everything";
  return ids.map((id) => (id === "none" ? "Uncategorized" : cats.get(id) ?? "?")).join(", ");
}

/** The name maps `budgetTitle` wants, read once for a whole list. */
export function nameMaps(d: typeof db): { cats: Map<string, string>; tags: Map<string, string> } {
  return {
    cats: new Map(listRows(d, "categories", "1=1").map((c) => [c.id, c.name])),
    tags: new Map(listRows(d, "tags", "1=1").map((t) => [t.id, t.name])),
  };
}
