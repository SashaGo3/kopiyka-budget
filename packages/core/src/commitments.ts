/**
 * What is still going to be charged before the window closes.
 *
 * A budget bar at 40% on the 3rd reads as *safe*, and on the 4th the rent leaves. The app already
 * knows the rent is coming — it is a recurring rule with a `next_date` — and until this function
 * existed it said nothing. That gap is where overspending actually happens, and closing it needs no
 * new storage at all: every piece of the answer is already in the database.
 *
 * Two sources, because there are two ways money is already spoken for:
 *
 * - **Recurring rules.** Occurrences from `next_date` up to the end of the window. `next_date` is
 *   the whole of the double-counting argument: posting an occurrence advances it, and so does a
 *   real charge claiming one (rule 13), so anything still at or after it genuinely has not been
 *   paid. Subtracting what `recurringSpend` has already seen on top of that would take the same
 *   payment off twice.
 * - **Debts you owe** with a due date inside the window. A debt has no category, so asking for a
 *   category scope is asking a budget question, and debts drop out of the answer entirely.
 *
 * An occurrence that is already overdue counts. It is money that still has to leave, and leaving it
 * out would make a rule you are behind on look like one you had settled.
 */
import type { SqlDriver } from "./db";
import type { Account, Category, Debt, RecurringRule } from "./models";
import { jsonIds, listRows } from "./repo";
import { occurrencesBetween } from "./recurring";
import { listDebts } from "./debts";

export interface Commitment {
  kind: "rule" | "debt";
  /** The rule or debt this came from. */
  id: string;
  title: string;
  /** YYYY-MM-DD it is expected. */
  day: string;
  currency: string;
  /** Always positive: money that is still going to leave. */
  minor: number;
  /** What a rule is filed under, so a budget can tell whether it pays for it; null (and none) for a debt. */
  category_id: string | null;
  tag_ids: string[];
}

export interface CommitmentQuery {
  /** Inclusive. Usually today rather than the period start — what has already gone is not coming. */
  start: string;
  /** Exclusive. Usually the next salary. */
  end: string;
  accountIds?: string[];
  /**
   * Limit to rules filed under these categories; a folder stands for the categories inside it.
   * Debts are left out entirely when this is given — a debt is in no category, so counting it
   * against one would be inventing a fact.
   */
  categoryIds?: string[];
}

export function commitments(db: SqlDriver, o: CommitmentQuery): Commitment[] {
  const accounts = new Map((listRows(db, "accounts", "1=1") as Account[]).map((a) => [a.id, a]));
  const scope = o.accountIds?.length ? new Set(o.accountIds) : null;
  const cats = new Map((listRows(db, "categories", "1=1") as Category[]).map((c) => [c.id, c]));
  const wanted = o.categoryIds?.length ? new Set(o.categoryIds) : null;
  // A folder stands for its categories, the same meaning it has everywhere a scope is a set.
  const inCategories = (id: string | null) => !wanted || (!!id && (wanted.has(id) || wanted.has(cats.get(id)?.parent_id ?? "")));

  const out: Commitment[] = [];
  for (const rule of listRows(db, "recurring_rules", "deleted=0 AND active=1") as RecurringRule[]) {
    // Income is not a commitment: this answers what is still going to *leave*.
    if (rule.amount_minor >= 0) continue;
    if (scope && !scope.has(rule.account_id)) continue;
    if (!inCategories(rule.category_id)) continue;
    const currency = accounts.get(rule.account_id)?.currency;
    if (!currency) continue;
    const title = rule.payee || (rule.category_id ? cats.get(rule.category_id)?.name : null) || "Recurring";
    for (const day of occurrencesBetween(rule, o.start, o.end)) {
      out.push({ kind: "rule", id: rule.id, title, day, currency, minor: -rule.amount_minor, category_id: rule.category_id, tag_ids: jsonIds(rule.tag_ids) });
    }
  }

  if (!wanted) {
    for (const d of listDebts(db, { settled: false }) as Debt[]) {
      if (d.direction !== "i_owe" || !d.due_date) continue;
      if (d.due_date < o.start || d.due_date >= o.end) continue;
      // A debt that names no account is money you owe whichever accounts you are looking at.
      if (scope && d.account_id && !scope.has(d.account_id)) continue;
      out.push({ kind: "debt", id: d.id, title: d.person, day: d.due_date, currency: d.currency, minor: d.amount_minor, category_id: null, tag_ids: [] });
    }
  }

  return out.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

/** The same thing as one number per currency: what is still spoken for before the window closes. */
export function committedMinor(db: SqlDriver, o: CommitmentQuery): { currency: string; minor: number }[] {
  const out = new Map<string, number>();
  for (const c of commitments(db, o)) out.set(c.currency, (out.get(c.currency) ?? 0) + c.minor);
  return [...out].map(([currency, minor]) => ({ currency, minor }));
}
