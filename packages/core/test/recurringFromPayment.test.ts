import { describe, expect, test } from "bun:test";
import { openBunDb } from "../src/drivers/bun";
import { migrate } from "../src/schema";
import { createAccount, createCategory, createRecurring, createTransaction, getRow } from "../src/repo";
import { candidateFromTransaction } from "../src/detect";
import { linkToRule } from "../src/claim";
import { detectRecurring } from "../src/detect";
import { dueManualRules, nextOccurrenceAfter, waitingRules } from "../src/recurring";
import { startTrip } from "../src/trips";

/**
 * A rule made from a payment (Recurring → Add → from a past payment). The TestFlight report of
 * 2026-10-28: a tyre change paid today, repeated every 6 months, was shown as due today, waited
 * for a charge today, and left today's payment outside the rule.
 */
const TODAY = "2026-10-28";
function fresh() { const db = openBunDb(); migrate(db); return db; }

describe("nextOccurrenceAfter", () => {
  test("never the day of the payment it counts from", () => {
    expect(nextOccurrenceAfter(TODAY, "monthly", 6, TODAY)).toBe("2027-04-28");
    expect(nextOccurrenceAfter(TODAY, "monthly", 1, TODAY)).toBe("2026-11-28");
    expect(nextOccurrenceAfter(TODAY, "yearly", 1, TODAY)).toBe("2027-10-28");
    expect(nextOccurrenceAfter(TODAY, "weekly", 2, TODAY)).toBe("2026-11-11");
  });
  test("an old payment rolls forward to the first occurrence not yet past; today counts", () => {
    expect(nextOccurrenceAfter("2026-04-28", "monthly", 6, TODAY)).toBe(TODAY);
    expect(nextOccurrenceAfter("2026-01-15", "monthly", 6, TODAY)).toBe("2027-01-15");
    expect(nextOccurrenceAfter("2026-08-31", "monthly", 1, TODAY)).toBe("2026-10-30");
  });
  test("a zero interval cannot loop", () => {
    expect(nextOccurrenceAfter("2026-01-01", "monthly", 0, TODAY)).toBe("2026-01-01");
  });
});

describe("candidateFromTransaction", () => {
  test("a single payment made today starts the rule one period later, not today", () => {
    const db = fresh();
    const acc = createAccount(db, { name: "A", currency: "PLN" });
    const tx = createTransaction(db, { account_id: acc.id, date: `${TODAY}T09:56:00+01:00`, amount_minor: -36000, payee: "ZWOLAK SERWIS" });
    const c = candidateFromTransaction(db, tx.id, TODAY)!;
    expect(c).toMatchObject({ frequency: "monthly", interval: 1, last_date: TODAY, next_date: "2026-11-28", time_of_day: "09:56", match_payee: "ZWOLAK SERWIS" });
    // What the sheet does when Repeat is changed to every 6 months.
    expect(nextOccurrenceAfter(c.last_date!, "monthly", 6, TODAY)).toBe("2027-04-28");
  });

  test("an older single payment is still counted from its own day", () => {
    const db = fresh();
    const acc = createAccount(db, { name: "A", currency: "PLN" });
    const tx = createTransaction(db, { account_id: acc.id, date: "2026-09-10T12:00:00+02:00", amount_minor: -5000, payee: "Gym" });
    expect(candidateFromTransaction(db, tx.id, TODAY)).toMatchObject({ last_date: "2026-09-10", next_date: "2026-11-10" });
  });

  test("a pending payment is outside the detected series, and the rule still starts after it", () => {
    const db = fresh();
    const acc = createAccount(db, { name: "A", currency: "PLN" });
    for (const d of ["2026-07-28", "2026-08-28", "2026-09-28"]) createTransaction(db, { account_id: acc.id, date: `${d}T10:00:00+02:00`, amount_minor: -4999, payee: "Netflix" });
    // Today's, logged by the automation and not yet approved: the series is summarised without it.
    const tx = createTransaction(db, { account_id: acc.id, date: `${TODAY}T10:00:00+01:00`, amount_minor: -4999, payee: "Netflix", pending: 1, source: "shortcut" });
    const c = candidateFromTransaction(db, tx.id, TODAY)!;
    expect(c).toMatchObject({ frequency: "monthly", interval: 1, source: "history", last_date: TODAY, next_date: "2026-11-28" });
  });

  test("a payment from a series that is behind it keeps the series' next date", () => {
    const db = fresh();
    const acc = createAccount(db, { name: "A", currency: "PLN" });
    const ids = ["2026-07-05", "2026-08-05", "2026-09-05", "2026-10-05"].map((d) => createTransaction(db, { account_id: acc.id, date: `${d}T10:00:00+02:00`, amount_minor: -2000, payee: "Spotify" }).id);
    expect(candidateFromTransaction(db, ids[1]!, TODAY)).toMatchObject({ last_date: "2026-10-05", next_date: "2026-11-05" });
  });
});

describe("a rule made from a payment owns that payment", () => {
  function scenario() {
    const db = fresh();
    const acc = createAccount(db, { name: "A", currency: "PLN" });
    const car = createCategory(db, { name: "Car Maintenance" });
    const tx = createTransaction(db, { account_id: acc.id, date: `${TODAY}T09:56:00+01:00`, amount_minor: -36000, payee: "ZWOLAK SERWIS", pending: 1, source: "shortcut-guess" });
    const c = candidateFromTransaction(db, tx.id, TODAY)!;
    const next = nextOccurrenceAfter(c.last_date!, "monthly", 6, TODAY);
    const rule = createRecurring(db, { account_id: acc.id, amount_minor: -36000, category_id: car.id, payee: "ZWOLAK SERWIS", frequency: "monthly", interval: 6, start_date: next, next_date: next, auto_post: 0, match_payee: c.match_payee });
    return { db, acc, car, tx, rule };
  }

  test("the payment joins the rule, takes its category and leaves the pending queue", () => {
    const { db, car, tx, rule } = scenario();
    expect(linkToRule(db, tx.id, rule)).not.toBeNull();
    expect(getRow(db, "transactions", tx.id)).toMatchObject({ recurring_id: rule.id, category_id: car.id, pending: 0 });
  });

  test("nothing waits or asks today, with waiting on or off", () => {
    const { db, tx, rule } = scenario();
    linkToRule(db, tx.id, rule);
    for (const wait of [0, 30]) {
      expect(waitingRules(db, TODAY, wait)).toEqual([]);
      expect(dueManualRules(db, TODAY, wait)).toEqual([]);
    }
    // Inside its window six months on, the rule does wait.
    expect(waitingRules(db, "2027-04-28", 30).map((r) => r.days)).toEqual([["2027-04-28"]]);
  });

  test("the payment is no longer offered as a suggestion", () => {
    const { db, tx, rule } = scenario();
    linkToRule(db, tx.id, rule);
    expect(detectRecurring(db, { today: TODAY, skipExisting: false }).length).toBe(0);
  });

  test("a category the payment already has is kept; a trip tag is dropped", () => {
    const db = fresh();
    const acc = createAccount(db, { name: "A", currency: "PLN" });
    const own = createCategory(db, { name: "Mine" });
    const ruleCat = createCategory(db, { name: "Rule's" });
    const { tag } = startTrip(db, { name: "Rome", currency: "PLN", amount_minor: 0, starts: "2026-10-20", ends: "2026-10-30" });
    const tx = createTransaction(db, { account_id: acc.id, date: `${TODAY}T10:00:00+01:00`, amount_minor: -1000, payee: "X", category_id: own.id, tag_ids: JSON.stringify([tag.id]) });
    const rule = createRecurring(db, { account_id: acc.id, amount_minor: -1000, category_id: ruleCat.id, frequency: "monthly", start_date: "2026-11-28", tag_ids: JSON.stringify(["t-rule"]) });
    linkToRule(db, tx.id, rule);
    expect(getRow(db, "transactions", tx.id)).toMatchObject({ recurring_id: rule.id, category_id: own.id, tag_ids: JSON.stringify(["t-rule"]) });
  });

  test("a row that is another rule's, deleted, or a transfer leg is left alone", () => {
    const { db, acc, tx, rule } = scenario();
    const other = createRecurring(db, { account_id: acc.id, amount_minor: -1, frequency: "monthly", start_date: "2026-11-01" });
    linkToRule(db, tx.id, other);
    expect(linkToRule(db, tx.id, rule)).toBeNull();
    expect(getRow(db, "transactions", tx.id)?.recurring_id).toBe(other.id);
    const leg = createTransaction(db, { account_id: acc.id, date: `${TODAY}T10:00:00+01:00`, amount_minor: -1, transfer_id: "tr" });
    expect(linkToRule(db, leg.id, rule)).toBeNull();
    expect(linkToRule(db, "missing", rule)).toBeNull();
  });
});
