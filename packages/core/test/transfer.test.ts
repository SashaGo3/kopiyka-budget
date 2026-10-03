import { describe, expect, test } from "bun:test";
import { openBunDb } from "../src/drivers/bun";
import { migrate } from "../src/schema";
import { createAccount, createTransaction, createTransfer, getRow, listRows } from "../src/repo";

function seed() {
  const db = openBunDb(); migrate(db);
  const main = createAccount(db, { name: "Main", currency: "UAH" });
  const savings = createAccount(db, { name: "Savings", currency: "UAH" });
  return { db, main, savings };
}

describe("turning an entry into a transfer", () => {
  test("the entry becomes the leg on its own account and keeps its id, payee and photo", () => {
    const { db, main, savings } = seed();
    const row = createTransaction(db, { account_id: main.id, date: "2026-10-01T10:00:00+03:00", amount_minor: -50000, payee: "MONO JAR", photo: "a.jpg", source: "shortcut", refunded_minor: 1000 });
    const r = createTransfer(db, { from_account_id: main.id, to_account_id: savings.id, date: row.date, from_amount_minor: 50000, to_amount_minor: 50000, from_currency: "UAH", to_currency: "UAH", keep: { row, leg: "out" } });
    expect(r.out.id).toBe(row.id);
    expect(r.in.id).not.toBe(row.id);
    const out = getRow(db, "transactions", row.id)!;
    expect(out.transfer_id).toBe(r.transfer_id);
    expect(out.amount_minor).toBe(-50000);
    expect(out.payee).toBe("MONO JAR");
    expect(out.photo).toBe("a.jpg");
    expect(out.refunded_minor).toBe(0);
    // The new leg carries nothing of the old row beyond what a transfer shares.
    expect(r.in.photo).toBeNull();
    expect(r.in.payee).toBeNull();
    expect(listRows(db, "transactions", "deleted=0")).toHaveLength(2);
  });

  test("an income becomes the receiving leg", () => {
    const { db, main, savings } = seed();
    const row = createTransaction(db, { account_id: savings.id, date: "2026-10-01T10:00:00+03:00", amount_minor: 20000 });
    const r = createTransfer(db, { from_account_id: main.id, to_account_id: savings.id, date: row.date, from_amount_minor: 20000, to_amount_minor: 20000, from_currency: "UAH", to_currency: "UAH", keep: { row, leg: "in" } });
    expect(r.in.id).toBe(row.id);
    expect(r.in.account_id).toBe(savings.id);
    expect(r.out.account_id).toBe(main.id);
    expect(r.out.amount_minor).toBe(-20000);
  });
});
