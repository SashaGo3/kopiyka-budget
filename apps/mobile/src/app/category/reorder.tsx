import { useMemo } from "react";
import { archivedCategoryIds, folderIds, getRow, listRows, save, type Category } from "@kopiyka/core";
import { mutate, useQuery } from "@/store";
import { CategoryIcon } from "@/components/ui";
import { ReorderList, type ReorderItem } from "@/components/ReorderList";
import { catName } from "@/lib/names";
import { t } from "@/i18n";

const LOOSE = "section:loose";

/**
 * The custom order of categories (core categoryOrder.ts): folders as sections, their categories under
 * them. Drag a category within its folder or into another one; drag a folder and everything in it
 * goes with it. Done writes `sort` — one running number down the whole list — and, for a category
 * dropped into another folder, `parent_id`.
 *
 * What is written is only what changed (DATA.md rule 15's lesson): a row keeping its place and folder
 * keeps its `updated_at`, or one reorder on this phone would win every merge against the other.
 *
 * Archived categories are not listed (they are not offered anywhere either) and keep their `sort`.
 * Categories with no folder are a section of their own, "No folder", which moves like any other; a
 * category moved into it leaves its folder, and a folder whose last category is moved out becomes an
 * ordinary category (rule 5) — exactly as moving it on the category's own sheet would. A category is
 * never moved into a folder of the other kind (expense into income): it keeps its folder and only
 * takes the place.
 */
export default function CategoryReorder() {
  const data = useQuery((d) => {
    const all = listRows(d, "categories", "deleted=0", [], "sort, name");
    const gone = archivedCategoryIds(all), folders = folderIds(all);
    const live = all.filter((c) => !gone.has(c.id));
    return { live, folders: live.filter((c) => folders.has(c.id)), loose: live.filter((c) => !c.parent_id && !folders.has(c.id)) };
  });
  const items = useMemo<ReorderItem[]>(() => {
    const row = (c: Category, section = false): ReorderItem => ({ id: c.id, title: catName(c), section, icon: <CategoryIcon name={catName(c)} icon={c.icon} color={c.color} size={30} /> });
    const out: ReorderItem[] = [];
    for (const f of data.folders) {
      out.push({ ...row(f, true), subtitle: f.kind === "income" ? t("category.reorder.income") : undefined });
      for (const c of data.live.filter((x) => x.parent_id === f.id)) out.push(row(c));
    }
    if (data.loose.length) {
      out.push({ id: LOOSE, title: t("category.noFolder"), section: true });
      for (const c of data.loose) out.push(row(c));
    }
    return out;
  }, [data]);

  const commit = (ids: string[]) => mutate((d) => {
    let folder: string | null = null, n = 0;
    for (const id of ids) {
      if (id === LOOSE) { folder = null; continue; }
      const c = getRow(d, "categories", id) as Category | undefined;
      if (!c || c.deleted) continue;
      const sort = n++;
      if (data.folders.some((f) => f.id === id)) { folder = id; if (c.sort !== sort) save(d, "categories", { ...c, sort }); continue; }
      const target = folder ? (getRow(d, "categories", folder) as Category | undefined) : null;
      const parent = target && target.kind !== c.kind ? c.parent_id : folder;
      if (c.sort !== sort || (c.parent_id ?? null) !== parent) save(d, "categories", { ...c, sort, parent_id: parent });
    }
  });

  return <ReorderList title={t("category.reorder.title")} items={items} onDone={commit}
    hint={t("category.reorder.hint")}
    empty={{ title: t("category.reorder.emptyTitle"), hint: t("category.reorder.emptyHint") }} />;
}
