import { describe, expect, test } from "bun:test";
import { suggestInsights } from "../src/insightHints";
import { openBunDb } from "../src/drivers/bun";
import { migrate } from "../src/schema";
import { createAccount, createCategory, createInsight, createRecurring, createTransaction, createTransfer } from "../src/repo";

const TODAY = "2026-11-10";

function busy() {
  const db = openBunDb(); migrate(db);
  const main = createAccount(db, { name: "Main", currency: "PLN" });
  const sav = createAccount(db, { name: "Savings - Euro", currency: "PLN" });
  const food = createCategory(db, { name: "Groceries" });
  const salary = createCategory(db, { name: "Salary" });
  // Four months of salary and groceries four times a week.
  for (const m of ["07", "08", "09", "10"]) {
    createTransaction(db, { account_id: main.id, date: `2026-${m}-02T10:00:00+02:00`, amount_minor: 8000_00, category_id: salary.id });
    for (let d = 3; d <= 28; d += 2) createTransaction(db, { account_id: main.id, date: `2026-${m}-${String(d).padStart(2, "0")}T10:00:00+02:00`, amount_minor: -40_00, category_id: food.id, payee: `Shop ${d}` });
  }
  createTransfer(db, { from_account_id: main.id, to_account_id: sav.id, date: "2026-10-05T10:00:00+02:00", from_amount_minor: 1000_00, to_amount_minor: 1000_00, from_currency: "PLN", to_currency: "PLN" });
  for (const payee of ["Rent", "Phone", "Gym"]) createRecurring(db, { account_id: main.id, amount_minor: -100_00, frequency: "monthly", start_date: "2026-11-20", next_date: "2026-11-20", payee, auto_post: 0 });
  return { db, main, sav, food };
}

describe("suggestInsights", () => {
  test("suggests from usage, with the reason's numbers", () => {
    const { db, sav, food } = busy();
    const h = suggestInsights(db, { today: TODAY, startDay: 1, existing: [] });
    const by = new Map(h.map((x) => [x.key, x]));
    expect(by.get("forecast")).toMatchObject({ why: "history", count: 4 });
    expect(by.get(`savings_goal:${sav.id}`)).toMatchObject({ setup: true, params: { account_id: sav.id } });
    expect(by.get("checklist")).toMatchObject({ why: "manual", count: 3, params: { include_recurring: true } });
    expect(by.get("subscriptions")).toMatchObject({ count: 3 });
    expect(by.get(`regular:${food.id}`)).toMatchObject({ why: "habit", params: { category_ids: [food.id], frequency: "weekly" } });
    expect(by.get("days_to_salary")).toMatchObject({ count: 4 });
    expect(by.get("top_shops")?.count).toBeGreaterThanOrEqual(10);
    // No budgets, no places, nothing marked: nothing to say about those.
    for (const k of ["free_money", "spending_map", "values"]) expect(by.has(k)).toBe(false);
  });

  test("never what is already on the screen, nor what was waved away", () => {
    const { db, sav } = busy();
    createInsight(db, { kind: "forecast" });
    createInsight(db, { kind: "savings_goal", params: JSON.stringify({ account_id: sav.id, target_minor: 5000_00 }) });
    const existing = db.all<{ kind: never; params: string }>("SELECT kind, params FROM insights WHERE deleted=0");
    const keys = suggestInsights(db, { today: TODAY, startDay: 1, existing, dismissed: ["checklist"] }).map((x) => x.key);
    expect(keys).not.toContain("forecast");
    expect(keys).not.toContain(`savings_goal:${sav.id}`);
    expect(keys).not.toContain("checklist");
    expect(keys).toContain("subscriptions");
  });

  test("a new phone gets nothing it cannot back up with numbers", () => {
    const db = openBunDb(); migrate(db);
    createAccount(db, { name: "Main", currency: "PLN" });
    expect(suggestInsights(db, { today: TODAY, startDay: 1, existing: [] })).toEqual([]);
  });
});
