import { describe, expect, test } from "bun:test";
import { openBunDb } from "../src/drivers/bun";
import { migrate } from "../src/schema";
import { createAccount, createTransaction, save } from "../src/repo";
import { payAccountFor } from "../src/payAccount";
import type { Account } from "../src/models";

function fresh() {
  const db = openBunDb();
  migrate(db);
  const pln = createAccount(db, { name: "Main", currency: "PLN" });
  const eur = createAccount(db, { name: "Revolut", currency: "EUR" });
  return { db, pln, eur };
}

describe("payAccountFor", () => {
  test("an account held in the currency, before you have paid in it", () => {
    const { db, pln, eur } = fresh();
    expect(payAccountFor(db, "EUR", pln.id)).toBe(eur.id);
    expect(payAccountFor(db, "USD", pln.id)).toBe(pln.id);
  });
  test("the account you last paid in that currency from, a converted one included", () => {
    const { db, pln, eur } = fresh();
    createTransaction(db, { account_id: eur.id, date: "2026-10-01T12:00:00", amount_minor: -500 });
    createTransaction(db, { account_id: pln.id, date: "2026-11-01T12:00:00", amount_minor: -2200, entered_amount_minor: -500, entered_currency: "EUR", exchange_rate: 4.4 });
    expect(payAccountFor(db, "EUR", null)).toBe(pln.id);
  });
  test("income, transfers and archived accounts teach nothing", () => {
    const { db, pln, eur } = fresh();
    createTransaction(db, { account_id: pln.id, date: "2026-11-01T12:00:00", amount_minor: 2200, entered_amount_minor: 500, entered_currency: "EUR", exchange_rate: 4.4 });
    expect(payAccountFor(db, "EUR", null)).toBe(eur.id);
    save(db, "accounts", { ...eur, archived: 1 } as Account);
    expect(payAccountFor(db, "EUR", pln.id)).toBe(pln.id);
  });
});
