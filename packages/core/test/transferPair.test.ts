import { describe, expect, test } from "bun:test";
import { openBunDb } from "../src/drivers/bun";
import { migrate } from "../src/schema";
import { createAccount, createTransaction, getRow, listRows } from "../src/repo";
import {
  accountForNumber, approvePending, last4, learnAccountNumber, pairTransferLeg, pairTransferLegs, readBankRef, refsPair,
  SYNTH_SOURCE, updateTransfer, writeBankRef,
} from "../src/transferPair";

/** The user's own two PKO accounts: USD ••3203 and PLN ••5837. */
function seed() {
  const db = openBunDb(); migrate(db);
  const usd = createAccount(db, { name: "PKO USD", currency: "USD" });
  const pln = createAccount(db, { name: "PKO PLN", currency: "PLN" });
  return { db, usd, pln };
}

/** A row the notification automation wrote: pending, with the numbers the bank printed. */
function leg(db: ReturnType<typeof openBunDb>, account_id: string, amount_minor: number, ref: { own?: string; other?: string; balance?: number }, date = "2026-10-05T10:00:00+02:00", payee = "OLEKSANDR K") {
  return createTransaction(db, { account_id, date, amount_minor, payee, pending: 1, source: "shortcut", bank_ref: writeBankRef(ref), notes: "PRZELEW IKO NA NUMER RACHUNKU", tag_ids: '["trip"]', category_id: null });
}

describe("bank refs", () => {
  test("last four digits of whatever the bank masks with", () => {
    expect(last4("27..5837")).toBe("5837");
    expect(last4("••5837")).toBe("5837");
    expect(last4("12")).toBeNull();
    expect(readBankRef(writeBankRef({ own: "84..3203", other: "27..5837", balance: 300000 }))).toEqual({ own: "3203", other: "5837", balance: 300000 });
    expect(writeBankRef({})).toBeNull();
    expect(readBankRef("not json")).toBeNull();
  });

  test("two notifications pair only when every number both print agrees", () => {
    expect(refsPair({ own: "3203", other: "5837" }, { own: "5837", other: "3203" })).toBe(true);
    // One side printed no counterparty: still one agreeing number.
    expect(refsPair({ own: "3203", other: "5837" }, { own: "5837" })).toBe(true);
    // A disagreement anywhere vetoes it.
    expect(refsPair({ own: "3203", other: "5837" }, { own: "5837", other: "9999" })).toBe(false);
    // Nothing to compare is not evidence.
    expect(refsPair({ own: "3203" }, { own: "5837" })).toBe(false);
    expect(refsPair({ other: "5837" }, { other: "3203" })).toBe(false);
  });
});

describe("pairing the two notifications of one transfer", () => {
  test("debit first, credit later, across currencies: one pending transfer, both ids kept", () => {
    const { db, usd, pln } = seed();
    const out = leg(db, usd.id, -50000, { own: "3203", other: "5837", balance: 300000 });
    expect(pairTransferLeg(db, out.id)).toBeNull(); // nothing to pair with yet, and no number known
    const inn = leg(db, pln.id, 188275, { own: "5837", other: "3203", balance: 206391 }, "2026-10-05T10:03:00+02:00");
    const r = pairTransferLeg(db, inn.id);
    expect(r?.kind).toBe("paired");
    const a = getRow(db, "transactions", out.id)!, b = getRow(db, "transactions", inn.id)!;
    expect(a.transfer_id).toBe(b.transfer_id);
    expect(a.transfer_id).not.toBeNull();
    expect([a.pending, b.pending]).toEqual([1, 1]);
    expect(a.amount_minor).toBe(-50000);
    expect(b.amount_minor).toBe(188275);
    // Cross-currency columns: each leg shows the other's figure, and the rate between them.
    expect(a.entered_amount_minor).toBe(188275);
    expect(a.entered_currency).toBe("PLN");
    expect(a.exchange_rate).toBeCloseTo(3.7655, 4);
    expect(b.entered_currency).toBe("USD");
    expect(b.exchange_rate).toBeCloseTo(1 / 3.7655, 6);
    // A transfer is not spending: no category, no tags (the trip tag the automation added goes too).
    expect(a.tag_ids).toBe("[]");
    expect(a.category_id).toBeNull();
    expect(a.payee).toBe("OLEKSANDR K");
    expect(listRows(db, "transactions", "deleted=0")).toHaveLength(2);
  });

  test("credit first, debit later pairs the same way", () => {
    const { db, usd, pln } = seed();
    const inn = leg(db, pln.id, 188275, { own: "5837", other: "3203" });
    expect(pairTransferLeg(db, inn.id)).toBeNull();
    const out = leg(db, usd.id, -50000, { own: "3203", other: "5837" }, "2026-10-05T10:01:00+02:00");
    expect(pairTransferLeg(db, out.id)?.kind).toBe("paired");
    expect(getRow(db, "transactions", inn.id)!.transfer_id).toBe(getRow(db, "transactions", out.id)!.transfer_id);
  });

  test("the sweep pairs legs written while the app was closed, and writes nothing twice", () => {
    const { db, usd, pln } = seed();
    leg(db, usd.id, -50000, { own: "3203", other: "5837" });
    leg(db, pln.id, 188275, { own: "5837", other: "3203" }, "2026-10-05T10:02:00+02:00");
    const now = new Date("2026-10-05T12:00:00+02:00");
    expect(pairTransferLegs(db, now)).toBe(1);
    expect(pairTransferLegs(db, now)).toBe(0);
    expect(new Set(listRows(db, "transactions", "deleted=0").map((r) => r.transfer_id)).size).toBe(1);
  });

  test("same currency, same amount", () => {
    const db = openBunDb(); migrate(db);
    const a = createAccount(db, { name: "A", currency: "PLN" }), b = createAccount(db, { name: "B", currency: "PLN" });
    const out = leg(db, a.id, -10000, { own: "1111", other: "2222" });
    const inn = leg(db, b.id, 10000, { own: "2222", other: "1111" });
    expect(pairTransferLeg(db, inn.id)?.kind).toBe("paired");
    const x = getRow(db, "transactions", out.id)!;
    expect(x.entered_amount_minor).toBeNull();
    expect(x.exchange_rate).toBeNull();
  });

  test("a third party paying you stays income", () => {
    const { db, usd, pln } = seed();
    leg(db, usd.id, -50000, { own: "3203", other: "5837" });
    const salary = leg(db, pln.id, 900000, { own: "5837", other: "7777" }, "2026-10-05T10:02:00+02:00", "EMPLOYER SP Z O O");
    expect(pairTransferLeg(db, salary.id)).toBeNull();
    expect(getRow(db, "transactions", salary.id)!.transfer_id).toBeNull();
  });

  test("legs hours apart are two things that happened", () => {
    const { db, usd, pln } = seed();
    leg(db, usd.id, -50000, { own: "3203", other: "5837" }, "2026-10-05T08:00:00+02:00");
    const inn = leg(db, pln.id, 188275, { own: "5837", other: "3203" }, "2026-10-05T13:00:00+02:00");
    expect(pairTransferLeg(db, inn.id)).toBeNull();
  });

  test("same direction never pairs, nor two rows on one account", () => {
    const { db, usd, pln } = seed();
    leg(db, usd.id, -50000, { own: "3203", other: "5837" });
    const alsoOut = leg(db, pln.id, -1000, { own: "5837", other: "3203" });
    expect(pairTransferLeg(db, alsoOut.id)).toBeNull();
    const same = leg(db, usd.id, 50000, { own: "5837", other: "3203" });
    expect(pairTransferLeg(db, same.id)).toBeNull();
  });

  test("two transfers close together pair each with its own (equal amount first)", () => {
    const db = openBunDb(); migrate(db);
    const a = createAccount(db, { name: "A", currency: "PLN" }), b = createAccount(db, { name: "B", currency: "PLN" });
    const o1 = leg(db, a.id, -10000, { own: "1111", other: "2222" }, "2026-10-05T10:00:00+02:00");
    const o2 = leg(db, a.id, -25000, { own: "1111", other: "2222" }, "2026-10-05T10:01:00+02:00");
    const i2 = leg(db, b.id, 25000, { own: "2222", other: "1111" }, "2026-10-05T10:02:00+02:00");
    const i1 = leg(db, b.id, 10000, { own: "2222", other: "1111" }, "2026-10-05T10:03:00+02:00");
    pairTransferLeg(db, i2.id);
    pairTransferLeg(db, i1.id);
    expect(getRow(db, "transactions", o2.id)!.transfer_id).toBe(getRow(db, "transactions", i2.id)!.transfer_id);
    expect(getRow(db, "transactions", o1.id)!.transfer_id).toBe(getRow(db, "transactions", i1.id)!.transfer_id);
  });

  test("an approved leg is still found, and the pair goes back to pending for a look", () => {
    const { db, usd, pln } = seed();
    const out = leg(db, usd.id, -50000, { own: "3203", other: "5837" });
    approvePending(db, [out.id]);
    expect(getRow(db, "transactions", out.id)!.pending).toBe(0);
    const inn = leg(db, pln.id, 188275, { own: "5837", other: "3203" });
    expect(pairTransferLeg(db, inn.id)?.kind).toBe("paired");
    expect(getRow(db, "transactions", out.id)!.pending).toBe(1);
    // An approved row is never what starts a pairing, only what is found by one.
    expect(pairTransferLeg(db, out.id)).toBeNull();
  });

  test("a row without numbers, a deleted row and a hand-entered row are left alone", () => {
    const { db, usd, pln } = seed();
    const plain = createTransaction(db, { account_id: usd.id, date: "2026-10-05T10:00:00+02:00", amount_minor: -500, pending: 1 });
    expect(pairTransferLeg(db, plain.id)).toBeNull();
    expect(pairTransferLeg(db, "nope")).toBeNull();
    const zero = leg(db, pln.id, 0, { own: "5837", other: "3203" });
    expect(pairTransferLeg(db, zero.id)).toBeNull();
  });
});

describe("one leg only", () => {
  test("the other side becomes a transfer when its number is one of yours, written by the app", () => {
    const db = openBunDb(); migrate(db);
    const a = createAccount(db, { name: "A", currency: "PLN", numbers: '["1111"]' }), b = createAccount(db, { name: "B", currency: "PLN", numbers: '["2222"]' });
    const out = leg(db, a.id, -10000, { own: "1111", other: "2222" });
    const r = pairTransferLeg(db, out.id);
    expect(r?.kind).toBe("inferred");
    const legs = listRows(db, "transactions", "deleted=0 AND transfer_id=?", [getRow(db, "transactions", out.id)!.transfer_id!]);
    expect(legs).toHaveLength(2);
    const synth = legs.find((l) => l.id !== out.id)!;
    expect(synth.account_id).toBe(b.id);
    expect(synth.amount_minor).toBe(10000);
    expect(synth.source).toBe(SYNTH_SOURCE);
    expect(synth.pending).toBe(1);
  });

  test("across currencies without a known rate the inferred side is 0, never invented", () => {
    const { db, usd, pln } = seed();
    learnAccountNumber(db, pln.id, "5837");
    const out = leg(db, usd.id, -50000, { own: "3203", other: "5837" });
    expect(pairTransferLeg(db, out.id)?.kind).toBe("inferred");
    const synth = listRows(db, "transactions", "deleted=0 AND source=?", [SYNTH_SOURCE])[0]!;
    expect(synth.amount_minor).toBe(0);
    expect(getRow(db, "transactions", out.id)!.exchange_rate).toBeNull();
  });

  test("with a cached rate it is converted", () => {
    const { db, usd, pln } = seed();
    learnAccountNumber(db, pln.id, "5837");
    db.run(`INSERT INTO exchange_rates(base, quote, day, rate, fetched_at) VALUES ('USD','PLN','2026-10-05',3.7,0)`);
    const out = leg(db, usd.id, -50000, { own: "3203", other: "5837" });
    pairTransferLeg(db, out.id);
    expect(listRows(db, "transactions", "deleted=0 AND source=?", [SYNTH_SOURCE])[0]!.amount_minor).toBe(185000);
  });

  test("the real other leg arriving later replaces the inferred one", () => {
    const { db, usd, pln } = seed();
    learnAccountNumber(db, pln.id, "5837");
    const out = leg(db, usd.id, -50000, { own: "3203", other: "5837" });
    pairTransferLeg(db, out.id);
    const tid = getRow(db, "transactions", out.id)!.transfer_id!;
    const inn = leg(db, pln.id, 188275, { own: "5837", other: "3203" }, "2026-10-05T10:04:00+02:00");
    expect(pairTransferLeg(db, inn.id)?.kind).toBe("replaced");
    const legs = listRows(db, "transactions", "deleted=0 AND transfer_id=?", [tid]);
    expect(legs.map((l) => l.id).sort()).toEqual([out.id, inn.id].sort());
    expect(listRows(db, "transactions", "deleted=1 AND source=?", [SYNTH_SOURCE])).toHaveLength(1);
  });

  test("a number two accounts claim names neither", () => {
    const db = openBunDb(); migrate(db);
    createAccount(db, { name: "A", currency: "PLN", numbers: '["1111"]' });
    createAccount(db, { name: "B", currency: "PLN", numbers: '["1111"]' });
    expect(accountForNumber(db, "1111")).toBeNull();
  });
});

describe("the same notification twice", () => {
  test("a repeat with the same closing balance is dropped once its pair is a transfer", () => {
    const { db, usd, pln } = seed();
    const out = leg(db, usd.id, -50000, { own: "3203", other: "5837", balance: 300000 });
    const inn = leg(db, pln.id, 188275, { own: "5837", other: "3203", balance: 206391 });
    pairTransferLeg(db, inn.id);
    const again = leg(db, usd.id, -50000, { own: "3203", other: "5837", balance: 300000 }, "2026-10-05T10:05:00+02:00");
    expect(pairTransferLeg(db, again.id)?.kind).toBe("duplicate");
    expect(getRow(db, "transactions", again.id)!.deleted).toBe(1);
    expect(getRow(db, "transactions", out.id)!.deleted).toBe(0);
  });

  test("an identical second transfer (another balance) is kept", () => {
    const { db, usd, pln } = seed();
    leg(db, usd.id, -50000, { own: "3203", other: "5837", balance: 300000 });
    const inn = leg(db, pln.id, 188275, { own: "5837", other: "3203", balance: 206391 });
    pairTransferLeg(db, inn.id);
    const second = leg(db, usd.id, -50000, { own: "3203", other: "5837", balance: 250000 }, "2026-10-05T10:05:00+02:00");
    expect(pairTransferLeg(db, second.id)).toBeNull();
    expect(getRow(db, "transactions", second.id)!.deleted).toBe(0);
  });
});

describe("approving teaches the accounts their numbers", () => {
  test("both legs of a transfer approve together, and each account learns its digits", () => {
    const { db, usd, pln } = seed();
    const out = leg(db, usd.id, -50000, { own: "3203", other: "5837" });
    const inn = leg(db, pln.id, 188275, { own: "5837", other: "3203" });
    pairTransferLeg(db, inn.id);
    expect(approvePending(db, [out.id])).toBe(2);
    expect(getRow(db, "transactions", inn.id)!.pending).toBe(0);
    expect(accountForNumber(db, "3203")?.id).toBe(usd.id);
    expect(accountForNumber(db, "5837")?.id).toBe(pln.id);
  });

  test("a number already claimed by another account is not taken, and nothing unchanged is written", () => {
    const { db, usd, pln } = seed();
    expect(learnAccountNumber(db, usd.id, "3203")).toBe(true);
    const stamp = getRow(db, "accounts", usd.id)!.updated_at;
    expect(learnAccountNumber(db, usd.id, "3203")).toBe(false);
    expect(getRow(db, "accounts", usd.id)!.updated_at).toBe(stamp);
    expect(learnAccountNumber(db, pln.id, "3203")).toBe(false);
  });
});

describe("editing a transfer in place", () => {
  test("keeps both ids, payees and numbers, and saving approves", () => {
    const { db, usd, pln } = seed();
    const out = leg(db, usd.id, -50000, { own: "3203", other: "5837" });
    const inn = leg(db, pln.id, 188275, { own: "5837", other: "3203" });
    const tid = (pairTransferLeg(db, inn.id) as { transfer_id: string }).transfer_id;
    const r = updateTransfer(db, tid, { from_account_id: usd.id, to_account_id: pln.id, date: out.date, from_amount_minor: 50000, to_amount_minor: 190000, from_currency: "USD", to_currency: "PLN", notes: "savings" })!;
    expect(r.out.id).toBe(out.id);
    expect(r.in.id).toBe(inn.id);
    expect(r.in.amount_minor).toBe(190000);
    expect(r.out.entered_amount_minor).toBe(190000);
    expect(r.out.pending).toBe(0);
    expect(r.out.bank_ref).toBe(out.bank_ref);
    expect(r.in.payee).toBe("OLEKSANDR K");
    expect(accountForNumber(db, "5837")?.id).toBe(pln.id);
  });

  test("refuses the same account on both sides", () => {
    const { db, usd, pln } = seed();
    leg(db, usd.id, -50000, { own: "3203", other: "5837" });
    const inn = leg(db, pln.id, 188275, { own: "5837", other: "3203" });
    const tid = (pairTransferLeg(db, inn.id) as { transfer_id: string }).transfer_id;
    expect(updateTransfer(db, tid, { from_account_id: usd.id, to_account_id: usd.id, date: inn.date, from_amount_minor: 1, to_amount_minor: 1, from_currency: "USD", to_currency: "USD" })).toBeNull();
  });
});
