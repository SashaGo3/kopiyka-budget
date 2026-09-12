import { describe, expect, test } from "bun:test";
import { openBunDb } from "../src/drivers/bun";
import { migrate, getMeta, setMeta } from "../src/schema";
import { createAccount, createTransaction, eraseAll, listRows } from "../src/repo";

function seed() {
  const db = openBunDb(":memory:");
  migrate(db);
  const a = createAccount(db, { name: "Cash", currency: "PLN" });
  createTransaction(db, { account_id: a.id, date: "2026-09-08T10:00:00+02:00", amount_minor: -500 });
  setMeta(db, "last_pulled_seq", "42");
  setMeta(db, "budget_scope", a.id);
  setMeta(db, "base_currency", "PLN");
  return db;
}

describe("eraseAll", () => {
  test("local erase drops rows, sync queue and cursor but keeps preferences", () => {
    const db = seed();
    eraseAll(db, { everywhere: false });
    expect(listRows(db, "accounts", "1=1")).toHaveLength(0);
    expect(listRows(db, "transactions", "1=1")).toHaveLength(0);
    expect(db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM sync_outbox`)?.n).toBe(0);
    expect(getMeta(db, "last_pulled_seq")).toBeNull();
    expect(getMeta(db, "budget_scope")).toBeNull();
    expect(getMeta(db, "base_currency")).toBe("PLN");
  });
  test("erase everywhere leaves tombstones queued for sync", () => {
    const db = seed();
    eraseAll(db, { everywhere: true });
    expect(listRows(db, "accounts")).toHaveLength(0);
    expect(listRows(db, "accounts", "deleted=1")).toHaveLength(1);
    expect(db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM sync_outbox`)?.n).toBe(2);
    expect(getMeta(db, "last_pulled_seq")).toBe("42");
  });
});
