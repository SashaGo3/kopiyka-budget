import { describe, expect, test } from "bun:test";
import { openBunDb } from "../src/drivers/bun";
import { migrate } from "../src/schema";
import { createAccount, createTransaction, remove } from "../src/repo";
import { emptyListAction, latestDayBefore } from "../src/emptyList";

function fresh() { const db = openBunDb(); migrate(db); return db; }

describe("emptyListAction", () => {
  // The bug: on this month, every account, no filters — "Show everything" reset the screen to the
  // state it was already in, so tapping it did nothing at all.
  test("never offers a reset when there is nothing to reset", () => {
    expect(emptyListAction({ filters: 0, scoped: false, isCurrent: true, earlierDay: null })).toEqual({ kind: "none" });
  });
  test("this month empty, an earlier one is not: offers that one", () => {
    expect(emptyListAction({ filters: 0, scoped: false, isCurrent: true, earlierDay: "2026-10-30" })).toEqual({ kind: "earlier", day: "2026-10-30" });
  });
  test("another month empty: back to this one", () => {
    expect(emptyListAction({ filters: 0, scoped: false, isCurrent: false, earlierDay: "2026-01-02" })).toEqual({ kind: "current" });
  });
  test("filters or an account scope: clears them first", () => {
    expect(emptyListAction({ filters: 2, scoped: false, isCurrent: true, earlierDay: null })).toEqual({ kind: "reset" });
    expect(emptyListAction({ filters: 0, scoped: true, isCurrent: false, earlierDay: null })).toEqual({ kind: "reset" });
  });
});

describe("latestDayBefore", () => {
  test("the newest day before the month, on the accounts asked about", () => {
    const db = fresh();
    const a = createAccount(db, { name: "Cash", currency: "PLN" });
    const b = createAccount(db, { name: "Card", currency: "PLN" });
    createTransaction(db, { account_id: a.id, date: "2026-09-07T10:00:00+02:00", amount_minor: -500 });
    createTransaction(db, { account_id: a.id, date: "2026-10-31T23:30:00+01:00", amount_minor: -700 });
    createTransaction(db, { account_id: b.id, date: "2026-11-14T09:00:00+01:00", amount_minor: -100 });   // the open month itself
    expect(latestDayBefore(db, "2026-11-01")).toBe("2026-10-31");
    expect(latestDayBefore(db, "2026-11-15")).toBe("2026-11-14");
    expect(latestDayBefore(db, "2026-11-15", [a.id])).toBe("2026-10-31");
    expect(latestDayBefore(db, "2026-09-01")).toBeNull();
  });
  test("a deleted row is not somewhere to go", () => {
    const db = fresh();
    const a = createAccount(db, { name: "Cash", currency: "PLN" });
    const tx = createTransaction(db, { account_id: a.id, date: "2026-10-03T10:00:00+02:00", amount_minor: -500 });
    remove(db, "transactions", tx.id);
    expect(latestDayBefore(db, "2026-11-01")).toBeNull();
  });
});
