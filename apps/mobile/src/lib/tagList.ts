import { jsonIds, listRows, listTrips, tripKind, type Tag, type TripKind } from "@kopiyka/core";
import { useQuery } from "@/store";
import { catName } from "@/lib/names";

export type TagListRow = Tag & {
  /** The kind of the trip or event the tag was made for; null for an ordinary tag. */
  trip: TripKind | null;
  uses: number;
  /** The categories the tag is limited to, by name, comma-separated; "" for any category. */
  scope: string;
};

/**
 * Every live tag with what the Tags screens print beside it, split the way they are shown: ordinary
 * tags on Settings → Tags, the ones travel mode made on Trips & Events, and the archived ones on a
 * page of their own (an archived trip tag is archived first). One query for all three, so the counts
 * on the Tags screen are the same rows the two pages list.
 */
export function useTagList(): { live: TagListRow[]; travel: TagListRow[]; archived: TagListRow[] } {
  const tags = useQuery((db) => {
    const cats = new Map(listRows(db, "categories", "1=1").map((c) => [c.id, catName(c)]));
    const usage = new Map<string, number>();
    for (const r of db.all<{ tag_ids: string }>(`SELECT tag_ids FROM transactions WHERE deleted=0 AND tag_ids<>'[]'`)) for (const id of jsonIds(r.tag_ids)) usage.set(id, (usage.get(id) ?? 0) + 1);
    // Newest first, so a tag two trips were run on reads as the latest of them.
    const kinds = new Map<string, TripKind>();
    for (const b of listTrips(db)) if (b.tag_id && !kinds.has(b.tag_id)) kinds.set(b.tag_id, tripKind(b));
    return listRows(db, "tags", "deleted=0", [], "name").map((t): TagListRow => ({ ...t, trip: kinds.get(t.id) ?? null, uses: usage.get(t.id) ?? 0, scope: jsonIds(t.category_ids).map((id) => cats.get(id)).filter(Boolean).join(", ") }));
  });
  return {
    live: tags.filter((t) => !t.archived && !t.trip),
    travel: tags.filter((t) => !t.archived && t.trip),
    archived: tags.filter((t) => t.archived),
  };
}
