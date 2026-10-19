/**
 * What to call a budget in a list.
 *
 * Its own name when it has been given one, and otherwise the thing it covers — the tag, the
 * categories, or "Everything" — which is what every budget was called before a name was a column.
 * Kept here rather than in each screen so the Budgets list, the reorder sheet and the Planned sheet
 * cannot drift into calling the same budget three different things.
 */
import { budgetCategoryIds, listRows, tagColor, type Budget, type Category, type Tag } from "@kopiyka/core";
import { db } from "@/db";
import { t } from "@/i18n";
import { catName } from "@/lib/names";

export function budgetTitle(b: Budget, names?: { cats: Map<string, string>; tags: Map<string, string> }): string {
  const n = b.name?.trim();
  if (n) return n;
  const cats = names?.cats ?? new Map(listRows(db, "categories", "1=1").map((c) => [c.id, catName(c)]));
  const tags = names?.tags ?? new Map(listRows(db, "tags", "1=1").map((x) => [x.id, x.name]));
  if (b.tag_id) return `#${tags.get(b.tag_id) ?? t("budgets.title.tag")}`;
  const ids = budgetCategoryIds(b);
  if (!ids.length) return t("budgets.title.everything");
  return ids.map((id) => (id === "none" ? t("budgets.title.uncategorized") : cats.get(id) ?? "?")).join(", ");
}

/** The name maps `budgetTitle` wants, read once for a whole list. */
export function nameMaps(d: typeof db): { cats: Map<string, string>; tags: Map<string, string> } {
  return {
    cats: new Map(listRows(d, "categories", "1=1").map((c) => [c.id, catName(c)])),
    tags: new Map(listRows(d, "tags", "1=1").map((x) => [x.id, x.name])),
  };
}

export interface BudgetLook {
  name: string;
  /** The folder above a single category, or "Tag" for a tag budget: what the name is read under. */
  parent: string | null;
  icon: string | null;
  color: string | null;
  /** One per thing it covers, when it covers several: they have no one icon between them, so a pile is drawn. */
  icons: { name: string; icon: string | null; color: string | null }[];
}

/**
 * How a budget is drawn: the Budgets screen's card and the budget's own details screen, so the two
 * never show the same budget under different names or icons. A tag is named without its "#" here,
 * beside its own icon; a folder is one entry wearing its own icon, because a budget on a folder is
 * not a budget on a list of categories.
 */
export function budgetLook(b: Budget, cats: Map<string, Category>, tags: Map<string, Tag>): BudgetLook {
  const ids = budgetCategoryIds(b);
  const one = ids.length === 1 ? cats.get(ids[0]!) : undefined;
  const tag = b.tag_id ? tags.get(b.tag_id) : undefined;
  const nm = (c: Category | undefined) => (c ? catName(c) : t("budgets.title.uncategorized"));
  const covered = ids.map((cid) => (cid === "none" ? undefined : cats.get(cid)));
  const scopeName = covered.map((c, i) => (ids[i] === "none" ? t("budgets.title.uncategorized") : c ? catName(c) : "?")).join(", ");
  return {
    name: b.name?.trim() || (tag ? tag.name : scopeName || t("budgets.title.everything")),
    parent: tag ? t("budgets.edit.tag") : one?.parent_id ? (cats.get(one.parent_id) ? catName(cats.get(one.parent_id)!) : null) : null,
    icon: tag ? "number" : one?.icon ?? null,
    color: tag ? tagColor(tag.name, tag.color) : one?.color ?? null,
    icons: tag ? [] : covered.map((c) => ({ name: nm(c), icon: c?.icon ?? null, color: c?.color ?? null })),
  };
}
