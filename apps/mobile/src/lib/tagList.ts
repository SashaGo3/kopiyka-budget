import { jsonIds, listRows, listTrips, tripKind, type Tag, type TripKind } from "@kopiyka/core";
import { useQuery } from "@/store";
import { catName } from "@/lib/names";

export type TagListRow = Tag & {
  /** The kind of the trip or event the tag was made for; null for an ordinary tag. */
  trip: TripKind | null;
  uses: number;
  /** The categories the tag is limited to, by name, comma-separated; "" for any category. */
  scope: string;
  /**
   * The categories the tag's payments were actually filed under, most first — what it is used *with*,
   * which is not the same as what it is limited to (a tag limited to nothing still has a pattern).
   */
  usedWith: { name: string; n: number }[];
};

/**
 * Every live tag with what the Tags screens print beside it, split the way they are shown: ordinary
 * tags on Settings → Tags, the ones travel mode made on Trips & Events, and the archived ones on a
 * page of their own (an archived trip tag is archived first). One query for all three, so the counts
 * on the Tags screen are the same rows the two pages list.
 *
 * Most used first — over the last six months, then all time, then by name.
 */
export function useTagList(): { live: TagListRow[]; travel: TagListRow[]; archived: TagListRow[] } {
  const tags = useQuery((db) => {
    const cats = new Map(listRows(db, "categories", "1=1").map((c) => [c.id, catName(c)]));
    const usage = new Map<string, number>();
    const withCat = new Map<string, Map<string, number>>();
    // "Used with" and the usage order look at the last six months, as the category order does: a trip
    // two years ago should not decide what a tag is for now. The count printed stays all-time.
    const since = new Date(Date.now() - 180 * 86_400_000).toISOString().slice(0, 10);
    const recent = new Map<string, number>();
    for (const r of db.all<{ tag_ids: string; category_id: string | null; date: string }>(`SELECT tag_ids, category_id, date FROM transactions WHERE deleted=0 AND tag_ids<>'[]'`)) {
      for (const id of jsonIds(r.tag_ids)) {
        usage.set(id, (usage.get(id) ?? 0) + 1);
        if (r.date < since) continue;
        recent.set(id, (recent.get(id) ?? 0) + 1);
        if (!r.category_id) continue;
        const m = withCat.get(id) ?? new Map<string, number>();
        m.set(r.category_id, (m.get(r.category_id) ?? 0) + 1);
        withCat.set(id, m);
      }
    }
    // Newest first, so a tag two trips were run on reads as the latest of them.
    const kinds = new Map<string, TripKind>();
    for (const b of listTrips(db)) if (b.tag_id && !kinds.has(b.tag_id)) kinds.set(b.tag_id, tripKind(b));
    return listRows(db, "tags", "deleted=0", [], "name").map((t): TagListRow => ({
      ...t, trip: kinds.get(t.id) ?? null, uses: usage.get(t.id) ?? 0, scope: jsonIds(t.category_ids).map((id) => cats.get(id)).filter(Boolean).join(", "),
      usedWith: [...(withCat.get(t.id) ?? [])].sort((a, b) => b[1] - a[1]).map(([id, n]) => ({ name: cats.get(id) ?? "?", n })),
    })).sort((a, b) => (recent.get(b.id) ?? 0) - (recent.get(a.id) ?? 0) || b.uses - a.uses || a.name.localeCompare(b.name));
  });
  return {
    live: tags.filter((t) => !t.archived && !t.trip),
    travel: tags.filter((t) => !t.archived && t.trip),
    archived: tags.filter((t) => t.archived),
  };
}

/** "Eating out (12), Groceries (5), +2" — the first few categories a tag is used with. */
export function usedWithLine(rows: { name: string; n: number }[], max = 3): string {
  const shown = rows.slice(0, max).map((r) => `${r.name} (${r.n})`).join(", ");
  return rows.length > max ? `${shown}, +${rows.length - max}` : shown;
}
