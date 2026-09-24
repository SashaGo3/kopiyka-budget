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
}

/** Nothing is known about this name. */
export function noPayeeHistory(): PayeeHistory {
  return { category_id: null, tag_ids: [], place: null, lat: null, lon: null, match: null };
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
function isMethodWord(word: string): boolean {
  const folded = word.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\u0142/g, "l")
    .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  return METHOD_WORDS.has(folded);
}

/**
 * The SQL that finds this name, in the order it should be tried: the shop's exact name first, then
 * the note's, then the shop's first word, so different branches of one chain ("ZABKA ZE212 K.5" /
 * "ZABKA NANO 3087") still find each other. A name matches whether it was filed as a payee or as a
 * note, because a Shortcut that has only a note writes it into `notes`.
 */
function nameTries(payee: string | null | undefined, note?: string | null): { where: string; binds: string[]; match: PayeeMatch }[] {
  const shop = payee?.trim() || null;
  // The whole note, not its first line: an automation writes one line, and an exact match is the
  // only rule that cannot file an entry under the wrong thing.
  const title = note?.trim() || null;
  const byName = "(payee = ? COLLATE NOCASE OR notes = ? COLLATE NOCASE)";
  const tries: { where: string; binds: string[]; match: PayeeMatch }[] = [];
  if (shop) tries.push({ where: byName, binds: [shop, shop], match: "exact" });
  if (title && title.toLowerCase() !== shop?.toLowerCase()) tries.push({ where: byName, binds: [title, title], match: "exact" });
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
 * The category, tags and place of the most recent hand-filed transaction for this name (matched as
 * `nameTries` describes). Empty when the name is new.
 */
export function payeeHistory(db: SqlDriver, payee: string | null | undefined, note?: string | null): PayeeHistory {
  const tries = nameTries(payee, note);
  if (!tries.length) return noPayeeHistory();

  /** The newest past entry matching any of the names above, in that order, that also satisfies `has`. */
  const newest = (cols: string, has: string) => {
    for (const t of tries) {
      const row = db.get<Row>(
        `SELECT ${cols} FROM transactions WHERE deleted=0 AND transfer_id IS NULL AND ${has} AND ${t.where} ORDER BY date DESC LIMIT 1`, t.binds);
      if (row) return { row, match: t.match };
    }
    return undefined;
  };
  // Category and tags come from whichever single row matches, so they always describe one past
  // decision; a row with tags but no category still counts.
  const filed = newest("category_id, tag_ids", FILED);
  // A category that has since been archived is not an answer. Returning it would have the automation
  // file a new payment somewhere the app no longer offers, and quietly — so the category is dropped
  // and the match with it, which leaves the entry uncategorised and therefore in the Pending queue,
  // where the shop can be given the category that replaced the old one.
  const gone = archivedCategoryIds(listRows(db, "categories", "deleted=0"));
  const filedCategory = (filed?.row.category_id as string | null) ?? null;
  const archived = !!filedCategory && gone.has(filedCategory);
  // Archived *tags* are simply left off; unlike the category they are not what decides whether the
  // entry needs looking at, so dropping them silently costs nothing. Only tags that exist and are
  // archived are dropped: an id with no row behind it is left alone, the way it always was.
  const retiredTags = new Set(listRows(db, "tags", "deleted=0 AND archived=1").map((t) => t.id));
  // Where the shop is, though, is a fact of its own — the newest entry that recorded a location,
  // whether or not that is the entry the category came from.
  const seen = newest("place, lat, lon", "((place IS NOT NULL AND place <> '') OR lat IS NOT NULL)");
  return {
    category_id: archived ? null : filedCategory,
    tag_ids: jsonIds((filed?.row.tag_ids as string | null) ?? null).filter((id) => !retiredTags.has(id)),
    place: (seen?.row.place as string | null) || null,
    lat: (seen?.row.lat as number | null) ?? null,
    lon: (seen?.row.lon as number | null) ?? null,
    // No category means nothing was recognised, however well the name matched: `isTrustedFiling`
    // reads this, and a "trusted" match with nothing to file under would skip the queue for nothing.
    match: archived ? null : filed?.match ?? null,
  };
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
 */
export function payeeOptions(db: SqlDriver, payee: string | null | undefined, note?: string | null, limit = 6): PayeeOption[] {
  for (const t of nameTries(payee, note)) {
    const rows = db.all<Row>(
      `SELECT category_id, tag_ids FROM transactions WHERE deleted=0 AND transfer_id IS NULL AND ${FILED} AND ${t.where} ORDER BY date DESC LIMIT 200`, t.binds);
    if (!rows.length) continue;
    const out = new Map<string, PayeeOption>();
    const gone = archivedCategoryIds(listRows(db, "categories", "deleted=0"));
    for (const r of rows) {
      const tag_ids = jsonIds((r.tag_ids as string | null) ?? null);
      const category_id = (r.category_id as string | null) ?? null;
      // The sheet offers these as answers, so a retired category is not among them. The count of
      // *ways* this shop was filed is what tells the automation whether it may pick for you
      // (`variants` in nativeWrites), and a way you can no longer choose is not a way.
      if (category_id && gone.has(category_id)) continue;
      // Tags sorted only for the key: two rows with the same tags in another order are one option.
      const key = `${category_id ?? ""}|${[...tag_ids].sort().join(",")}`;
      const seen = out.get(key);
      if (seen) seen.count++;
      else out.set(key, { category_id, tag_ids, count: 1 });
    }
    // Rows arrive newest first, so a stable sort by count keeps the most recent of equally common pairs on top.
    return [...out.values()].sort((a, b) => b.count - a.count).slice(0, limit);
  }
  return [];
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
