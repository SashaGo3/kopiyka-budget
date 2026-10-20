import { describe, expect, test } from "bun:test";
import { openBunDb } from "../src/drivers/bun";
import { migrate } from "../src/schema";
import { createAccount, createCategory, createTag, createTransaction, remove, save } from "../src/repo";
import { payeeHistory, payeeOptions, fillPending } from "../src/payee";
import { addPastTrip, carriedTagIds, endTrip, listTrips, startTrip, uncarriedTagIds, withTripTag } from "../src/trips";

/**
 * A trip's tag says when the money was spent, not what a shop is, so history never hands it on to a
 * new entry — only travel mode, while a trip runs, puts one there (DATA.md rule 5).
 */
function seed() {
  const db = openBunDb(); migrate(db);
  const acc = createAccount(db, { name: "Main", currency: "PLN" });
  const food = createCategory(db, { name: "Food" });
  const coffee = createTag(db, { name: "Coffee" });
  return { db, acc, food, coffee };
}

describe("uncarriedTagIds", () => {
  test("every trip's tag, ended, running or deleted, and archived tags; nothing else", () => {
    const { db, coffee } = seed();
    const past = addPastTrip(db, { name: "Rome", currency: "PLN", amount_minor: 1000, starts: "2026-03-01", ends: "2026-03-07" });
    const gone = addPastTrip(db, { name: "Oslo", currency: "PLN", amount_minor: 1000, starts: "2026-04-01", ends: "2026-04-07" });
    remove(db, "budgets", gone.budget.id);
    const now = startTrip(db, { name: "Lisbon", currency: "PLN", amount_minor: 1000, ends: "2026-10-09", today: "2026-10-05" });
    const old = createTag(db, { name: "Old", archived: 1 });
    const skip = uncarriedTagIds(db);
    expect([...skip].sort()).toEqual([past.tag.id, gone.tag.id, now.tag.id, old.id].sort());
    expect(skip.has(coffee.id)).toBe(false);
    expect(carriedTagIds([coffee.id, past.tag.id, "no-such-tag"], skip)).toEqual([coffee.id, "no-such-tag"]);
  });
});

describe("history does not hand on a trip's tag", () => {
  test("a shop first visited on a trip months ago: category yes, trip tag no", () => {
    const { db, acc, food, coffee } = seed();
    const { tag } = addPastTrip(db, { name: "Rome", currency: "PLN", amount_minor: 1000, starts: "2026-03-01", ends: "2026-03-07" });
    createTransaction(db, { account_id: acc.id, date: "2026-03-03T10:00:00+02:00", amount_minor: -900, payee: "Cafe Roma", category_id: food.id, tag_ids: JSON.stringify([tag.id, coffee.id]) });
    const h = payeeHistory(db, "Cafe Roma");
    expect(h.category_id).toBe(food.id);
    expect(h.tag_ids).toEqual([coffee.id]);
    expect(h.match).toBe("exact");
    expect(payeeOptions(db, "Cafe Roma")).toEqual([{ category_id: food.id, tag_ids: [coffee.id], count: 1 }]);
  });

  test("the same shop at home and on a trip is one option, not two", () => {
    const { db, acc, food } = seed();
    const { tag } = addPastTrip(db, { name: "Rome", currency: "PLN", amount_minor: 1000, starts: "2026-03-01", ends: "2026-03-07" });
    createTransaction(db, { account_id: acc.id, date: "2026-02-01T10:00:00+02:00", amount_minor: -900, payee: "Zabka", category_id: food.id });
    createTransaction(db, { account_id: acc.id, date: "2026-03-03T10:00:00+02:00", amount_minor: -900, payee: "Zabka", category_id: food.id, tag_ids: JSON.stringify([tag.id]) });
    // With two "ways" the automation would have left every later Zabka in the queue to be asked about.
    expect(payeeOptions(db, "Zabka")).toEqual([{ category_id: food.id, tag_ids: [], count: 2 }]);
  });

  test("a row whose only filing was the trip's tag does not hide the older one that was filed", () => {
    const { db, acc, coffee } = seed();
    const { tag } = addPastTrip(db, { name: "Rome", currency: "PLN", amount_minor: 1000, starts: "2026-03-01", ends: "2026-03-07" });
    createTransaction(db, { account_id: acc.id, date: "2026-02-01T10:00:00+02:00", amount_minor: -400, payee: "Bakery", tag_ids: JSON.stringify([coffee.id]) });
    createTransaction(db, { account_id: acc.id, date: "2026-03-04T10:00:00+02:00", amount_minor: -400, payee: "Bakery", tag_ids: JSON.stringify([tag.id]) });
    expect(payeeHistory(db, "Bakery").tag_ids).toEqual([coffee.id]);
    expect(payeeOptions(db, "Bakery")).toEqual([{ category_id: null, tag_ids: [coffee.id], count: 1 }]);
  });

  test("a row filed only by a trip's tag is no history at all", () => {
    const { db, acc } = seed();
    const { tag } = addPastTrip(db, { name: "Rome", currency: "PLN", amount_minor: 1000, starts: "2026-03-01", ends: "2026-03-07" });
    createTransaction(db, { account_id: acc.id, date: "2026-03-04T10:00:00+02:00", amount_minor: -400, payee: "Kiosk", tag_ids: JSON.stringify([tag.id]) });
    const h = payeeHistory(db, "Kiosk");
    expect(h.category_id).toBeNull();
    expect(h.tag_ids).toEqual([]);
    expect(h.match).toBeNull();
    expect(payeeOptions(db, "Kiosk")).toEqual([]);
  });

  test("a deleted trip's tag still names that trip and is not handed on", () => {
    const { db, acc, food } = seed();
    const { budget, tag } = addPastTrip(db, { name: "Oslo", currency: "PLN", amount_minor: 1000, starts: "2026-04-01", ends: "2026-04-07" });
    createTransaction(db, { account_id: acc.id, date: "2026-04-03T10:00:00+02:00", amount_minor: -900, payee: "Narvesen", category_id: food.id, tag_ids: JSON.stringify([tag.id]) });
    remove(db, "budgets", budget.id);
    expect(listTrips(db)).toEqual([]);
    expect(payeeHistory(db, "Narvesen").tag_ids).toEqual([]);
  });

  test("while a trip runs, history still hands on no trip tag: travel mode adds the running one, once", () => {
    const { db, acc, food } = seed();
    const rome = addPastTrip(db, { name: "Rome", currency: "PLN", amount_minor: 1000, starts: "2026-03-01", ends: "2026-03-07" });
    const lisbon = startTrip(db, { name: "Lisbon", currency: "PLN", amount_minor: 1000, ends: "2026-10-09", today: "2026-10-05" });
    // The same café, visited on both trips: last time's row carries this trip's tag and the old one's.
    createTransaction(db, { account_id: acc.id, date: "2026-10-05T09:00:00+02:00", amount_minor: -900, payee: "Cafe", category_id: food.id, tag_ids: JSON.stringify([rome.tag.id, lisbon.tag.id]) });
    const h = payeeHistory(db, "Cafe");
    expect(h.tag_ids).toEqual([]);
    // What the automation writes: history's tags, then travel mode's (nativeWrites `addTransaction`).
    expect(withTripTag(db, h.tag_ids)).toEqual([lisbon.tag.id]);
    expect(withTripTag(db, [lisbon.tag.id])).toEqual([lisbon.tag.id]);
    endTrip(db, lisbon.budget.id, "2026-10-09");
    expect(withTripTag(db, payeeHistory(db, "Cafe").tag_ids)).toEqual([]);
  });

  test("archived tags are left off, and an id with no tag behind it is left alone", () => {
    const { db, acc, food, coffee } = seed();
    const old = createTag(db, { name: "Old" });
    createTransaction(db, { account_id: acc.id, date: "2026-09-01T10:00:00+02:00", amount_minor: -900, payee: "Shop", category_id: food.id, tag_ids: JSON.stringify([old.id, coffee.id, "ghost"]) });
    save(db, "tags", { ...old, archived: 1 });
    expect(payeeHistory(db, "Shop").tag_ids).toEqual([coffee.id, "ghost"]);
  });

  test("fillPending writes what history hands it: no trip tag reaches a pending row that way", () => {
    const { db, acc, food } = seed();
    const { tag } = addPastTrip(db, { name: "Rome", currency: "PLN", amount_minor: 1000, starts: "2026-03-01", ends: "2026-03-07" });
    createTransaction(db, { account_id: acc.id, date: "2026-03-03T10:00:00+02:00", amount_minor: -900, payee: "Cafe Roma", category_id: food.id, tag_ids: JSON.stringify([tag.id]) });
    const p = createTransaction(db, { account_id: acc.id, date: "2026-10-05T10:00:00+02:00", amount_minor: -900, pending: 1 });
    const h = payeeHistory(db, "Cafe Roma");
    const filled = fillPending(db, p.id, { payee: "Cafe Roma", category_id: h.category_id, tag_ids: h.tag_ids }, true)!;
    expect(filled.tag_ids).toBe("[]");
    expect(filled.category_id).toBe(food.id);
    expect(filled.pending).toBe(0);
  });
});
