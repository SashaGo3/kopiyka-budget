import { expect, test } from "bun:test";
import { convertWaitingCharges, createAccount, createTransaction, getRow, withoutNoRate } from "../src";
import { openBunDb } from "../src/drivers/bun";
import { migrate } from "../src/schema";

// Frankfurter knows no UAH (404), NBP gives złoty per unit.
const fakeFetch = (async (url: string) => {
  const u = String(url);
  if (u.includes("frankfurter")) return new Response(JSON.stringify({ message: "not found" }), { status: 404 });
  if (u.includes("/uah/")) return new Response(JSON.stringify({ rates: [{ mid: 0.0903 }] }));
  return new Response("", { status: 404 });
}) as unknown as typeof fetch;

test("a hryvnia charge logged at 0 becomes an expense in złoty at the day's NBP rate", async () => {
  const db = openBunDb(":memory:");
  migrate(db);
  const acc = createAccount(db, { name: "Main", currency: "PLN" });
  const tx = createTransaction(db, { account_id: acc.id, amount_minor: 0, date: "2026-11-20T13:11:20", pending: 0,
    entered_amount_minor: -227261, entered_currency: "UAH", bank_note: "GERC*passport_APGP, KYIV · 2 272,61 UAH — немає курсу, вкажи суму" } as never);
  expect(await convertWaitingCharges(db, "2026-11-21", fakeFetch)).toBe(1);
  const row = getRow(db, "transactions", tx.id)!;
  expect(row.amount_minor).toBe(-20522); // 2272.61 × 0.0903
  expect(row.exchange_rate).toBeCloseTo(0.0903);
  expect(row.bank_note).toBe("GERC*passport_APGP, KYIV · 2 272,61 UAH");
  expect(await convertWaitingCharges(db, "2026-11-21", fakeFetch)).toBe(0);
});

test("bank text without the no-rate words is left alone", () => {
  expect(withoutNoRate("REF 12 — KYIV", "UAH")).toBe("REF 12 — KYIV");
});
