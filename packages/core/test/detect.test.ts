import { describe, expect, test } from "bun:test";
import { openBunDb } from "../src/drivers/bun";
import { migrate } from "../src/schema";
import { createAccount, createCategory, createRecurring, createTransaction } from "../src/repo";
import { adoptCandidate, detectRecurring } from "../src/detect";

function fresh() { const db = openBunDb(); migrate(db); return db; }

describe("recurring detection", () => {
  test("monthly subscription by note, weekly by category+amount, one-offs ignored", () => {
    const db = fresh();
    const acc = createAccount(db, { name: "A", currency: "PLN" });
    for (const d of ["2026-03-06", "2026-04-06", "2026-05-06", "2026-06-06", "2026-07-06"])
      createTransaction(db, { account_id: acc.id, date: `${d}T10:00:00+02:00`, amount_minor: -6000, notes: "Disney+ subscription" });
    for (let i = 0; i < 6; i++) { const d = new Date(Date.UTC(2026, 5, 1 + 7 * i)).toISOString().slice(0, 10); createTransaction(db, { account_id: acc.id, date: `${d}T08:00:00+02:00`, amount_minor: -28000, category_id: "polish" }); }
    createTransaction(db, { account_id: acc.id, date: "2026-06-10T10:00:00+02:00", amount_minor: -9999, notes: "One off" });
    createTransaction(db, { account_id: acc.id, date: "2026-06-11T10:00:00+02:00", amount_minor: -1500, category_id: "food" });
    createTransaction(db, { account_id: acc.id, date: "2026-06-20T10:00:00+02:00", amount_minor: -1500, category_id: "food" });
    const c = detectRecurring(db, { today: "2026-07-15" });
    expect(c.map((x) => [x.title ?? x.category_id, x.frequency, x.next_date])).toEqual([
      ["polish", "weekly", "2026-07-20"],
      ["Disney+ subscription", "monthly", "2026-08-06"],
    ]);
    // creating a rule hides the suggestion
    createRecurring(db, { account_id: acc.id, amount_minor: -6000, frequency: "monthly", start_date: "2026-08-06", payee: "Disney+ subscription" });
    expect(detectRecurring(db, { today: "2026-07-15" }).length).toBe(1);
  });

  test("future planned row becomes next date", () => {
    const db = fresh();
    const acc = createAccount(db, { name: "A", currency: "PLN" });
    for (const d of ["2024-10-04", "2025-10-04", "2026-10-04"]) createTransaction(db, { account_id: acc.id, date: `${d}T16:14:00+02:00`, amount_minor: -80000, notes: "Raycast app yearly" });
    const c = detectRecurring(db, { today: "2026-09-07" });
    expect(c[0]).toMatchObject({ frequency: "yearly", next_date: "2026-10-04", occurrences: 3, source: "planned" });
    expect(c[0]!.planned_tx_id).toBeTruthy();
  });

  test("planned row with no history uses the category name for the period", () => {
    const db = fresh();
    const acc = createAccount(db, { name: "A", currency: "PLN" });
    const yearly = createCategory(db, { name: "Subscription (Yearly)" });
    const monthly = createCategory(db, { name: "Subscription (Monthly)" });
    createTransaction(db, { account_id: acc.id, date: "2027-07-13T16:02:00+02:00", amount_minor: -342100, notes: "Leadenhall", category_id: yearly.id });
    createTransaction(db, { account_id: acc.id, date: "2026-10-06T17:36:00+02:00", amount_minor: -6000, notes: "Disney+ subscription", category_id: monthly.id });
    const c = detectRecurring(db, { today: "2026-09-07" });
    expect(c.map((x) => [x.title, x.frequency, x.next_date, x.confidence])).toEqual([
      ["Disney+ subscription", "monthly", "2026-10-06", 0.7],
      ["Leadenhall", "yearly", "2027-07-13", 0.7],
    ]);
  });

  test("a planned row whose note changed still finds its previous occurrence through a shared tag", () => {
    const db = fresh();
    const acc = createAccount(db, { name: "A", currency: "PLN" });
    const ins = createCategory(db, { name: "Insurance" });
    const tags = JSON.stringify(["tag-leadenhall"]);
    createTransaction(db, { account_id: acc.id, date: "2026-07-23T11:59:00+02:00", amount_minor: -342100, notes: "SIS1-K03X-3H9W", category_id: ins.id, tag_ids: tags });
    createTransaction(db, { account_id: acc.id, date: "2027-07-13T16:02:00+02:00", amount_minor: -342100, notes: "Leadenhall insurance", category_id: ins.id, tag_ids: tags });
    const c = detectRecurring(db, { today: "2026-09-07" });
    expect(c.map((x) => [x.title, x.frequency, x.last_date, x.next_date, x.confidence])).toEqual([["Leadenhall insurance", "yearly", "2026-07-23", "2027-07-13", 0.6]]);
  });

  test("a future-dated template row for each series becomes its own planned candidate", () => {
    const db = fresh();
    const acc = createAccount(db, { name: "A", currency: "PLN" });
    // Three independent series, each with a run of history plus one future-dated template row
    // standing for the next occurrence — the way an import can hand off a next-occurrence row.
    for (const d of ["2026-03-06", "2026-04-06", "2026-05-06", "2026-06-06", "2026-07-06", "2026-08-06", "2026-09-06"])
      createTransaction(db, { account_id: acc.id, date: `${d}T08:00:00+02:00`, amount_minor: -1500, notes: "Netflix" });
    createTransaction(db, { account_id: acc.id, date: "2026-10-06T08:00:00+02:00", amount_minor: -1500, notes: "Netflix" });

    for (const d of ["2024-11-13", "2025-11-13"])
      createTransaction(db, { account_id: acc.id, date: `${d}T09:30:00+02:00`, amount_minor: -342100, notes: "Home Insurance" });
    createTransaction(db, { account_id: acc.id, date: "2026-11-13T09:30:00+02:00", amount_minor: -342100, notes: "Home Insurance" });

    for (const d of ["2025-12-10", "2026-03-10", "2026-06-10"])
      createTransaction(db, { account_id: acc.id, date: `${d}T11:00:00+02:00`, amount_minor: -25000, notes: "Car Service" });
    createTransaction(db, { account_id: acc.id, date: "2026-09-10T11:00:00+02:00", amount_minor: -25000, notes: "Car Service" });

    const c = detectRecurring(db, { today: "2026-09-07" });
    const planned = c.filter((x) => x.source === "planned");
    // Each series' future-dated row becomes exactly one planned candidate, with the period history implies.
    expect(planned.length).toBe(3);
    expect(planned.map((x) => [x.title, x.frequency, x.interval, x.next_date]).sort()).toEqual([
      ["Car Service", "monthly", 3, "2026-09-10"],
      ["Home Insurance", "yearly", 1, "2026-11-13"],
      ["Netflix", "monthly", 1, "2026-10-06"],
    ]);
  });
});

describe("adopt", () => {
  test("creates the rule and removes the planned placeholder", () => {
    const db = fresh();
    const acc = createAccount(db, { name: "A", currency: "PLN" });
    const monthly = createCategory(db, { name: "Subscription (Monthly)" });
    const planned = createTransaction(db, { account_id: acc.id, date: "2026-10-06T17:36:00+02:00", amount_minor: -6000, notes: "Disney+ subscription", category_id: monthly.id });
    const [c] = detectRecurring(db, { today: "2026-09-07" });
    const rule = adoptCandidate(db, c!);
    expect(rule).toMatchObject({ payee: "Disney+ subscription", frequency: "monthly", next_date: "2026-10-06", notify: 1, notify_days_before: 1, auto_post: 1, time_of_day: "17:36" });
    expect(db.get<{ deleted: number }>(`SELECT deleted FROM transactions WHERE id=?`, [planned.id])?.deleted).toBe(1);
    expect(detectRecurring(db, { today: "2026-09-07" }).length).toBe(0);
  });
});
