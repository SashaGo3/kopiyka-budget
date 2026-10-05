import type { SqlDriver } from "./db";
import { newId } from "./ids";
import type { Account, Transaction } from "./models";
import { getRow, jsonIds, listRows, remove, save } from "./repo";
import { cachedRate, latestCachedRate } from "./rates";

/**
 * One transfer between two of your own accounts, told by the bank as two notifications: the debit
 * on the account the money left ("Obciążenie konta −500,00 USD … Konto odbiorcy: 27..5837 … Na
 * koncie: 84..3203") and the credit on the one it reached ("Uznanie konta +1882,75 PLN … Konto
 * nadawcy: 84..3203 … Na koncie: 27..5837"). Each arrives on its own, minutes apart, in either order,
 * and the automation logs each as a pending expense or income. This is where they become what they
 * are: one pending transfer, both legs kept (DATA.md rules 1 and 18).
 *
 * The evidence is the account numbers, never the amounts or the names: a debit whose *other* account
 * is the credit's *own* and the other way round. Names lie (a third party can share yours), amounts
 * differ across currencies, and two transfers between the same pair of accounts can be minutes apart.
 * So:
 *
 * - Two legs pair only when every account number both of them print agrees and at least one does.
 * - Only opposite directions, different accounts, and within `PAIR_WINDOW_MINUTES` of each other.
 * - Of several candidates, an equal same-currency amount wins, then the nearest in time.
 * - A leg whose other side never arrives becomes a transfer only when that other account number is
 *   one of yours (`accounts.numbers`); the other leg is then written by the app (`SYNTH_SOURCE`), and
 *   replaced by the real one if it turns up after all.
 * - A third party paying you prints an account number that is not yours: it stays income.
 *
 * Everything lands pending — the pairing is a reading of two notifications, not a decision — and the
 * Pending queue shows the pair as one transfer to approve. Approving it (`approvePending`) is also
 * what teaches each account its number.
 */

/** Two notifications further apart than this are two things that happened. */
export const PAIR_WINDOW_MINUTES = 180;
/** How far back a sweep looks for legs still waiting for their other half. */
export const SWEEP_DAYS = 14;
/** The leg the app wrote itself, because only the other one was ever notified. */
export const SYNTH_SOURCE = "shortcut-transfer";

/**
 * `own` / `other`: last four digits of the account the notification is about and of the one on the
 * other end. `balance`: what the bank said the account held afterwards, in its own minor units — the
 * one thing that tells the same notification delivered twice from a second, identical transfer.
 */
export interface BankRef { own?: string; other?: string; balance?: number }

/** The last four digits of whatever a bank masks an account with ("27..5837", "••5837", "*5837"). */
export function last4(raw: string | null | undefined): string | null {
  const d = (raw ?? "").replace(/\D/g, "");
  return d.length >= 4 ? d.slice(-4) : null;
}

export function readBankRef(raw: string | null | undefined): BankRef | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    const own = typeof v.own === "string" ? last4(v.own) : null;
    const other = typeof v.other === "string" ? last4(v.other) : null;
    const balance = typeof v.balance === "number" && Number.isFinite(v.balance) ? v.balance : null;
    return own || other ? { ...(own ? { own } : {}), ...(other ? { other } : {}), ...(balance !== null ? { balance } : {}) } : null;
  } catch { return null; }
}

export function writeBankRef(ref: { own?: string | null; other?: string | null; balance?: number | null }): string | null {
  const own = last4(ref.own), other = last4(ref.other);
  if (!own && !other) return null;
  const balance = typeof ref.balance === "number" && Number.isFinite(ref.balance) ? ref.balance : null;
  return JSON.stringify({ ...(own ? { own } : {}), ...(other ? { other } : {}), ...(balance !== null ? { balance } : {}) });
}

/** The digits an account is known by. */
export function accountNumbers(a: Pick<Account, "numbers"> | { numbers?: string | null }): string[] {
  return jsonIds(a.numbers ?? "[]").map(last4).filter((x): x is string => !!x);
}

/**
 * The one live account known by these digits, or null — none, or more than one (two accounts both
 * claiming "5837" is a contradiction nobody can settle from here).
 */
export function accountForNumber(db: SqlDriver, digits: string | null | undefined): Account | null {
  const d = last4(digits);
  if (!d) return null;
  const hits = listRows(db, "accounts", "deleted=0 AND archived=0 AND numbers LIKE ?", [`%"${d}"%`]).filter((a) => accountNumbers(a).includes(d));
  return hits.length === 1 ? hits[0]! : null;
}

/**
 * Whether two notifications describe the two ends of one movement. Every number both print must
 * agree (one side's `other` is the other's `own`), and at least one must actually be printed — a pair
 * with nothing to compare is not evidence.
 */
export function refsPair(a: BankRef, b: BankRef): boolean {
  const ab = a.other && b.own ? a.other === b.own : null;
  const ba = a.own && b.other ? a.own === b.other : null;
  if (ab === false || ba === false) return false;
  // Both ends on one account is not a transfer between two.
  if (a.own && b.own && a.own === b.own) return false;
  return ab === true || ba === true;
}

const ms = (iso: string) => Date.parse(iso);
const minutesApart = (a: string, b: string) => Math.abs(ms(a) - ms(b)) / 60_000;

function currencyOf(db: SqlDriver, accountId: string): string | null {
  return db.get<{ currency: string }>(`SELECT currency FROM accounts WHERE id=?`, [accountId])?.currency ?? null;
}

/**
 * Write two existing rows as the legs of one transfer, in place: both keep their ids, payees, notes,
 * places and photos (rule 1), and take what a transfer needs — a shared `transfer_id`, no category,
 * the other leg's amount as the cross-currency original — and go back to pending. Tags are cleared:
 * a transfer moves your own money, and the trip tag or a shop's tags the automation gave each leg
 * belong to spending.
 */
function join(db: SqlDriver, out: Transaction, inn: Transaction, transfer_id = newId()): string {
  const fromCur = currencyOf(db, out.account_id) ?? "";
  const toCur = currencyOf(db, inn.account_id) ?? "";
  const from = Math.abs(out.amount_minor), to = Math.abs(inn.amount_minor);
  const cross = fromCur !== toCur;
  // Destination units per one source unit, as createTransfer writes it — unknown while either side is 0.
  const rate = cross && from > 0 && to > 0 ? to / from : null;
  const shared = { transfer_id, category_id: null, tag_ids: "[]", pending: 1 as const, refunded_minor: 0 };
  save(db, "transactions", { ...out, ...shared, amount_minor: -from,
    entered_amount_minor: cross && to > 0 ? to : null, entered_currency: cross && to > 0 ? toCur : null, exchange_rate: rate });
  save(db, "transactions", { ...inn, ...shared, amount_minor: to,
    entered_amount_minor: cross && from > 0 ? from : null, entered_currency: cross && from > 0 ? fromCur : null, exchange_rate: rate ? 1 / rate : null });
  return transfer_id;
}

/** The other leg of a transfer. */
function partnerOf(db: SqlDriver, leg: Transaction): Transaction | null {
  if (!leg.transfer_id) return null;
  return listRows(db, "transactions", "deleted=0 AND transfer_id=? AND id<>?", [leg.transfer_id, leg.id])[0] ?? null;
}

export type PairOutcome =
  | { kind: "paired"; transfer_id: string }
  | { kind: "replaced"; transfer_id: string }
  | { kind: "inferred"; transfer_id: string }
  | { kind: "duplicate" }
  | null;

/**
 * Pair one pending, notification-written row with the other half of its transfer, if there is one.
 * Safe to run any number of times: a row that is already a transfer, approved, deleted or carries no
 * account numbers is left alone, and nothing is written unless something pairs.
 */
export function pairTransferLeg(db: SqlDriver, id: string): PairOutcome {
  const row = getRow(db, "transactions", id);
  // A charge a recurring rule claimed is that rule's payment (rule 13), not half of a transfer.
  if (!row || row.deleted || row.transfer_id || row.recurring_id || row.pending !== 1 || row.amount_minor === 0) return null;
  const ref = readBankRef(row.bank_ref);
  if (!ref) return null;
  const outgoing = row.amount_minor < 0;
  const rowCur = currencyOf(db, row.account_id);

  // Rows on another account, the other way round, with numbers that agree, close enough in time.
  const near = listRows(db, "transactions", `deleted=0 AND bank_ref IS NOT NULL AND id<>? AND account_id<>? AND ${outgoing ? "amount_minor>0" : "amount_minor<0"}`, [row.id, row.account_id])
    .filter((c) => {
      const r = readBankRef(c.bank_ref);
      return !!r && !c.recurring_id && refsPair(ref, r) && minutesApart(c.date, row.date) <= PAIR_WINDOW_MINUTES;
    });

  // The very same notification again, after the automation's one-minute twin check: same account,
  // amount, numbers *and* closing balance as a leg already in a transfer. Writing it would count the
  // money twice. Without a balance there is no telling it from a second, identical transfer, and that
  // one is real money — so it is left alone.
  const dup = ref.balance === undefined ? undefined : listRows(db, "transactions", "deleted=0 AND id<>? AND account_id=? AND amount_minor=? AND transfer_id IS NOT NULL AND bank_ref IS NOT NULL", [row.id, row.account_id, row.amount_minor])
    .find((c) => {
      const r = readBankRef(c.bank_ref);
      return !!r && r.balance === ref.balance && r.own === ref.own && r.other === ref.other && minutesApart(c.date, row.date) <= PAIR_WINDOW_MINUTES;
    });
  if (dup) { remove(db, "transactions", row.id); return { kind: "duplicate" }; }

  // A candidate is free when it is not a transfer yet, or when its other leg is one the app wrote
  // (and this row is the real thing arriving late).
  const free = near.map((c) => ({ c, partner: partnerOf(db, c) }))
    .filter(({ c, partner }) => !c.transfer_id || (partner?.source === SYNTH_SOURCE && partner.account_id === row.account_id));
  const score = (c: Transaction) => {
    const sameAmount = rowCur !== null && currencyOf(db, c.account_id) === rowCur && Math.abs(c.amount_minor) === Math.abs(row.amount_minor);
    return [sameAmount ? 0 : 1, minutesApart(c.date, row.date)] as const;
  };
  free.sort((a, b) => { const x = score(a.c), y = score(b.c); return x[0] - y[0] || x[1] - y[1]; });
  const best = free[0];
  if (best) {
    const { c, partner } = best;
    if (partner) {
      // The leg the app inferred gives way to the one the bank actually reported.
      remove(db, "transactions", partner.id);
      const tid = join(db, outgoing ? row : c, outgoing ? c : row, c.transfer_id!);
      return { kind: "replaced", transfer_id: tid };
    }
    return { kind: "paired", transfer_id: join(db, outgoing ? row : c, outgoing ? c : row) };
  }

  // A matching leg exists but is already another transfer's half: inferring a second other side for
  // this one could put the same money on that account twice. Left as it is, for a person to look at.
  if (near.length) return null;
  // Nothing to pair with: a transfer still, if the other account is one of yours.
  const other = accountForNumber(db, ref.other);
  if (!other || other.id === row.account_id) return null;
  const day = row.date.slice(0, 10);
  const rate = rowCur === other.currency ? 1 : (rowCur ? cachedRate(db, rowCur, other.currency, day) ?? latestCachedRate(db, rowCur, other.currency)?.rate ?? null : null);
  // Without a rate the other side's amount would be invented, so it is 0 and says so (rule 6): the
  // transfer sheet will not save until it is typed.
  const amount = rate ? Math.round(Math.abs(row.amount_minor) * rate) : 0;
  const synth: Transaction = {
    ...row, id: newId(), account_id: other.id, amount_minor: outgoing ? amount : -amount, source: SYNTH_SOURCE,
    bank_ref: writeBankRef({ own: ref.other, other: ref.own }), photo: null, lat: null, lon: null, place: null,
    entered_amount_minor: null, entered_currency: null, exchange_rate: null,
  };
  save(db, "transactions", synth);
  const tid = join(db, outgoing ? row : synth, outgoing ? synth : row);
  return { kind: "inferred", transfer_id: tid };
}

/**
 * Pair whatever is waiting: every pending, notification-written row of the last `SWEEP_DAYS` that is
 * not a transfer yet. Run when the app comes up — the automation may have written both legs straight
 * into the database while the app was closed. Returns how many legs changed (0: nothing was written).
 */
export function pairTransferLegs(db: SqlDriver, now = new Date()): number {
  const since = new Date(now.getTime() - SWEEP_DAYS * 86_400_000).toISOString().slice(0, 10);
  const waiting = db.all<{ id: string }>(
    `SELECT id FROM transactions WHERE deleted=0 AND pending=1 AND transfer_id IS NULL AND bank_ref IS NOT NULL AND date>=? ORDER BY date, rowid`, [since]);
  let n = 0;
  for (const { id } of waiting) if (pairTransferLeg(db, id)) n++;
  return n;
}

/**
 * Give an account a number it is printed with, unless another live account already claims it. Writes
 * only when something changes (an untouched account with a fresh `updated_at` would win a merge it
 * should lose — DATA.md rule 15's lesson).
 */
export function learnAccountNumber(db: SqlDriver, accountId: string, digits: string | null | undefined): boolean {
  const d = last4(digits);
  const acc = getRow(db, "accounts", accountId);
  if (!d || !acc || acc.deleted) return false;
  const known = accountNumbers(acc);
  if (known.includes(d)) return false;
  const claimed = listRows(db, "accounts", "deleted=0 AND id<>? AND numbers LIKE ?", [accountId, `%"${d}"%`]).some((a) => accountNumbers(a).includes(d));
  if (claimed) return false;
  save(db, "accounts", { ...acc, numbers: JSON.stringify([...known, d]) });
  return true;
}

/**
 * What approving a notification-written row teaches: the account it is on is the one the bank printed
 * as "own"; for a transfer, the other leg's account is the one this leg printed as "other".
 */
export function learnFromRow(db: SqlDriver, row: Transaction): void {
  const ref = readBankRef(row.bank_ref);
  if (!ref) return;
  learnAccountNumber(db, row.account_id, ref.own);
  const partner = partnerOf(db, row);
  if (partner && ref.other) learnAccountNumber(db, partner.account_id, ref.other);
}

/**
 * Approve pending rows — and, for a transfer, both of its legs at once: half a transfer approved is
 * one balance moved and the other not. Each approval teaches the accounts their numbers.
 */
export function approvePending(db: SqlDriver, ids: string[]): number {
  const seen = new Set<string>();
  let n = 0;
  for (const id of ids) {
    const tx = getRow(db, "transactions", id);
    if (!tx || tx.deleted) continue;
    const legs = tx.transfer_id ? listRows(db, "transactions", "deleted=0 AND transfer_id=?", [tx.transfer_id]) : [tx];
    for (const leg of legs) {
      if (seen.has(leg.id)) continue;
      seen.add(leg.id);
      if (leg.pending) { save(db, "transactions", { ...leg, pending: 0 }); n++; }
    }
    for (const leg of legs) learnFromRow(db, { ...leg, pending: 0 });
  }
  return n;
}

/**
 * Rewrite a transfer's two legs in place — accounts, amounts, date, note, category, tags — keeping
 * both ids and everything else each leg carries (payee, place, photo, bank numbers). The transfer
 * sheet saves through this, so editing an auto-detected transfer neither detaches its history nor
 * forgets which notifications it came from. Saving approves it, unless `pending` says otherwise.
 */
export function updateTransfer(db: SqlDriver, transfer_id: string, p: {
  from_account_id: string; to_account_id: string; date: string;
  from_amount_minor: number; to_amount_minor: number; from_currency: string; to_currency: string;
  category_id?: string | null; tag_ids?: string; notes?: string | null; pending?: 0 | 1;
}): { out: Transaction; in: Transaction } | null {
  const legs = listRows(db, "transactions", "deleted=0 AND transfer_id=?", [transfer_id]);
  const outLeg = legs.find((l) => l.amount_minor < 0) ?? legs.find((l) => l.account_id === p.from_account_id);
  const inLeg = legs.find((l) => l !== outLeg);
  if (!outLeg || !inLeg || p.from_account_id === p.to_account_id) return null;
  const cross = p.from_currency !== p.to_currency;
  const rate = cross && p.from_amount_minor > 0 ? p.to_amount_minor / p.from_amount_minor : null;
  const shared = { date: p.date, category_id: p.category_id ?? null, tag_ids: p.tag_ids ?? "[]", notes: p.notes ?? null, pending: p.pending ?? 0 };
  return db.transaction(() => {
    const out = save(db, "transactions", { ...outLeg, ...shared, account_id: p.from_account_id, amount_minor: -p.from_amount_minor,
      entered_amount_minor: cross ? p.to_amount_minor : null, entered_currency: cross ? p.to_currency : null, exchange_rate: rate });
    const inn = save(db, "transactions", { ...inLeg, ...shared, account_id: p.to_account_id, amount_minor: p.to_amount_minor,
      entered_amount_minor: cross ? p.from_amount_minor : null, entered_currency: cross ? p.from_currency : null, exchange_rate: rate ? 1 / rate : null });
    if (!out.pending) { learnFromRow(db, out); learnFromRow(db, inn); }
    return { out, in: inn };
  });
}
