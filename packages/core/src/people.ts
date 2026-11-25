/**
 * Friends, and the money between you and them (DATA.md rule 23).
 *
 * You pay 120.00 for a dinner for three. The bank took 120.00, so the account has to say so — but
 * only 40.00 of it was your dinner; the other 80.00 is owed to you. A split with friends therefore
 * writes the purchase as several rows, exactly like any split (split.ts, rule 11): your part keeps
 * the entry's id and its category, and each friend's share is a row of its own carrying their
 * `person_id`, the purchase it came from (`share_of`) and, if you listed them, what it was for
 * (`items`). The rows still add up to what left the account.
 *
 * A row with a person is never your spending or your income: their share going out was not your
 * dinner, and them paying you back is not a salary. Every total leaves it out (`NO_PERSON`).
 *
 * What a friend owes is simply what their rows add up to, per currency — shares out minus money
 * back — so there is nothing stored to keep in step, and a repayment covers whatever is oldest
 * without being pointed at any one dinner.
 */
import type { SqlDriver } from "./db";
import type { Person, ShareItem, Transaction } from "./models";
import { createTransaction, getRow, listRows, save } from "./repo";
import { newId } from "./ids";

/** The condition every spending or income total adds: `t` is the transactions alias. */
export const NO_PERSON = "t.person_id IS NULL";

/** Friends in their order; archived ones only when asked for. */
export function listPeople(db: SqlDriver, o: { archived?: boolean } = {}): Person[] {
  return listRows(db, "people", o.archived ? "deleted=0" : "deleted=0 AND archived=0", [], "sort, name COLLATE NOCASE");
}

/**
 * Friends kept together (v26): each group with two or more live members, in the order the members'
 * own list puts them, keyed by `group_id`. A group left with one member is no group — that member
 * is listed alone — so leaving never has to tidy up after itself for the list to read right.
 */
export function peopleGroups(people: Person[]): Map<string, Person[]> {
  const all = new Map<string, Person[]>();
  for (const p of people) if (p.group_id) all.set(p.group_id, [...(all.get(p.group_id) ?? []), p]);
  for (const [id, members] of all) if (members.length < 2) all.delete(id);
  return all;
}

/**
 * A group is named after the friends in it, by first name: "Ola & Marek", "Ola, Marek & Ira".
 * `and` is the language's own word for the last join.
 */
export function groupName(names: string[], and: string): string {
  const first = names.map((n) => n.trim().split(/\s+/)[0] || n.trim()).filter(Boolean);
  if (first.length < 2) return first[0] ?? "";
  return `${first.slice(0, -1).join(", ")} ${and} ${first[first.length - 1]}`;
}

/**
 * Makes these friends one group, exactly: `groupId` is the group being edited (its id is kept, and
 * whoever is no longer picked leaves it), or none for a new one. Each friend comes out of whatever
 * group they were in. Only rows whose group changes are written (rule 15's lesson), and a group left
 * with one member is cleared, so no stale id waits to pull a later friend in. Fewer than two friends
 * is no group: the edited one is dissolved. Returns the group's id, or null.
 */
export function groupPeople(db: SqlDriver, ids: string[], groupId?: string): string | null {
  const members = [...new Set(ids)].map((id) => getRow(db, "people", id)).filter((p): p is Person => !!p && !p.deleted);
  if (members.length < 2) { if (groupId) ungroup(db, groupId); return null; }
  const id = groupId ?? newId();
  const keep = new Set(members.map((p) => p.id));
  const left = new Set<string>();
  db.transaction(() => {
    for (const p of listRows(db, "people", "deleted=0 AND group_id=?", [id])) if (!keep.has(p.id)) save(db, "people", { ...p, group_id: null });
    for (const p of members) {
      if (p.group_id === id) continue;
      if (p.group_id) left.add(p.group_id);
      save(db, "people", { ...p, group_id: id });
    }
    for (const g of left) clearLoneGroup(db, g);
  });
  return id;
}

/** Takes a friend out of their group; the one left behind, if alone, is no longer grouped either. */
export function leaveGroup(db: SqlDriver, personId: string): void {
  const p = getRow(db, "people", personId);
  if (!p?.group_id) return;
  const g = p.group_id;
  db.transaction(() => {
    save(db, "people", { ...p, group_id: null });
    clearLoneGroup(db, g);
  });
}

/** Everyone out of a group: the group is gone. */
export function ungroup(db: SqlDriver, groupId: string): void {
  db.transaction(() => {
    for (const p of listRows(db, "people", "deleted=0 AND group_id=?", [groupId])) save(db, "people", { ...p, group_id: null });
  });
}

function clearLoneGroup(db: SqlDriver, groupId: string): void {
  const rest = listRows(db, "people", "deleted=0 AND group_id=?", [groupId]);
  if (rest.length === 1) save(db, "people", { ...rest[0]!, group_id: null });
}

/** What a share was for, read safely: anything that is not a list of named amounts reads as none. */
export function shareItems(json: string | null | undefined): ShareItem[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json) as unknown;
    if (!Array.isArray(v)) return [];
    return v.filter((x): x is ShareItem => !!x && typeof x.name === "string" && Number.isInteger(x.amount_minor) && x.amount_minor > 0)
      .map((x) => ({ name: x.name.trim(), amount_minor: x.amount_minor })).filter((x) => x.name);
  } catch { return []; }
}

/** `ShareItem[]` as the column stores it: NULL for none. */
export function itemsToStore(items: ShareItem[] | null | undefined): string | null {
  const clean = shareItems(items ? JSON.stringify(items) : null);
  return clean.length ? JSON.stringify(clean) : null;
}

/**
 * A total shared out by weight, in whole minor units, adding up to it exactly. The first share
 * takes the rounding — when you are in the split you are first, so the odd cent is yours rather
 * than a friend's, the same way the first part of any split is the remainder (rule 11).
 *
 * `divideShares(10000, [1, 1, 1])` is `[3334, 3333, 3333]`; `[1, 2]` (a couple counted as two) is
 * `[3334, 6666]`. Weights that are not positive count as nothing, and an empty or all-zero list
 * divides nothing.
 */
export function divideShares(totalMinor: number, weights: number[]): number[] {
  const total = Math.abs(Math.trunc(totalMinor));
  const w = weights.map((x) => (Number.isFinite(x) && x > 0 ? x : 0));
  const sum = w.reduce((a, b) => a + b, 0);
  if (!sum || !w.length) return weights.map(() => 0);
  const out = w.map((x) => Math.floor((total * x) / sum));
  const firstPaid = w.findIndex((x) => x > 0);
  out[firstPaid] = (out[firstPaid] ?? 0) + (total - out.reduce((a, b) => a + b, 0));
  return out;
}

export interface PersonBalance {
  person_id: string;
  currency: string;
  /** Positive: they owe you. Negative: they paid you more than their shares, so you owe them. */
  owed_minor: number;
}

/**
 * What every friend owes, per currency (never added across currencies). Shares are negative rows
 * and repayments positive ones, so the balance is minus their sum. A friend at zero in a currency
 * is left out.
 */
export function personBalances(db: SqlDriver, personId?: string): PersonBalance[] {
  const rows = db.all<{ person_id: string; currency: string; s: number }>(
    `SELECT t.person_id, a.currency, SUM(t.amount_minor) AS s FROM transactions t JOIN accounts a ON a.id=t.account_id
     WHERE t.deleted=0 AND t.person_id IS NOT NULL${personId ? " AND t.person_id=?" : ""}
     GROUP BY t.person_id, a.currency`, personId ? [personId] : []);
  return rows.filter((r) => r.s).map((r) => ({ person_id: r.person_id, currency: r.currency, owed_minor: -r.s }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

export interface PersonLine {
  row: Transaction;
  currency: string;
  /** "share": their part of something you paid. "repaid": money from them. */
  kind: "share" | "repaid";
  /** The purchase a share came from, when it is still there. */
  purchase: Transaction | null;
  items: ShareItem[];
  /** What they owed in this currency once this line was counted. */
  balance_minor: number;
}

/** A friend's history, oldest first, with the running balance per currency after each line. */
export function personHistory(db: SqlDriver, personId: string): PersonLine[] {
  const rows = db.all(
    `SELECT t.*, a.currency FROM transactions t JOIN accounts a ON a.id=t.account_id
     WHERE t.deleted=0 AND t.person_id=? ORDER BY t.date, t.rowid`, [personId]) as unknown as (Transaction & { currency: string })[];
  const running = new Map<string, number>();
  return rows.map(({ currency, ...row }) => {
    const balance = (running.get(currency) ?? 0) - row.amount_minor;
    running.set(currency, balance);
    const purchase = row.share_of ? getRow(db, "transactions", row.share_of) ?? null : null;
    return {
      row: row as Transaction, currency, kind: row.amount_minor < 0 ? "share" : "repaid",
      purchase: purchase && !purchase.deleted ? purchase : null, items: shareItems(row.items), balance_minor: balance,
    };
  });
}

/** The friends' shares carved from a purchase — what deleting or re-splitting it has to deal with. */
export function sharesOf(db: SqlDriver, purchaseId: string): Transaction[] {
  return listRows(db, "transactions", "deleted=0 AND share_of=? AND person_id IS NOT NULL", [purchaseId], "rowid");
}

/** Payments marked to be split later, newest first. */
export function toSplitQueue(db: SqlDriver): Transaction[] {
  return listRows(db, "transactions", "deleted=0 AND to_split=1 AND transfer_id IS NULL", [], "date DESC");
}

/** Who an event or trip is with: the budget's `people`, read safely. */
export function budgetPeople(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json) as unknown;
    return Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && !!x))] : [];
  } catch { return []; }
}

/**
 * "Let it go": a friend is never going to pay, so what they still owe in `currency` becomes your
 * own spending. Repayments cover the oldest shares first, so what is unpaid is the newest: those
 * rows lose their person and take the purchase's category (or `categoryId`, when given) — the same
 * rows, ids kept (rule 1). A share only partly unpaid is split in two: the paid part stays theirs,
 * and the rest becomes a new row of yours beside it.
 *
 * Returns how much became yours. Nothing happens when they owe nothing (or you owe them).
 */
export function letItGo(db: SqlDriver, personId: string, currency: string, o: { categoryId?: string | null } = {}): number {
  const owed = personBalances(db, personId).find((b) => b.currency === currency)?.owed_minor ?? 0;
  if (owed <= 0) return 0;
  return db.transaction(() => {
    const shares = personHistory(db, personId).filter((l) => l.currency === currency && l.kind === "share").reverse();
    let left = owed;
    for (const { row, purchase } of shares) {
      if (left <= 0) break;
      const share = -row.amount_minor;
      const yours = {
        category_id: o.categoryId !== undefined ? o.categoryId : purchase?.category_id ?? null,
        tag_ids: purchase?.tag_ids ?? "[]",
      };
      if (share <= left) {
        save(db, "transactions", { ...row, ...yours, person_id: null, items: null });
        left -= share;
        continue;
      }
      // Partly paid: they keep what they paid, the rest is yours.
      save(db, "transactions", { ...row, amount_minor: -(share - left), items: null, entered_amount_minor: null, entered_currency: null, exchange_rate: null });
      const { id: _id, updated_at: _u, deleted: _d, ...copy } = row;
      createTransaction(db, { ...copy, ...yours, amount_minor: -left, person_id: null, items: null, entered_amount_minor: null, entered_currency: null, exchange_rate: null });
      left = 0;
    }
    return owed - left;
  });
}
