/**
 * What history already knows about a name. A card-payment automation (and the app, when it fills a
 * pending row in) only ever gets a merchant string or a note; the last time that same name was filed
 * by hand says which category, which tags and which place it belongs to, so the user does not file
 * the same shop twice — and, because the answer comes from a decision the user made themselves,
 * an entry that matches needs no trip through the pending queue either.
 */
import type { SqlDriver, Row } from "./db";
import type { Transaction } from "./models";
import { getRow, jsonIds, save } from "./repo";

export interface PayeeHistory {
  /** From one single past row, together with `tag_ids`: they describe the same past decision. */
  category_id: string | null;
  tag_ids: string[];
  /** Where the name was last seen — the newest past entry for it that recorded a location. */
  place: string | null;
  lat: number | null;
  lon: number | null;
}

/** Nothing is known about this name. */
export function noPayeeHistory(): PayeeHistory {
  return { category_id: null, tag_ids: [], place: null, lat: null, lon: null };
}

/**
 * History filed this name under a category before, so a new entry for it is already understood:
 * callers use this to skip the pending queue.
 */
export function isFiledBefore(h: PayeeHistory): boolean {
  return h.category_id !== null;
}

/**
 * The category, tags and place of the most recent hand-filed transaction for this name: the shop's
 * exact name first, then the note's, then the shop's first word, so different branches of one chain
 * ("ZABKA ZE212 K.5" / "ZABKA NANO 3087") still find each other. A name matches whether it was filed
 * as a payee or as a note, because a Shortcut that has only a note writes it into `notes`.
 * Empty when the name is new.
 */
export function payeeHistory(db: SqlDriver, payee: string | null | undefined, note?: string | null): PayeeHistory {
  const shop = payee?.trim() || null;
  // The whole note, not its first line: an automation writes one line, and an exact match is the
  // only rule that cannot file an entry under the wrong thing.
  const title = note?.trim() || null;
  const byName = "(payee = ? COLLATE NOCASE OR notes = ? COLLATE NOCASE)";
  const tries: [string, string[]][] = [];
  if (shop) tries.push([byName, [shop, shop]]);
  if (title && title.toLowerCase() !== shop?.toLowerCase()) tries.push([byName, [title, title]]);
  const head = shop?.split(" ")[0];
  if (head && head.length >= 3 && head !== shop) tries.push(["payee LIKE ? COLLATE NOCASE", [`${head}%`]]);
  if (!tries.length) return noPayeeHistory();

  /** The newest past entry matching any of the names above, in that order, that also satisfies `has`. */
  const newest = (cols: string, has: string) => {
    for (const [where, binds] of tries) {
      const row = db.get<Row>(
        `SELECT ${cols} FROM transactions WHERE deleted=0 AND transfer_id IS NULL AND ${has} AND ${where} ORDER BY date DESC LIMIT 1`, binds);
      if (row) return row;
    }
    return undefined;
  };
  // Category and tags come from whichever single row matches, so they always describe one past
  // decision; a row with tags but no category still counts.
  const filed = newest("category_id, tag_ids", "(category_id IS NOT NULL OR tag_ids <> '[]')");
  // Where the shop is, though, is a fact of its own — the newest entry that recorded a location,
  // whether or not that is the entry the category came from.
  const seen = newest("place, lat, lon", "((place IS NOT NULL AND place <> '') OR lat IS NOT NULL)");
  return {
    category_id: (filed?.category_id as string | null) ?? null,
    tag_ids: jsonIds((filed?.tag_ids as string | null) ?? null),
    place: (seen?.place as string | null) || null,
    lat: (seen?.lat as number | null) ?? null,
    lon: (seen?.lon as number | null) ?? null,
  };
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
