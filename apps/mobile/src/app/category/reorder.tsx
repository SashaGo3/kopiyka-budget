import { useMemo } from "react";
import { ActionSheetIOS, Alert } from "react-native";
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
 * takes the place, and Done says which stayed where they were.
 *
 * A long press on a category offers "Move to…" — every folder of its kind — for a move that would
 * otherwise be a long drag down a long list. It lands at the end of that folder, and still only on Done.
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

  const commit = (ids: string[]) => {
    const stayed: string[] = [];
    mutate((d) => {
      let folder: string | null = null, n = 0;
      for (const id of ids) {
        if (id === LOOSE) { folder = null; continue; }
        const c = getRow(d, "categories", id) as Category | undefined;
        if (!c || c.deleted) continue;
        const sort = n++;
        if (data.folders.some((f) => f.id === id)) { folder = id; if (c.sort !== sort) save(d, "categories", { ...c, sort }); continue; }
        const target: Category | null | undefined = folder ? (getRow(d, "categories", folder) as Category | undefined) : null;
        const parent: string | null = target && target.kind !== c.kind ? c.parent_id : folder;
        if (parent !== folder) stayed.push(catName(c));
        if (c.sort !== sort || (c.parent_id ?? null) !== parent) save(d, "categories", { ...c, sort, parent_id: parent });
      }
    });
    if (stayed.length) Alert.alert(t("category.reorder.stayedTitle"), t("category.reorder.stayedBody", { names: stayed.join(", ") }));
  };

  /** "Move to…": every other folder this category could go in — same kind — and No folder. */
  const moveTo = (id: string, order: string[], setOrder: (next: string[]) => void) => {
    const c = data.live.find((x) => x.id === id);
    if (!c) return;
    let here: string | null = null;
    for (const x of order) { if (x === id) break; if (x === LOOSE || data.folders.some((f) => f.id === x)) here = x; }
    const targets = [
      ...data.folders.filter((f) => f.kind === c.kind && f.id !== here).map((f) => ({ id: f.id, label: catName(f) })),
      ...(order.includes(LOOSE) && here !== LOOSE ? [{ id: LOOSE, label: t("category.noFolder") }] : []),
    ];
    if (!targets.length) return;
    const go = (to: string) => {
      const rest = order.filter((x) => x !== id);
      const start = rest.indexOf(to);
      let end = start + 1;
      while (end < rest.length && rest[end] !== LOOSE && !data.folders.some((f) => f.id === rest[end])) end++;
      rest.splice(end, 0, id);
      setOrder(rest);
    };
    ActionSheetIOS.showActionSheetWithOptions(
      { title: t("category.reorder.moveTitle", { name: catName(c) }), options: [...targets.map((x) => x.label), t("common.cancel")], cancelButtonIndex: targets.length },
      (i) => { if (i < targets.length) go(targets[i]!.id); });
  };

  return <ReorderList title={t("category.reorder.title")} items={items} onDone={commit} onLongPress={moveTo}
    hint={t("category.reorder.hint")}
    empty={{ title: t("category.reorder.emptyTitle"), hint: t("category.reorder.emptyHint") }} />;
}
