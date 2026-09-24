import { describe, expect, test } from "bun:test";
import { openBunDb } from "../src/drivers/bun";
import { migrate } from "../src/schema";
import { accountBalanceMinor, createAccount, createTransaction, createTransfer, getRow, remove } from "../src/repo";
import { applyReturn, checkReturn, clearReturns, hasReturns, paidAmountMinor } from "../src/returns";

function seed() {
  const db = openBunDb(); migrate(db);
  const acc = createAccount(db, { name: "Main", currency: "PLN" });
  const dinner = createTransaction(db, { account_id: acc.id, date: "2026-09-10T20:00:00+02:00", amount_minor: -9000 });
  return { db, acc, dinner };
}

describe("returns", () => {
  test("a new transaction starts with nothing returned", () => {
    const { dinner } = seed();
    expect(dinner.refunded_minor).toBe(0);
    expect(hasReturns(dinner)).toBe(false);
    expect(paidAmountMinor(dinner)).toBe(-9000);
  });

  test("a return shrinks the expense and remembers what was paid", () => {
    const { db, dinner } = seed();
    const after = applyReturn(db, dinner.id, 3000);
    expect(after.amount_minor).toBe(-6000);
    expect(after.refunded_minor).toBe(3000);
    expect(paidAmountMinor(after)).toBe(-9000);
    expect(hasReturns(after)).toBe(true);
  });

  test("returns accumulate: two people pay their share", () => {
    const { db, dinner } = seed();
    applyReturn(db, dinner.id, 3000);
    const after = applyReturn(db, dinner.id, 3000);
    expect(after.amount_minor).toBe(-3000);
    expect(after.refunded_minor).toBe(6000);
    expect(paidAmountMinor(after)).toBe(-9000);
  });

  test("the row keeps its id, so everything hanging off it follows", () => {
    const { db, dinner } = seed();
    const after = applyReturn(db, dinner.id, 1000);
    expect(after.id).toBe(dinner.id);
    expect(getRow(db, "transactions", dinner.id)!.amount_minor).toBe(-8000);
  });

  test("the account balance follows the shrunken amount", () => {
    const { db, acc, dinner } = seed();
    expect(accountBalanceMinor(db, acc.id, { includeFuture: true })).toBe(-9000);
    applyReturn(db, dinner.id, 3000);
    expect(accountBalanceMinor(db, acc.id, { includeFuture: true })).toBe(-6000);
  });

  test("a return can bring the amount to exactly zero but no further", () => {
    const { db, dinner } = seed();
    expect(checkReturn(db, dinner.id, 9000)).toMatchObject({ ok: true, amount_minor: 0 });
    expect(checkReturn(db, dinner.id, 9001)).toEqual({ ok: false, reason: "too-much" });
  });

  test("money moving the same way as the amount is not a return", () => {
    const { db, dinner } = seed();
    expect(checkReturn(db, dinner.id, -1000)).toEqual({ ok: false, reason: "wrong-direction" });
    expect(checkReturn(db, dinner.id, 0)).toEqual({ ok: false, reason: "zero" });
  });

  test("income can be returned too, in the other direction", () => {
    const { db, acc } = seed();
    const refund = createTransaction(db, { account_id: acc.id, date: "2026-09-11T10:00:00+02:00", amount_minor: 5000 });
    expect(checkReturn(db, refund.id, 1000)).toEqual({ ok: false, reason: "wrong-direction" });
    const after = applyReturn(db, refund.id, -2000);
    expect(after.amount_minor).toBe(3000);
    expect(after.refunded_minor).toBe(-2000);
    expect(paidAmountMinor(after)).toBe(5000);
  });

  test("a transfer leg takes no returns, and neither does a deleted or missing row", () => {
    const { db, acc, dinner } = seed();
    const other = createAccount(db, { name: "Cash", currency: "PLN" });
    const tr = createTransfer(db, {
      from_account_id: acc.id, to_account_id: other.id, date: "2026-09-12T10:00:00+02:00",
      from_amount_minor: 5000, to_amount_minor: 5000, from_currency: "PLN", to_currency: "PLN",
    });
    expect(checkReturn(db, tr.out.id, 1000)).toEqual({ ok: false, reason: "transfer" });
    expect(checkReturn(db, "nope", 1000)).toEqual({ ok: false, reason: "not-found" });
    remove(db, "transactions", dinner.id);
    expect(checkReturn(db, dinner.id, 1000)).toEqual({ ok: false, reason: "not-found" });
  });

  test("applyReturn refuses what checkReturn refuses", () => {
    const { db, dinner } = seed();
    expect(() => applyReturn(db, dinner.id, -100)).toThrow(/wrong-direction/);
    expect(() => applyReturn(db, dinner.id, 99999)).toThrow(/too-much/);
  });

  test("clearing the returns puts the amount back to what was paid", () => {
    const { db, dinner } = seed();
    applyReturn(db, dinner.id, 3000);
    applyReturn(db, dinner.id, 1000);
    const back = clearReturns(db, dinner.id)!;
    expect(back.amount_minor).toBe(-9000);
    expect(back.refunded_minor).toBe(0);
    expect(clearReturns(db, dinner.id)).toBeNull(); // nothing left to clear
  });
});
