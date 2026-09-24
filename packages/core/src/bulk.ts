/**
 * Editing many transactions at once: what the change does to each row, in one place.
 *
 * The point of having it here rather than in the screen that starts it is that the preview and the
 * save must not be two descriptions of the same edit. `bulkPatch` is asked what a row would become,
 * printed for every row about to change, and then asked again — by `applyBulk`, on the same rows —
 * for what to write. A preview that is computed differently from the write is worse than no preview.
 *
 * Rows the change would leave exactly as they are are skipped rather than rewritten: an untouched
 * row has no business getting a fresh `updated_at`, which is what decides a merge (DATA.md rule 2).
 */
import type { SqlDriver } from "./db";
import type { Transaction } from "./models";
import { getRow, jsonIds, listRows, save } from "./repo";

export type BulkChange =
  | { kind: "category"; category_id: string | null }
  /** Ticking in the tag picker adds to every row, unticking one they all had removes it; other tags are left alone. */
  | { kind: "tags"; add: string[]; drop: string[] }
  /** Move to another day, each row keeping its own time of day. */
  | { kind: "date"; day: string }
  | { kind: "note"; text: string; mode: "replace" | "append" }
  /** Approve pending entries. */
  | { kind: "confirm" };

/** What this change would make of this row — `{}` when it would change nothing. */
export function bulkPatch(t: Transaction, change: BulkChange): Partial<Transaction> {
  switch (change.kind) {
    case "category":
      return t.category_id === change.category_id ? {} : { category_id: change.category_id };
    case "tags": {
      const had = jsonIds(t.tag_ids);
      const kept = had.filter((id) => !change.drop.includes(id));
      const ids = [...kept, ...change.add.filter((id) => !kept.includes(id))];
      return same(had, ids) ? {} : { tag_ids: JSON.stringify(ids) };
    }
    case "date": {
      // The time of day is the row's own: a shopping trip moved to Saturday keeps its order.
      const moved = change.day + t.date.slice(10);
      return moved === t.date ? {} : { date: moved };
    }
    case "note": {
      const notes = noteAfter(t.notes, change);
      return notes === t.notes ? {} : { notes };
    }
    case "confirm":
      return t.pending ? { pending: 0 } : {};
  }
}

/**
 * The note a row ends up with. Appending to a row that has none is just the new text, so "add a
 * note to these twelve" does the obvious thing on the ones that were blank; appending text a row
 * already ends with is not repeated, because running the same bulk edit twice by accident should
 * not read like a stutter. Replacing with nothing clears the note (null, not "").
 */
export function noteAfter(notes: string | null, change: { text: string; mode: "replace" | "append" }): string | null {
  const text = change.text.trim();
  if (change.mode === "replace") return text || null;
  const had = notes?.trim();
  if (!had) return text || null;
  if (!text || had.endsWith(text)) return notes;
  return `${notes}\n${text}`;
}

function same(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** Which of these rows the change would actually touch, in the order they were given. */
export function bulkAffected(db: SqlDriver, ids: string[], change: BulkChange): { row: Transaction; patch: Partial<Transaction> }[] {
  const out: { row: Transaction; patch: Partial<Transaction> }[] = [];
  for (const id of ids) {
    const row = getRow(db, "transactions", id);
    if (!row || row.deleted) continue;
    const patch = bulkPatch(row, change);
    if (Object.keys(patch).length) out.push({ row, patch });
  }
  return out;
}

/** Apply the change; returns how many rows were written. One transaction, so a preview is never half true. */
export function applyBulk(db: SqlDriver, ids: string[], change: BulkChange): number {
  const affected = bulkAffected(db, ids, change);
  if (!affected.length) return 0;
  return db.transaction(() => {
    for (const { row, patch } of affected) save(db, "transactions", { ...row, ...patch });
    return affected.length;
  });
}

/**
 * The ids a selection really covers: both legs of every chosen transfer. Half a transfer moved to
 * another day, or filed under another category, is money that has left one account and not arrived
 * in the other — so the pair travels together, and the preview counts them.
 */
export function withTransferLegs(db: SqlDriver, ids: string[]): string[] {
  const all = [...ids];
  const seen = new Set(ids);
  for (const id of ids) {
    const t = getRow(db, "transactions", id);
    if (!t?.transfer_id) continue;
    for (const leg of listRows(db, "transactions", "deleted=0 AND transfer_id=?", [t.transfer_id])) {
      if (!seen.has(leg.id)) { seen.add(leg.id); all.push(leg.id); }
    }
  }
  return all;
}
