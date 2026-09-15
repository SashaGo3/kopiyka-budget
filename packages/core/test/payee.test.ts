import { describe, expect, test } from "bun:test";
import { openBunDb } from "../src/drivers/bun";
import { migrate } from "../src/schema";
import { createAccount, createCategory, createTransaction, getRow, remove, suggestCategoryNear } from "../src/repo";
import { fillPending, isFiledBefore, noPayeeHistory, payeeHistory, payeeOptions, samePaymentSince } from "../src/payee";

function seed() {
  const db = openBunDb(); migrate(db);
  const acc = createAccount(db, { name: "Main", currency: "PLN" });
  const food = createCategory(db, { name: "Food" });
  return { db, acc, food };
}

const nothing = noPayeeHistory();

describe("payeeHistory", () => {
  test("empty name returns nothing", () => {
    const { db } = seed();
    expect(payeeHistory(db, null)).toEqual(nothing);
    expect(payeeHistory(db, "")).toEqual(nothing);
    expect(payeeHistory(db, "   ")).toEqual(nothing);
    expect(payeeHistory(db, null, "  ")).toEqual(nothing);
  });

  test("exact name match returns the category and tags of the newest matching row", () => {
    const { db, acc, food } = seed();
    createTransaction(db, { account_id: acc.id, date: "2026-09-01T10:00:00+02:00", amount_minor: -1000, payee: "ZABKA ZE212 K.5", category_id: food.id, tag_ids: JSON.stringify(["snack"]) });
    createTransaction(db, { account_id: acc.id, date: "2026-09-05T10:00:00+02:00", amount_minor: -1200, payee: "ZABKA ZE212 K.5", category_id: food.id, tag_ids: JSON.stringify(["snack", "work"]) });
    expect(payeeHistory(db, "zabka ze212 k.5")).toEqual({ ...nothing, category_id: food.id, tag_ids: ["snack", "work"] });
  });

  test("first-word fallback matches a different branch of the same chain", () => {
    const { db, acc, food } = seed();
    createTransaction(db, { account_id: acc.id, date: "2026-09-01T10:00:00+02:00", amount_minor: -1000, payee: "ZABKA ZE212 K.5", category_id: food.id, tag_ids: JSON.stringify(["snack"]) });
    expect(payeeHistory(db, "ZABKA NANO 3087")).toEqual({ ...nothing, category_id: food.id, tag_ids: ["snack"] });
  });

  test("unknown shop returns empty", () => {
    const { db, acc, food } = seed();
    createTransaction(db, { account_id: acc.id, date: "2026-09-01T10:00:00+02:00", amount_minor: -1000, payee: "ZABKA ZE212 K.5", category_id: food.id });
    expect(payeeHistory(db, "Costco")).toEqual(nothing);
  });

  test("a row with neither category nor tags is not a match", () => {
    const { db, acc } = seed();
    createTransaction(db, { account_id: acc.id, date: "2026-09-01T10:00:00+02:00", amount_minor: -1000, payee: "Unfiled Shop" });
    expect(payeeHistory(db, "Unfiled Shop")).toEqual(nothing);
  });

  test("the place and coordinates come from the newest located entry for the name", () => {
    const { db, acc, food } = seed();
    createTransaction(db, { account_id: acc.id, date: "2026-09-01T10:00:00+02:00", amount_minor: -1000, payee: "Costa", category_id: food.id, place: "Costa, Gdansk", lat: 51.11, lon: 17.03 });
    // Newer, filed, but with no location: the category comes from here, the place from the row above.
    createTransaction(db, { account_id: acc.id, date: "2026-09-06T10:00:00+02:00", amount_minor: -1400, payee: "Costa", category_id: food.id, tag_ids: JSON.stringify(["coffee"]) });
    expect(payeeHistory(db, "Costa")).toEqual({ category_id: food.id, tag_ids: ["coffee"], place: "Costa, Gdansk", lat: 51.11, lon: 17.03 });
  });

  test("a note matches a row that was filed under the same note", () => {
    const { db, acc, food } = seed();
    createTransaction(db, { account_id: acc.id, date: "2026-09-01T10:00:00+02:00", amount_minor: -900, notes: "Gym membership", category_id: food.id, tag_ids: JSON.stringify(["health"]), place: "Zdrofit" });
    expect(payeeHistory(db, null, "gym membership")).toEqual({ category_id: food.id, tag_ids: ["health"], place: "Zdrofit", lat: null, lon: null });
    expect(payeeHistory(db, null, "Gym")).toEqual(nothing);
  });

  test("a note matches a row that was filed under that name as a payee", () => {
    const { db, acc, food } = seed();
    createTransaction(db, { account_id: acc.id, date: "2026-09-01T10:00:00+02:00", amount_minor: -900, payee: "Netflix", category_id: food.id });
    expect(payeeHistory(db, null, "Netflix")).toEqual({ ...nothing, category_id: food.id });
  });

  test("the shop wins over the note when both are known", () => {
    const { db, acc } = seed();
    const shopCat = createCategory(db, { name: "Groceries" });
    const noteCat = createCategory(db, { name: "Fees" });
    createTransaction(db, { account_id: acc.id, date: "2026-09-01T10:00:00+02:00", amount_minor: -900, payee: "Biedronka", category_id: shopCat.id });
    createTransaction(db, { account_id: acc.id, date: "2026-09-04T10:00:00+02:00", amount_minor: -900, notes: "card fee", category_id: noteCat.id });
    expect(payeeHistory(db, "Biedronka", "card fee").category_id).toBe(shopCat.id);
  });

  test("transfer legs are never a match", () => {
    const { db, acc, food } = seed();
    createTransaction(db, { account_id: acc.id, date: "2026-09-01T10:00:00+02:00", amount_minor: -900, payee: "Revolut", category_id: food.id, transfer_id: "tr1" });
    expect(payeeHistory(db, "Revolut")).toEqual(nothing);
  });

  test("isFiledBefore is true only once a category is known", () => {
    const { db, acc, food } = seed();
    createTransaction(db, { account_id: acc.id, date: "2026-09-01T10:00:00+02:00", amount_minor: -900, payee: "Tagged Only", tag_ids: JSON.stringify(["misc"]) });
    createTransaction(db, { account_id: acc.id, date: "2026-09-01T10:00:00+02:00", amount_minor: -900, payee: "Filed", category_id: food.id });
    expect(isFiledBefore(payeeHistory(db, "Tagged Only"))).toBe(false);
    expect(isFiledBefore(payeeHistory(db, "Filed"))).toBe(true);
    expect(isFiledBefore(payeeHistory(db, "New Shop"))).toBe(false);
  });
});

describe("samePaymentSince", () => {
  function charged(db: ReturnType<typeof seed>["db"], acc: string, o: { date: string; amount: number; pending?: 0 | 1 }) {
    return createTransaction(db, { account_id: acc, date: o.date, amount_minor: o.amount, pending: o.pending ?? 1, payee: "Zabka" });
  }
  const since = "2026-09-05T11:50:00+02:00";

  test("finds the same amount on the same account inside the window", () => {
    const { db, acc } = seed();
    const t = charged(db, acc.id, { date: "2026-09-05T11:58:00+02:00", amount: -1200 });
    expect(samePaymentSince(db, { account_id: acc.id, amount_minor: -1200, sinceIso: since })?.id).toBe(t.id);
  });

  test("an already confirmed entry counts just as much as a pending one", () => {
    const { db, acc } = seed();
    const t = charged(db, acc.id, { date: "2026-09-05T11:58:00+02:00", amount: -1200, pending: 0 });
    expect(samePaymentSince(db, { account_id: acc.id, amount_minor: -1200, sinceIso: since })?.id).toBe(t.id);
  });

  test("a different amount, account, or an older entry is not a twin", () => {
    const { db, acc } = seed();
    const other = createAccount(db, { name: "Other", currency: "PLN" });
    charged(db, acc.id, { date: "2026-09-05T11:58:00+02:00", amount: -1300 });
    charged(db, other.id, { date: "2026-09-05T11:58:00+02:00", amount: -1200 });
    charged(db, acc.id, { date: "2026-09-05T11:30:00+02:00", amount: -1200 });
    expect(samePaymentSince(db, { account_id: acc.id, amount_minor: -1200, sinceIso: since })).toBeNull();
  });

  test("a deleted entry is not a twin", () => {
    const { db, acc } = seed();
    const t = charged(db, acc.id, { date: "2026-09-05T11:58:00+02:00", amount: -1200 });
    remove(db, "transactions", t.id);
    expect(samePaymentSince(db, { account_id: acc.id, amount_minor: -1200, sinceIso: since })).toBeNull();
  });
});

describe("fillPending", () => {
  const seedPending = (extra: Record<string, unknown> = {}) => {
    const { db, acc, food } = seed();
    const t = createTransaction(db, { account_id: acc.id, date: "2026-09-05T11:58:00+02:00", amount_minor: -1200, pending: 1, ...extra });
    return { db, acc, food, t };
  };

  test("writes only the fields that are empty", () => {
    const { db, t } = seedPending({ payee: "ZABKA", place: "Lodz" });
    const out = fillPending(db, t.id, { payee: "Zabka Nano", place: "Krakow", category_id: "cat-1" })!;
    expect(out.payee).toBe("ZABKA");
    expect(out.place).toBe("Lodz");
    expect(out.category_id).toBe("cat-1");
  });

  test("coordinates are written as a pair, and never over a point the row already has", () => {
    const { db, t } = seedPending();
    expect(fillPending(db, t.id, { lat: 51.1, lon: null })!.lat).toBeNull();
    const point = fillPending(db, t.id, { lat: 51.1, lon: 17.03 })!;
    expect([point.lat, point.lon]).toEqual([51.1, 17.03]);
    const again = fillPending(db, t.id, { lat: 52.2, lon: 21.01 })!;
    expect([again.lat, again.lon]).toEqual([51.1, 17.03]);
  });

  test("tags are filled only while the row has none", () => {
    const { db, t } = seedPending({ tag_ids: JSON.stringify(["own"]) });
    expect(fillPending(db, t.id, { tag_ids: ["new"] })!.tag_ids).toBe(JSON.stringify(["own"]));
    const { db: db2, t: t2 } = seedPending();
    expect(fillPending(db2, t2.id, { tag_ids: ["new"] })!.tag_ids).toBe(JSON.stringify(["new"]));
  });

  test("confirm takes the row out of the queue once it has a category", () => {
    const { db, t, food } = seedPending();
    expect(fillPending(db, t.id, { category_id: food.id }, true)!.pending).toBe(0);
  });

  test("confirm without a category leaves the row pending", () => {
    const { db, t } = seedPending();
    expect(fillPending(db, t.id, { tag_ids: ["snack"] }, true)!.pending).toBe(1);
  });

  test("confirm counts a category the row already had", () => {
    const { db, t, food } = seedPending({ category_id: null });
    const filed = fillPending(db, t.id, { category_id: food.id })!;
    expect(filed.pending).toBe(1);
    expect(fillPending(db, t.id, { place: "Katowice" }, true)!.pending).toBe(0);
  });

  test("an entry that is not pending, or gone, is never touched", () => {
    const { db, acc, food } = seed();
    const settled = createTransaction(db, { account_id: acc.id, date: "2026-09-05T11:58:00+02:00", amount_minor: -1200, pending: 0 });
    expect(fillPending(db, settled.id, { category_id: food.id })).toBeNull();
    expect(getRow(db, "transactions", settled.id)!.category_id).toBeNull();
    expect(fillPending(db, "nope", { category_id: food.id })).toBeNull();
  });
});

/**
 * A payment logged from a bank notification can now carry a location, but only because the Shortcuts
 * automation passed one in (native/KopiykaIntents.swift `location`): the intent runs in the
 * background and never takes a fix itself. This pins what the write is expected to do with it —
 * the same columns a hand-logged entry fills, and the same "category used near here" question.
 */
describe("a notification payment that came with a location", () => {
  const spot = { lat: 52.2298, lon: 21.0123 };

  test("the location is written like any other entry's, and a guess stays pending", () => {
    const { db, acc, food } = seed();
    const t = createTransaction(db, {
      account_id: acc.id, date: "2026-09-05T11:58:00+02:00", amount_minor: -1200, payee: "ZABKA NANO 3087",
      category_id: food.id, pending: 1, source: "shortcut-guess", place: "Zabka", ...spot,
    });
    expect([t.lat, t.lon, t.place]).toEqual([spot.lat, spot.lon, "Zabka"]);
    expect(t.pending).toBe(1);
    expect(t.source).toBe("shortcut-guess");
  });

  test("that location is what the next payment near here is guessed from", () => {
    const { db, acc, food } = seed();
    for (const day of ["01", "02", "03"]) {
      createTransaction(db, { account_id: acc.id, date: `2026-09-${day}T10:00:00+02:00`, amount_minor: -1200, category_id: food.id, place: "Zabka", ...spot });
    }
    expect(suggestCategoryNear(db, spot.lat, spot.lon)).toEqual({ category_id: food.id, count: 3, place: "Zabka" });
    // Far enough away and there is nothing to say — the guess is never a blanket one.
    expect(suggestCategoryNear(db, 50, 20)).toBeNull();
  });

  test("a second notification fills a missing location in and never moves one that is there", () => {
    const { db, acc } = seed();
    const blank = createTransaction(db, { account_id: acc.id, date: "2026-09-05T11:58:00+02:00", amount_minor: -1200, pending: 1, source: "shortcut" });
    const filled = fillPending(db, blank.id, { place: "Zabka", ...spot })!;
    expect([filled.lat, filled.lon, filled.place]).toEqual([spot.lat, spot.lon, "Zabka"]);
    const again = fillPending(db, blank.id, { place: "Elsewhere", lat: 50, lon: 20 })!;
    expect([again.lat, again.lon, again.place]).toEqual([spot.lat, spot.lon, "Zabka"]);
  });
});

describe("payeeOptions", () => {
  test("empty name, and a name nobody filed, return nothing", () => {
    const { db, acc } = seed();
    createTransaction(db, { account_id: acc.id, date: "2026-09-01T10:00:00+02:00", amount_minor: -1000, payee: "Unfiled Shop" });
    expect(payeeOptions(db, null)).toEqual([]);
    expect(payeeOptions(db, "Unfiled Shop")).toEqual([]);
    expect(payeeOptions(db, "Never Seen")).toEqual([]);
  });

  test("one way of filing a shop is one option", () => {
    const { db, acc, food } = seed();
    createTransaction(db, { account_id: acc.id, date: "2026-09-01T10:00:00+02:00", amount_minor: -1000, payee: "Costa", category_id: food.id, tag_ids: JSON.stringify(["coffee"]) });
    createTransaction(db, { account_id: acc.id, date: "2026-09-04T10:00:00+02:00", amount_minor: -1100, payee: "Costa", category_id: food.id, tag_ids: JSON.stringify(["coffee"]) });
    expect(payeeOptions(db, "costa")).toEqual([{ category_id: food.id, tag_ids: ["coffee"], count: 2 }]);
  });

  test("the same shop filed two ways offers both, most used first", () => {
    const { db, acc, food } = seed();
    const fuel = createCategory(db, { name: "Fuel" });
    createTransaction(db, { account_id: acc.id, date: "2026-09-01T10:00:00+02:00", amount_minor: -20000, payee: "ORLEN 4021", category_id: fuel.id });
    createTransaction(db, { account_id: acc.id, date: "2026-09-02T10:00:00+02:00", amount_minor: -1200, payee: "ORLEN 4021", category_id: food.id, tag_ids: JSON.stringify(["snack"]) });
    createTransaction(db, { account_id: acc.id, date: "2026-09-03T10:00:00+02:00", amount_minor: -18000, payee: "ORLEN 4021", category_id: fuel.id });
    expect(payeeOptions(db, "ORLEN 4021")).toEqual([
      { category_id: fuel.id, tag_ids: [], count: 2 },
      { category_id: food.id, tag_ids: ["snack"], count: 1 },
    ]);
  });

  test("tags in another order are the same option; different tags are not", () => {
    const { db, acc, food } = seed();
    createTransaction(db, { account_id: acc.id, date: "2026-09-01T10:00:00+02:00", amount_minor: -1000, payee: "Zabka", category_id: food.id, tag_ids: JSON.stringify(["snack", "work"]) });
    createTransaction(db, { account_id: acc.id, date: "2026-09-02T10:00:00+02:00", amount_minor: -1000, payee: "Zabka", category_id: food.id, tag_ids: JSON.stringify(["work", "snack"]) });
    createTransaction(db, { account_id: acc.id, date: "2026-09-03T10:00:00+02:00", amount_minor: -1000, payee: "Zabka", category_id: food.id, tag_ids: JSON.stringify(["snack"]) });
    const opts = payeeOptions(db, "Zabka");
    expect(opts.length).toBe(2);
    // The newest of the two rows sets the order the tags come back in.
    expect(opts[0]).toEqual({ category_id: food.id, tag_ids: ["work", "snack"], count: 2 });
    expect(opts[1]).toEqual({ category_id: food.id, tag_ids: ["snack"], count: 1 });
  });

  test("a note matches like a payee does, and the exact name wins over the chain", () => {
    const { db, acc, food } = seed();
    const fuel = createCategory(db, { name: "Fuel" });
    createTransaction(db, { account_id: acc.id, date: "2026-09-01T10:00:00+02:00", amount_minor: -1000, notes: "gym membership", category_id: food.id });
    expect(payeeOptions(db, null, "gym membership")).toEqual([{ category_id: food.id, tag_ids: [], count: 1 }]);
    // "ORLEN 4021" is filed; "ORLEN 9" is not, so it falls back to the chain's first word.
    createTransaction(db, { account_id: acc.id, date: "2026-09-02T10:00:00+02:00", amount_minor: -20000, payee: "ORLEN 4021", category_id: fuel.id });
    expect(payeeOptions(db, "ORLEN 9")).toEqual([{ category_id: fuel.id, tag_ids: [], count: 1 }]);
  });

  test("deleted and transfer rows are not options", () => {
    const { db, acc, food } = seed();
    const t = createTransaction(db, { account_id: acc.id, date: "2026-09-01T10:00:00+02:00", amount_minor: -1000, payee: "Gone", category_id: food.id });
    remove(db, "transactions", t.id);
    expect(payeeOptions(db, "Gone")).toEqual([]);
  });
});
