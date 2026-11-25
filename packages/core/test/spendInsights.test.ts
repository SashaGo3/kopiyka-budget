import { describe, expect, test } from "bun:test";
import { openBunDb } from "../src/drivers/bun";
import { migrate } from "../src/schema";
import { createAccount, createCategory, createRecurring, createTransaction } from "../src/repo";
import { biggestOneOffs, comparableWindows, monthVsUsual, shopKey, spendingPlaces, topShops } from "../src/spendInsights";

function world() {
  const db = openBunDb(); migrate(db);
  const acc = createAccount(db, { name: "Main", currency: "PLN" });
  const eur = createAccount(db, { name: "Card", currency: "EUR" });
  const food = createCategory(db, { name: "Food" });
  const groceries = createCategory(db, { name: "Groceries", parent_id: food.id });
  const coffee = createCategory(db, { name: "Coffee", parent_id: food.id });
  const fun = createCategory(db, { name: "Fun" });
  const tx = (date: string, amount_minor: number, more: Record<string, unknown> = {}) =>
    createTransaction(db, { account_id: acc.id, date: `${date}T12:00:00+02:00`, amount_minor, ...more });
  return { db, acc, eur, food, groceries, coffee, fun, tx };
}

const SEP = { start: "2026-09-01", end: "2026-10-01" };

describe("comparableWindows", () => {
  test("a running period is compared day for day", () => {
    const w = comparableWindows({ ...SEP, today: "2026-09-10", startDay: 1, count: 3 });
    expect(w.partial).toBe(true);
    expect(w.days).toBe(10);
    expect(w.now).toEqual({ start: "2026-09-01", end: "2026-09-11" });
    expect(w.before).toEqual([
      { start: "2026-08-01", end: "2026-08-11" }, { start: "2026-07-01", end: "2026-07-11" }, { start: "2026-06-01", end: "2026-06-11" },
    ]);
  });
  test("a finished period is compared whole", () => {
    const w = comparableWindows({ ...SEP, today: "2026-09-30", startDay: 1, count: 1 });
    expect(w.partial).toBe(false);
    expect(w.before).toEqual([{ start: "2026-08-01", end: "2026-09-01" }]);
  });
});

describe("monthVsUsual", () => {
  test("per folder, against the mean of the periods before, zero periods included", () => {
    const { db, food, groceries, coffee, fun, tx } = world();
    tx("2026-09-05", -30000, { category_id: groceries.id });
    tx("2026-09-06", -6000, { category_id: coffee.id });
    tx("2026-08-05", -20000, { category_id: groceries.id });
    tx("2026-07-05", -20000, { category_id: groceries.id });
    tx("2026-06-05", -20000, { category_id: groceries.id });
    tx("2026-08-10", -9000, { category_id: fun.id }); // only last month: usual 3000, now 0
    tx("2026-09-07", -1000); // uncategorised: in the total, no line
    const [r] = monthVsUsual(db, { ...SEP, today: "2026-09-30", startDay: 1 });
    expect(r!.currency).toBe("PLN");
    const foodLine = r!.lines.find((l) => l.category_id === food.id)!;
    expect(foodLine).toEqual({ category_id: food.id, now_minor: 36000, usual_minor: 20000, diff_minor: 16000, ratio: 0.8 });
    expect(r!.lines.find((l) => l.category_id === fun.id)).toEqual({ category_id: fun.id, now_minor: 0, usual_minor: 3000, diff_minor: -3000, ratio: -1 });
    expect(r!.lines[0]!.category_id).toBe(food.id); // biggest change first
    expect(r!.now_minor).toBe(37000);
    expect(r!.lines.some((l) => l.category_id === null)).toBe(false);
  });

  test("early in a running month only the same days of earlier months count", () => {
    const { db, groceries, tx } = world();
    tx("2026-09-03", -5000, { category_id: groceries.id });
    tx("2026-08-03", -5000, { category_id: groceries.id });
    tx("2026-08-25", -50000, { category_id: groceries.id }); // later in August: not yet comparable
    const [r] = monthVsUsual(db, { ...SEP, today: "2026-09-05", startDay: 1, periods: 1 });
    expect(r!.partial).toBe(true);
    expect(r!.lines[0]!.usual_minor).toBe(5000);
    expect(r!.lines[0]!.ratio).toBe(0);
  });

  test("new spending has no ratio", () => {
    const { db, fun, tx } = world();
    tx("2026-09-05", -1000, { category_id: fun.id });
    expect(monthVsUsual(db, { ...SEP, today: "2026-09-30", startDay: 1 })[0]!.lines[0]!.ratio).toBeNull();
  });
});

describe("biggestOneOffs", () => {
  test("the largest purchases, without recurring, transfers or debt payments", () => {
    const { db, acc, tx } = world();
    const rule = createRecurring(db, { account_id: acc.id, amount_minor: -200000, frequency: "monthly", start_date: "2026-01-01" });
    tx("2026-09-01", -200000, { recurring_id: rule.id, payee: "Landlord" });
    tx("2026-09-02", -50000, { payee: "IKEA" });
    tx("2026-09-03", -80000, { payee: "Media Expert" });
    tx("2026-09-04", -1000, { payee: "Żabka" });
    tx("2026-09-05", -3000, { payee: "Lidl" });
    tx("2026-09-06", -99999, { transfer_id: "x" });
    tx("2026-09-07", 500000, { payee: "Salary" });
    tx("2026-08-20", -900000, { payee: "Last month" });
    const [r] = biggestOneOffs(db, { start: SEP.start, end: SEP.end });
    expect(r!.rows.map((x) => x.payee)).toEqual(["Media Expert", "IKEA", "Lidl"]);
  });
});

describe("topShops", () => {
  test("branches of one chain are one shop; method words and branch codes are not names", () => {
    expect(shopKey("ZABKA ZE212 K.5")).toBe("zabka");
    expect(shopKey("Żabka Nano 3087")).toBe("zabka");
    expect(shopKey("BLIK Allegro")).toBe("allegro");
    expect(shopKey("1234")).toBeNull();
  });

  test("most spent first, with the same days of the period before", () => {
    const { db, tx } = world();
    tx("2026-09-02", -1500, { payee: "ZABKA ZE212 K.5" });
    tx("2026-09-03", -2500, { payee: "Żabka Nano 3087" });
    tx("2026-09-04", -1000, { payee: "ZABKA ZE212 K.5" });
    tx("2026-09-05", -8000, { payee: "Biedronka 1234" });
    tx("2026-08-04", -3000, { payee: "Zabka" });
    tx("2026-08-28", -3000, { payee: "Zabka" }); // after the 10th: not comparable yet
    tx("2026-09-06", -500, { notes: "cash for a friend" }); // no shop
    const [r] = topShops(db, { ...SEP, today: "2026-09-10", startDay: 1 });
    expect(r!.shops.map((s) => [s.key, s.spent_minor, s.count, s.prev_minor])).toEqual([["biedronka", 8000, 1, 0], ["zabka", 5000, 3, 3000]]);
    expect(r!.shops[1]!.name).toBe("ZABKA ZE212 K.5");
  });
});

describe("topShops, by hand and by bank", () => {
  test("a hand-typed entry counts by its place, and a known chain is one shop whatever comes before it", () => {
    const { db, tx } = world();
    tx("2026-09-02", -3000, { payee: "JMP S.A. BIEDRONKA 1234" });
    tx("2026-09-03", -9000, { place: "Biedronka" }); // logged by hand: no payee
    tx("2026-09-04", -2000, { place: "Kawiarnia Pod Lipą" });
    const [r] = topShops(db, { ...SEP, today: "2026-09-30", startDay: 1 });
    expect(r!.shops.map((s) => [s.key, s.spent_minor, s.count])).toEqual([["biedronka", 12000, 2], ["kawiarnia", 2000, 1]]);
  });
});

describe("spendingPlaces", () => {
  test("one shop is one place even when its fixes fall either side of where a grid line would be", () => {
    const { db, tx } = world();
    const cell = 150 / 111_000, edge = Math.ceil(52.25 / cell) * cell;
    tx("2026-09-02", -4000, { lat: edge - 0.0003, lon: 21.05 });
    tx("2026-09-03", -4000, { lat: edge + 0.0003, lon: 21.05 });
    tx("2026-09-04", -3000, { lat: edge + 0.0002, lon: 21.05, place: "Lidl" });
    tx("2026-09-05", -3000, { lat: edge + 0.0009, lon: 21.0505, place: "lidl" });
    const [r] = spendingPlaces(db, { start: SEP.start, end: SEP.end });
    expect(r!.places.map((p) => [p.spent_minor, p.count])).toEqual([[8000, 2], [6000, 2]]);
  });

  test("a named place gathers its rows; unnamed ones gather by block", () => {
    const { db, tx } = world();
    tx("2026-09-02", -4000, { lat: 52.2297, lon: 21.0122, place: "Biedronka" });
    tx("2026-09-03", -6000, { lat: 52.2301, lon: 21.0125, place: "biedronka" });
    tx("2026-09-04", -1000, { lat: 50.0647, lon: 19.945, place: "Biedronka" }); // another town
    tx("2026-09-05", -2000, { lat: 52.25, lon: 21.05 });
    tx("2026-09-06", -2000, { lat: 52.25001, lon: 21.05001 });
    tx("2026-09-07", -9000); // nowhere
    const [r] = spendingPlaces(db, { start: SEP.start, end: SEP.end });
    expect(r!.total_minor).toBe(24000);
    expect(r!.located_minor).toBe(15000);
    expect(r!.places.map((p) => [p.spent_minor, p.count])).toEqual([[10000, 2], [4000, 2], [1000, 1]]);
    const shop = r!.places[0]!;
    expect(shop.lat).toBeGreaterThan(52.2297);
    expect(shop.lat).toBeLessThan(52.2301);
  });
});
