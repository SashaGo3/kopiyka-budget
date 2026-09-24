import { describe, expect, test } from "bun:test";
import { openBunDb } from "../src/drivers/bun";
import { migrate } from "../src/schema";
import { createAccount, createCategory, createTransaction, createTransfer, getRow, jsonIds, listRows } from "../src/repo";
import { applyBulk, bulkAffected, bulkPatch, noteAfter, withTransferLegs } from "../src/bulk";

function fresh() {
  const db = openBunDb();
  migrate(db);
  const acc = createAccount(db, { name: "Cash", currency: "PLN" });
  const other = createAccount(db, { name: "Bank", currency: "PLN" });
  const food = createCategory(db, { name: "Food" });
  return { db, acc, other, food };
}

const tx = (db: ReturnType<typeof fresh>["db"], account_id: string, over: Record<string, unknown> = {}) =>
  createTransaction(db, { account_id, date: "2026-09-07T10:00:00+02:00", amount_minor: -500, ...over });

describe("bulk edits", () => {
  test("a change that changes nothing writes nothing", () => {
    const { db, acc, food } = fresh();
    const t = tx(db, acc.id, { category_id: food.id });
    const before = getRow(db, "transactions", t.id)!.updated_at;
    expect(applyBulk(db, [t.id], { kind: "category", category_id: food.id })).toBe(0);
    // An untouched row must not get a fresh updated_at: that is what decides a merge (DATA.md rule 2).
    expect(getRow(db, "transactions", t.id)!.updated_at).toBe(before);
  });

  test("moving to another day keeps each row's own time", () => {
    const { db, acc } = fresh();
    const morning = tx(db, acc.id, { date: "2026-09-07T08:15:00+02:00" });
    const evening = tx(db, acc.id, { date: "2026-09-07T19:40:00+02:00" });
    expect(applyBulk(db, [morning.id, evening.id], { kind: "date", day: "2026-09-12" })).toBe(2);
    expect(getRow(db, "transactions", morning.id)!.date).toBe("2026-09-12T08:15:00+02:00");
    expect(getRow(db, "transactions", evening.id)!.date).toBe("2026-09-12T19:40:00+02:00");
  });

  test("tags: ticking adds to all, unticking a shared tag removes it, others are left alone", () => {
    const { db, acc } = fresh();
    const a = tx(db, acc.id, { tag_ids: JSON.stringify(["shared", "mine"]) });
    const b = tx(db, acc.id, { tag_ids: JSON.stringify(["shared"]) });
    applyBulk(db, [a.id, b.id], { kind: "tags", add: ["new"], drop: ["shared"] });
    expect(jsonIds(getRow(db, "transactions", a.id)!.tag_ids)).toEqual(["mine", "new"]);
    expect(jsonIds(getRow(db, "transactions", b.id)!.tag_ids)).toEqual(["new"]);
  });

  describe("notes", () => {
    test("replace overwrites, and replacing with nothing clears", () => {
      expect(noteAfter("old", { text: "new", mode: "replace" })).toBe("new");
      expect(noteAfter("old", { text: "  ", mode: "replace" })).toBeNull();
    });
    test("append adds a line, and is just the text on a row that had none", () => {
      expect(noteAfter("old", { text: "new", mode: "append" })).toBe("old\nnew");
      expect(noteAfter(null, { text: "new", mode: "append" })).toBe("new");
      expect(noteAfter("", { text: "new", mode: "append" })).toBe("new");
    });
    test("appending the same text twice does not stutter", () => {
      const once = noteAfter("receipt kept", { text: "receipt kept", mode: "append" });
      expect(once).toBe("receipt kept");
    });
  });

  test("confirm only touches the rows that are pending", () => {
    const { db, acc } = fresh();
    const waiting = tx(db, acc.id, { pending: 1 });
    const done = tx(db, acc.id, { pending: 0 });
    expect(bulkAffected(db, [waiting.id, done.id], { kind: "confirm" }).map((a) => a.row.id)).toEqual([waiting.id]);
    applyBulk(db, [waiting.id, done.id], { kind: "confirm" });
    expect(getRow(db, "transactions", waiting.id)!.pending).toBe(0);
  });

  test("a chosen transfer brings its other leg, once", () => {
    const { db, acc, other } = fresh();
    createTransfer(db, { from_account_id: acc.id, to_account_id: other.id, date: "2026-09-07T10:00:00+02:00",
      from_amount_minor: -1000, to_amount_minor: 1000, from_currency: "PLN", to_currency: "PLN" });
    const legs = listRows(db, "transactions", "deleted=0 AND transfer_id IS NOT NULL");
    expect(legs.length).toBe(2);
    expect(withTransferLegs(db, [legs[0]!.id]).sort()).toEqual(legs.map((l) => l.id).sort());
    // Both legs chosen by hand must not be listed twice.
    expect(withTransferLegs(db, legs.map((l) => l.id)).length).toBe(2);
  });

  test("the preview and the write agree, row for row", () => {
    const { db, acc, food } = fresh();
    const rows = [tx(db, acc.id), tx(db, acc.id, { category_id: food.id }), tx(db, acc.id)];
    const ids = rows.map((r) => r.id);
    const change = { kind: "category", category_id: food.id } as const;
    const previewed = bulkAffected(db, ids, change);
    expect(previewed.length).toBe(2);   // the one already filed under Food is not in the list
    expect(applyBulk(db, ids, change)).toBe(previewed.length);
    for (const { row, patch } of previewed) expect(getRow(db, "transactions", row.id)!.category_id).toBe(patch.category_id!);
  });

  test("bulkPatch leaves everything it was not asked about alone", () => {
    const { db, acc, food } = fresh();
    const t = tx(db, acc.id, { payee: "Zabka", notes: "milk", tag_ids: JSON.stringify(["x"]) });
    expect(bulkPatch(t, { kind: "category", category_id: food.id })).toEqual({ category_id: food.id });
  });
});
