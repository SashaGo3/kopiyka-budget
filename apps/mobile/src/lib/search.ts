import { useMemo } from "react";
import { jsonIds, listRows, listTrips, searchEntry, searchMatches, searchTokens, type SearchEntry, type SqlDriver } from "@kopiyka/core";
import { useQuery } from "@/store";
import { acctName, catName } from "./names";
import { monthLong } from "./dates";

/**
 * Everything a transaction can be found by: the payee, the note, the place, the category and its
 * folder, the account (and, for a transfer, the account on the other end), every tag, the trip or
 * event the tags belong to, the debt it pays and the person, the recurring rule that wrote it, the
 * currency it was entered in, the month and year, and its amounts. Names are taken as they are
 * shown (a ready-made category or a default account in the app's language, DATA.md rules 16–17)
 * and as they are stored, so either is found.
 */
function buildIndex(d: SqlDriver): { id: string; entry: SearchEntry }[] {
  const cats = new Map(listRows(d, "categories", "1=1").map((c) => [c.id, c]));
  const accounts = new Map(listRows(d, "accounts", "1=1").map((a) => [a.id, a]));
  const tags = new Map(listRows(d, "tags", "1=1").map((x) => [x.id, x.name]));
  const trips = new Map<string, string[]>();
  for (const b of listTrips(d)) if (b.name) trips.set(b.tag_id!, [...(trips.get(b.tag_id!) ?? []), b.name]);
  const debts = new Map(listRows(d, "debts", "1=1").map((x) => [x.id, x]));
  const rules = new Map(listRows(d, "recurring_rules", "1=1").map((r) => [r.id, r]));
  const rows = listRows(d, "transactions", "deleted=0");
  const otherLeg = new Map<string, string>();
  const legs = new Map<string, string[]>();
  for (const r of rows) if (r.transfer_id) legs.set(r.transfer_id, [...(legs.get(r.transfer_id) ?? []), r.account_id]);
  for (const r of rows) if (r.transfer_id) { const o = legs.get(r.transfer_id)!.find((a) => a !== r.account_id); if (o) otherLeg.set(r.id, o); }
  const shown = (c: { name: string; preset?: string | null } | undefined) => (c ? [catName(c), c.name] : []);
  const shownAcct = (id: string | undefined) => { const a = id ? accounts.get(id) : undefined; return a ? [acctName(a), a.name] : []; };
  return rows.map((r) => {
    const c = r.category_id ? cats.get(r.category_id) : undefined;
    const p = c?.parent_id ? cats.get(c.parent_id) : undefined;
    const tagIds = jsonIds(r.tag_ids);
    const debt = r.debt_id ? debts.get(r.debt_id) : undefined;
    const rule = r.recurring_id ? rules.get(r.recurring_id) : undefined;
    const [y, m] = r.date.slice(0, 7).split("-").map(Number) as [number, number];
    return { id: r.id, entry: searchEntry([
      r.payee, r.notes, r.bank_note, r.place, ...shown(c), ...shown(p), ...shownAcct(r.account_id), ...shownAcct(otherLeg.get(r.id)),
      ...tagIds.flatMap((tid) => [tags.get(tid), ...(trips.get(tid) ?? [])]),
      debt?.person, debt?.notes, rule?.payee, rule?.notes, r.entered_currency, accounts.get(r.account_id)?.currency,
      monthLong(m), String(y),
    ], [r.amount_minor, r.entered_amount_minor]) };
  });
}

/**
 * The ids of the transactions what is typed finds, or null when nothing is typed. The index is
 * built only while there is something to look for, and again whenever the data changes.
 */
export function useSearchIds(q: string): string[] | null {
  const active = !!q.trim();
  const index = useQuery((d) => (active ? buildIndex(d) : []), [active]);
  return useMemo(() => {
    if (!active) return null;
    const tokens = searchTokens(q);
    return index.filter((x) => searchMatches(x.entry, tokens)).map((x) => x.id);
  }, [index, q, active]);
}
