/**
 * What history already knows about a name. A card-payment automation (and the app, when it fills a
 * pending row in) only ever gets a merchant string or a note; the last time that same name was filed
 * by hand says which category, which tags and which place it belongs to, so the user does not file
 * the same shop twice — and, because the answer comes from a decision the user made themselves,
 * an entry that matches needs no trip through the pending queue either.
 */
import type { SqlDriver, Row } from "./db";
import type { Transaction } from "./models";
import { archivedCategoryIds, getRow, jsonIds, listRows, save } from "./repo";
import { carriedTagIds, uncarriedTagIds } from "./trips";

/**
 * How sure the match is.
 *
 * `"exact"` — this very name was filed by hand before, and repeating that decision cannot file the
 * entry under the wrong thing. `"similar"` — only the first word matched, which is what lets the
 * branches of a chain find each other ("ZABKA ZE212 K.5" / "ZABKA NANO 3087") and is a guess, not
 * a decision: two shops can share a first word.
 */
export type PayeeMatch = "exact" | "similar";

export interface PayeeHistory {
  /** From one single past row, together with `tag_ids`: they describe the same past decision. */
  category_id: string | null;
  tag_ids: string[];
  /** Where the name was last seen — the newest past entry for it that recorded a location. */
  place: string | null;
  lat: number | null;
  lon: number | null;
  /** How the row that supplied the category was found; null when nothing was found. */
  match: PayeeMatch | null;
  /**
   * The amount chose between the ways this name was filed (`pickByAmount`): `"sure"` when it settles
   * the question, `"near"` when it only points one way. Null when it was not asked, or said nothing.
   */
  by_amount: "sure" | "near" | null;
}

/** Nothing is known about this name. */
export function noPayeeHistory(): PayeeHistory {
  return { category_id: null, tag_ids: [], place: null, lat: null, lon: null, match: null, by_amount: null };
}

/** History has a category for this name — by whatever route. Enough to fill the field in. */
export function isFiledBefore(h: PayeeHistory): boolean {
  return h.category_id !== null;
}

/**
 * History filed *this exact name* under a category before, so a new entry for it is already
 * understood and needs no trip through the pending queue.
 *
 * A first-word match is deliberately not enough. "BLIK INTERNET: FLYSTORE.PL" and "BLIK INTERNET:
 * ALLEGRO.PL" share everything but the shop, and the queue is exactly where an entry belongs when
 * the only thing recognised about it is how it was paid for.
 */
export function isTrustedFiling(h: PayeeHistory): boolean {
  return h.category_id !== null && h.match === "exact";
}

/**
 * Words that are how you paid, not who you paid. Banks wrap the real shop in them — "BLIK
 * INTERNET: FLYSTORE.PL", "Zakup kartą: ROSSMANN" — so as the first word of a name they say
 * nothing about the shop, and matching on them files a bookshop under groceries because both were
 * paid for with BLIK.
 */
const METHOD_WORDS = new Set([
  "blik", "przelew", "przelewy", "przelewy24", "p24", "payu", "tpay", "dotpay", "paypal",
  "platnosc", "platnosci", "zakup", "zakupy", "karta", "karty", "internet", "online", "ecommerce",
  "mobile", "apple", "google", "pay", "visa", "mastercard", "payment", "transfer", "oplata", "web",
  "переказ", "оплата", "платеж", "платіж",
]);

/**
 * Is this first word a shop's, or only how the money moved? Accents and punctuation come off first
 * ("płatność" → "platnosc"), so the list holds one spelling of each word — the same one the Swift
 * copies hold (`KPStore.isMethodWord`, `KPPaymentText.unwrapMethod`), which fold the same way.
 */
export function isMethodWord(word: string): boolean {
  const folded = word.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\u0142/g, "l")
    .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  return METHOD_WORDS.has(folded);
}

/**
 * The SQL that finds this name, in the order it should be tried: the shop's exact name first, then
 * the note's, then the shop's first word, so different branches of one chain ("ZABKA ZE212 K.5" /
 * "ZABKA NANO 3087") still find each other. A name matches whether it was filed as a payee or as a
 * note, because a Shortcut that has only a note writes it into `notes` — and the automation, from
 * v23, writes the bank's own words into `bank_note`.
 */
function nameTries(payee: string | null | undefined, note?: string | null): { where: string; binds: string[]; match: PayeeMatch }[] {
  const shop = payee?.trim() || null;
  // The whole note, not its first line: an automation writes one line, and an exact match is the
  // only rule that cannot file an entry under the wrong thing.
  const title = note?.trim() || null;
  const byName = "(payee = ? COLLATE NOCASE OR notes = ? COLLATE NOCASE OR bank_note = ? COLLATE NOCASE)";
  const tries: { where: string; binds: string[]; match: PayeeMatch }[] = [];
  if (shop) tries.push({ where: byName, binds: [shop, shop, shop], match: "exact" });
  if (title && title.toLowerCase() !== shop?.toLowerCase()) tries.push({ where: byName, binds: [title, title, title], match: "exact" });
  const head = shop?.split(" ")[0];
  // A first word that says how you paid is no name at all, so there is nothing to widen the search to.
  if (head && head.length >= 3 && head !== shop && !isMethodWord(head)) {
    tries.push({ where: "payee LIKE ? COLLATE NOCASE", binds: [`${head}%`], match: "similar" });
  }
  return tries;
}

/** Rows that were filed under something: a category, tags, or both. */
const FILED = "(category_id IS NOT NULL OR tag_ids <> '[]')";

/**
 * The payment being asked about, when there is one: its signed amount (minor units) and the account
 * it is on. One landlord takes the rent (4 323.99, every month) and the service charges (500–670),
 * and the name alone cannot tell them apart — the amount can.
 */
export interface PaymentAmount {
  amount_minor: number;
  account_id?: string | null;
}

/** One past filing, as `pickByAmount` reads it. */
export interface AmountRow {
  /** The (category, tags) pair it was filed as — the same key `payeeOptions` groups by. */
  key: string;
  amount_minor: number;
  /** Booked in the payment's currency: amounts in another one are not comparable. */
  same_currency: boolean;
}

export interface AmountPick {
  key: string;
  /** The amount settles it — as much a decision as one way of filing would be. Otherwise only a lead. */
  sure: boolean;
}

/**
 * Which of the ways a name was filed this amount belongs to, if any. Only past payments in the same
 * direction and currency are compared, and only when there are two ways or more to choose between.
 *
 * - **The same amount, to the minor unit**, filed one way only: sure. Rent is the same every month.
 * - **Inside one way's range** (smallest to largest it was ever paid), with two payments or more
 *   behind that range, and no other way within 10 % of it: sure.
 * - **Within 10 % of one way's range** and no other's: a lead — the rent went up a little, a bill
 *   came in lower — filled in, but not a decision.
 *
 * Anything else — ranges that overlap, an amount between two of them — says nothing. Mirrored by
 * `KPStore.pickByAmount` (native/KPShared.swift); the payee-history harness checks the two agree.
 */
export function pickByAmount(rows: AmountRow[], amount_minor: number): AmountPick | null {
  const target = Math.abs(amount_minor);
  if (!target) return null;
  const sign = Math.sign(amount_minor);
  const ways = new Map<string, number[]>();
  for (const r of rows) {
    if (!r.same_currency || Math.sign(r.amount_minor) !== sign) continue;
    const list = ways.get(r.key);
    if (list) list.push(Math.abs(r.amount_minor));
    else ways.set(r.key, [Math.abs(r.amount_minor)]);
  }
  if (ways.size < 2) return null;
  const exact = [...ways].filter(([, a]) => a.includes(target));
  if (exact.length > 1) return null;
  if (exact[0]) return { key: exact[0][0], sure: true };
  // Integers only: within 10 % of [min, max] is 10·target ∈ [9·min, 11·max].
  const near = [...ways].filter(([, a]) => target * 10 >= Math.min(...a) * 9 && target * 10 <= Math.max(...a) * 11);
  if (near.length !== 1 || !near[0]) return null;
  const [key, a] = near[0];
  return { key, sure: a.length >= 2 && target >= Math.min(...a) && target <= Math.max(...a) };
}

/** The key a (category, tags) pair is grouped under — tags sorted, so their order is no difference. */
function wayKey(category_id: string | null, tag_ids: string[]): string {
  return `${category_id ?? ""}|${[...tag_ids].sort().join(",")}`;
}

/** The currency of the account a payment is on, or null when there is none to compare against. */
function currencyOf(db: SqlDriver, account_id: string | null | undefined): string | null {
  if (!account_id) return null;
  return (db.get<Row>("SELECT currency FROM accounts WHERE id=?", [account_id])?.currency as string | undefined) ?? null;
}

/**
 * Every filed row for the first name in `tries` that has any, newest first, as the ways it was
 * filed: tags a row cannot hand on dropped, rows under an archived category left out (a way you can
 * no longer choose is not a way). Shared by `payeeHistory`'s amount pick and `payeeOptions`.
 */
function filedWays(db: SqlDriver, tries: ReturnType<typeof nameTries>, currency: string | null, exceptId?: string | null) {
  const except = exceptId ? " AND id <> ?" : "";
  const gone = archivedCategoryIds(listRows(db, "categories", "deleted=0"));
  const skip = uncarriedTagIds(db);
  for (const t of tries) {
    const rows = db.all<Row>(
      `SELECT category_id, tag_ids, amount_minor, (SELECT currency FROM accounts a WHERE a.id = transactions.account_id) AS currency FROM transactions WHERE deleted=0 AND transfer_id IS NULL AND person_id IS NULL AND ${FILED} AND ${t.where}${except} ORDER BY date DESC LIMIT 200`,
      exceptId ? [...t.binds, exceptId] : t.binds);
    if (!rows.length) continue;
    return rows.flatMap((r) => {
      const tag_ids = carriedTagIds(jsonIds((r.tag_ids as string | null) ?? null), skip);
      const category_id = (r.category_id as string | null) ?? null;
      if (!category_id && !tag_ids.length) return [];
      if (category_id && gone.has(category_id)) return [];
      return [{ category_id, tag_ids, key: wayKey(category_id, tag_ids), amount_minor: Number(r.amount_minor),
                same_currency: currency !== null && r.currency === currency }];
    });
  }
  return [];
}

/**
 * The category, tags and place of the most recent hand-filed transaction for this name (matched as
 * `nameTries` describes). Empty when the name is new.
 */
export function payeeHistory(db: SqlDriver, payee: string | null | undefined, note?: string | null, payment?: PaymentAmount | null): PayeeHistory {
  const tries = nameTries(payee, note);
  if (!tries.length) return noPayeeHistory();

  // Tags an earlier entry cannot hand on: a trip's (it says when, not what the shop is) and archived
  // ones (`uncarriedTagIds`). Archived *tags*, unlike an archived category, are not what decides
  // whether the entry needs looking at, so dropping them silently costs nothing.
  const skip = uncarriedTagIds(db);
  /**
   * The newest past entry matching any of the names above, in that order, that also satisfies `has`
   * and `keep`. `keep` is asked here because tags are JSON: a few rows are read per name, so a row
   * that only ever carried a trip's tag does not hide the older one that was really filed.
   */
  const newest = (cols: string, has: string, keep: (row: Row) => boolean = () => true) => {
    for (const t of tries) {
      const rows = db.all<Row>(
        `SELECT ${cols} FROM transactions WHERE deleted=0 AND transfer_id IS NULL AND person_id IS NULL AND ${has} AND ${t.where} ORDER BY date DESC LIMIT 20`, t.binds);
      const row = rows.find(keep);
      if (row) return { row, match: t.match };
    }
    return undefined;
  };
  const ownTags = (row: Row) => carriedTagIds(jsonIds((row.tag_ids as string | null) ?? null), skip);
  // Category and tags come from whichever single row matches, so they always describe one past
  // decision; a row with tags but no category still counts — unless all it carries is tags it
  // cannot hand on, which leaves nothing that was ever decided about the shop.
  const filed = newest("category_id, tag_ids", FILED, (row) => row.category_id != null || ownTags(row).length > 0);
  // A category that has since been archived is not an answer. Returning it would have the automation
  // file a new payment somewhere the app no longer offers, and quietly — so the category is dropped
  // and the match with it, which leaves the entry uncategorised and therefore in the Pending queue,
  // where the shop can be given the category that replaced the old one.
  const gone = archivedCategoryIds(listRows(db, "categories", "deleted=0"));
  const filedCategory = (filed?.row.category_id as string | null) ?? null;
  const archived = !!filedCategory && gone.has(filedCategory);
  // Where the shop is, though, is a fact of its own — the newest entry that recorded a location,
  // whether or not that is the entry the category came from.
  const seen = newest("place, lat, lon", "((place IS NOT NULL AND place <> '') OR lat IS NOT NULL)");
  // The same name filed more than one way — the rent and the service charges, both to the landlord.
  // The newest of them is only a starting point; the amount may say which this one is.
  const pick = filed && payment ? amountPick(db, tries, payment) : null;
  if (pick) {
    return {
      category_id: pick.way.category_id,
      tag_ids: pick.way.tag_ids,
      place: (seen?.row.place as string | null) || null,
      lat: (seen?.row.lat as number | null) ?? null,
      lon: (seen?.row.lon as number | null) ?? null,
      match: filed!.match,
      by_amount: pick.sure ? "sure" : "near",
    };
  }
  return {
    by_amount: null,
    category_id: archived ? null : filedCategory,
    tag_ids: filed ? ownTags(filed.row) : [],
    place: (seen?.row.place as string | null) || null,
    lat: (seen?.row.lat as number | null) ?? null,
    lon: (seen?.row.lon as number | null) ?? null,
    // No category means nothing was recognised, however well the name matched: `isTrustedFiling`
    // reads this, and a "trusted" match with nothing to file under would skip the queue for nothing.
    match: archived ? null : filed?.match ?? null,
  };
}

/** The way of filing this payment's amount picks (`pickByAmount`) — its newest row — or null. */
function amountPick(db: SqlDriver, tries: ReturnType<typeof nameTries>, payment: PaymentAmount) {
  const ways = filedWays(db, tries, currencyOf(db, payment.account_id));
  const pick = pickByAmount(ways, payment.amount_minor);
  const way = pick && ways.find((w) => w.key === pick.key);
  return pick && way ? { way, sure: pick.sure } : null;
}

/**
 * One way this name has been filed before: a category and the tags that went with it, and how often.
 * The same shop sells different things — fuel, a hot dog, a bottle of something — so one past
 * decision is not the whole story.
 */
export interface PayeeOption {
  category_id: string | null;
  tag_ids: string[];
  /** How many past entries for this name were filed exactly this way. */
  count: number;
}

/**
 * Every distinct (category, tags) pair this name was ever filed under, most used first, so the
 * entry sheet can offer "fuel or hot dog?" instead of silently repeating whichever came last.
 * Matched by the same names, in the same order, as `payeeHistory` — the first of them that has any
 * filed rows at all answers, so a branch of a chain is never mixed with the whole chain.
 * Empty when the name is new; a single entry means history is unambiguous.
 *
 * `exceptId` leaves one row out: a pending entry asking "which was it?" about itself. Its category
 * was only filled in from history (or guessed), so counting it would answer the question with the
 * question — and a guess from the shop list would turn up as a way the shop was filed.
 */
export function payeeOptions(db: SqlDriver, payee: string | null | undefined, note?: string | null, limit = 6, exceptId?: string | null, payment?: PaymentAmount | null): PayeeOption[] {
  // A trip's tag is not a way the shop was filed (`uncarriedTagIds`): the same coffee bought at home
  // and on a trip is one option, not two, and no option comes with a trip on it. A retired category
  // is not among them either: the sheet offers these as answers, and the count of *ways* this shop
  // was filed is what tells the automation whether it may pick for you (`variants` in nativeWrites).
  const ways = filedWays(db, nameTries(payee, note), currencyOf(db, payment?.account_id), exceptId);
  const out = new Map<string, PayeeOption>();
  for (const w of ways) {
    const seen = out.get(w.key);
    if (seen) seen.count++;
    else out.set(w.key, { category_id: w.category_id, tag_ids: w.tag_ids, count: 1 });
  }
  // Rows arrive newest first, so a stable sort by count keeps the most recent of equally common pairs
  // on top — after the way this payment's amount points to, when it points to one.
  const picked = payment ? pickByAmount(ways, payment.amount_minor)?.key : undefined;
  const first = (o: PayeeOption) => (picked !== undefined && wayKey(o.category_id, o.tag_ids) === picked ? 1 : 0);
  return [...out.values()].sort((a, b) => first(b) - first(a) || b.count - a.count).slice(0, limit);
}

/**
 * The entry that may already be this very charge: the newest one on the same account for the same
 * amount, made no earlier than `sinceIso`. Pending **or not** — a shop history recognises is written
 * straight out of the pending queue, and the second notification for that same tap has to find it
 * anyway. Callers treat a hit as "already logged" and add nothing.
 */
export function samePaymentSince(db: SqlDriver, o: { account_id: string; amount_minor: number; sinceIso: string }): Transaction | null {
  return db.get<Row>(
    `SELECT * FROM transactions WHERE deleted=0 AND account_id=? AND amount_minor=? AND date>=? ORDER BY date DESC LIMIT 1`,
    [o.account_id, o.amount_minor, o.sinceIso]) as Transaction | undefined ?? null;
}

/** What a later notification for one payment can contribute to the entry the first one created. */
export interface FillIn {
  payee?: string | null;
  place?: string | null;
  category_id?: string | null;
  tag_ids?: string[] | null;
  lat?: number | null;
  lon?: number | null;
}

/**
 * Fill the empty fields of a pending entry — never an overwrite: the second notification for one
 * payment usually knows something the first did not (Wallet has the tidy shop name, the bank app the
 * city). With `confirm`, an entry that ends up with a category leaves the pending queue too, because
 * history has already filed this shop by hand. Coordinates are written as a pair or not at all.
 * Returns the saved row, or null when `id` is not a live pending entry.
 */
export function fillPending(db: SqlDriver, id: string, patch: FillIn, confirm = false): Transaction | null {
  const row = getRow(db, "transactions", id);
  if (!row || row.deleted || !row.pending) return null;
  const category_id = row.category_id || patch.category_id || null;
  const point = row.lat === null && row.lon === null && patch.lat != null && patch.lon != null;
  return save(db, "transactions", {
    ...row,
    payee: row.payee || patch.payee || null,
    place: row.place || patch.place || null,
    category_id,
    lat: point ? patch.lat! : row.lat,
    lon: point ? patch.lon! : row.lon,
    tag_ids: row.tag_ids !== "[]" ? row.tag_ids : JSON.stringify(patch.tag_ids ?? []),
    // The only field this may overwrite, and only ever in the one direction.
    pending: confirm && category_id ? 0 : row.pending,
  });
}
