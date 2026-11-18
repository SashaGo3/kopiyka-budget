/**
 * A photographed receipt becoming an entry, as decisions with no screen attached: what the receipt
 * fills in and what it leaves alone (`receiptFill`), how its sorted items become a split
 * (`receiptPlan`), and what is saved once Continue is pressed (`receiptSave`). The entry sheet and
 * the receipt sheet only call these and apply the answers, so every rule here is tested
 * (test/receiptEntry.test.ts) instead of living inside a component nobody can run in a test.
 *
 * Money in: a receipt's prices and total are major units in the receipt's currency; an entry's
 * amounts are minor units of the entry's (the account's) currency. A receipt in another currency is
 * converted at `rate`; with no rate its own number is kept and `unconverted` says so, because it
 * must be looked at before it is saved (DATA.md rule 6 — a foreign number must never pass as the
 * account's currency).
 */
import { appendBlock, receiptPlace, type ReceiptLike } from "./receipt";
import { receiptSplit } from "./split";
import { toMinor } from "./money";

export interface ReceiptRead extends ReceiptLike {
  date?: string | null;
  category_id?: string | null;
}

/** The entry as it stands when the receipt arrives. */
export interface EntryNow {
  /** The magnitude typed, in minor units of `currency`; null when nothing is typed. */
  amount_minor: number | null;
  expense: boolean;
  currency: string;
  category_id: string | null;
  /** The category was only suggested (by the location), not chosen. */
  suggested: boolean;
  debt_id: string | null;
  payee: string | null;
  place: string | null;
  /** The place is the one the phone's location filled in, not one picked by hand. */
  placeFromPhone: boolean;
  note: string;
  /** YYYY-MM-DD. */
  day: string;
}

/** What filling in from the receipt sets. A field left out stays as it is. */
export interface ReceiptFill {
  /** Major units of the entry's currency, rounded to the cent. */
  amount: number;
  /** No rate was known: `amount` is the receipt's own number, in the receipt's currency. */
  unconverted: string | null;
  category_id?: string;
  payee?: string;
  place?: string;
  note?: string;
  day?: string;
}

export type ReceiptChange = "amount" | "date" | "shop" | "category" | "note";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const receiptDay = (r: ReceiptRead) => (r.date && DAY.test(r.date) ? r.date : null);
const crosses = (r: ReceiptRead, entry: EntryNow) => !!r.currency && r.currency !== entry.currency;

/**
 * A category the location only suggested gives way to what the receipt says was bought; one chosen
 * by hand, or a debt, never does. A place the phone filled in gives way to the printed address (a
 * receipt is often photographed at home); one picked by hand never does.
 */
const takesCategory = (entry: EntryNow, r: ReceiptRead) => (!entry.category_id || entry.suggested) && !entry.debt_id && !!r.category_id;
const takesPlace = (entry: EntryNow, where: string | null) => !!where && (!entry.place || entry.placeFromPhone);

/**
 * What the receipt would change about the entry — the Update button shows only when there is
 * something. `noteBlock` is the receipt as a note, worded by the caller (`receiptBlock`).
 */
export function receiptChanges(entry: EntryNow, r: ReceiptRead, noteBlock: string): ReceiptChange[] {
  const out: ReceiptChange[] = [];
  // In another currency the converted amount is not known yet, so only an empty amount counts.
  if (crosses(r, entry) ? entry.amount_minor === null : entry.amount_minor === null || entry.amount_minor !== toMinor(r.total, entry.currency) || !entry.expense) out.push("amount");
  const day = receiptDay(r);
  if (day && day !== entry.day) out.push("date");
  const where = receiptPlace(r);
  if (takesPlace(entry, where) && entry.place !== where) out.push("shop");
  if (takesCategory(entry, r) && r.category_id !== entry.category_id) out.push("category");
  if (appendBlock(entry.note, noteBlock) !== entry.note) out.push("note");
  return out;
}

/** The entry filled in from the receipt. `rate` converts the receipt's currency into the entry's. */
export function receiptFill(entry: EntryNow, r: ReceiptRead, rate: number | null, noteBlock: string): ReceiptFill {
  const cross = crosses(r, entry);
  const major = cross && rate ? r.total * rate : r.total;
  // No rate: 0, never the foreign number as if it were the account's (DATA.md rule 6).
  const fill: ReceiptFill = { amount: cross && !rate ? 0 : Math.round(major * 100) / 100, unconverted: cross && !rate ? r.currency! : null };
  if (takesCategory(entry, r)) fill.category_id = r.category_id!;
  if (r.merchant?.trim() && !entry.payee) fill.payee = r.merchant.trim();
  const where = receiptPlace(r);
  if (takesPlace(entry, where)) fill.place = where!;
  const note = appendBlock(entry.note, noteBlock);
  if (note !== entry.note) fill.note = note;
  const day = receiptDay(r);
  if (day && day !== entry.day) fill.day = day;
  return fill;
}

/** A receipt's item as sorted on the receipt sheet: its price (major units) and the category it went to. */
export interface SortedItem { price: number; category_id: string | null }

export interface ReceiptPlan {
  /** The entry's own category. */
  category_id: string | null;
  /** The other categories, each a part of `basis`. */
  parts: { category_id: string; amount_minor: number }[];
  /** What the parts were measured against: the entry's total, or a nominal one when it is not known yet. */
  basis: number;
  /** For each item, the category of the row it ends up in: the entry's (`category_id`) or a part's. */
  rowOf: (string | null)[];
}

/** A total to share out when the entry's is not known yet; the parts are then scaled on save. */
export const NOMINAL_BASIS = 1_000_000;

/**
 * The receipt's sorted items as a split (`receiptSplit`), against the entry's total — or, when that
 * is not known yet (a receipt in another currency is converted only as it is filled in), against
 * `NOMINAL_BASIS`, to be scaled by `receiptSave`. Items with no category, and items in the entry's
 * own category, stay with the entry.
 */
export function receiptPlan(items: SortedItem[], receiptTotal: number, entryTotalMinor: number, entryCategory: string | null): ReceiptPlan {
  const basis = entryTotalMinor > 0 ? entryTotalMinor : NOMINAL_BASIS;
  const plan = items.length ? receiptSplit(items, receiptTotal, basis, entryCategory) : { category_id: entryCategory, parts: [] };
  const own = new Set(plan.parts.map((x) => x.category_id));
  const rowOf = items.map((it) => (it.category_id && own.has(it.category_id) ? it.category_id : plan.category_id));
  return { ...plan, basis, rowOf };
}

export interface SavePart { amount_minor: number; category_id: string | null; person_id?: string | null }

/**
 * What Continue saves: the entry's category — the plan's, or, when the items that stay with it were
 * given none, the one the entry already has — and the parts scaled from the plan's basis to the
 * entry's total (`wholeMinor`). Friends' shares are amounts of their own and are not scaled. Should
 * rounding leave the entry nothing, the smallest parts go back to it.
 */
export function receiptSave<P extends SavePart>(plan: { category_id: string | null; basis?: number }, parts: P[], wholeMinor: number, entryCategory: string | null): { category_id: string | null; parts: P[] } {
  const scale = plan.basis && wholeMinor > 0 ? wholeMinor / plan.basis : 1;
  const scaled = parts.map((x) => (x.person_id ? x : { ...x, amount_minor: Math.round(x.amount_minor * scale) })).filter((x) => x.amount_minor > 0);
  const own = (list: P[]) => list.filter((x) => !x.person_id);
  while (own(scaled).length && scaled.reduce((a, x) => a + x.amount_minor, 0) >= wholeMinor) {
    const smallest = own(scaled).reduce((a, b) => (b.amount_minor < a.amount_minor ? b : a));
    scaled.splice(scaled.indexOf(smallest), 1);
  }
  return { category_id: plan.category_id ?? entryCategory, parts: scaled };
}
