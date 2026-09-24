/**
 * A real charge claiming the recurring occurrence it belongs to.
 *
 * With the notification automation running, a subscription is logged twice: once by the rule on the
 * day it was arranged for, and once by the bank's own message when the money actually moves. Waiting
 * turns that around — the rule posts nothing on the day, and the charge that arrives *is* the
 * occurrence: it takes the rule's id, the category and tags the rule already decided, and moves the
 * rule on to its next date. Nothing is written twice, and the row that survives carries the bank's
 * amount and the bank's day rather than the rule's guess at them, which is what makes a subscription
 * that went up in price, or a bill that is never the same twice, file itself correctly.
 *
 * Only the rule's *earliest* unposted occurrence is ever claimed. A rule several periods behind has
 * that backlog waiting in the confirm queue, and letting a single charge jump to the newest
 * occurrence would settle the arrears by forgetting them.
 */
import type { SqlDriver } from "./db";
import type { RecurringRule, Transaction } from "./models";
import { normTitle } from "./detect";
import { CLAIM_LEAD_DAYS, addPeriod, advanceRule, claimDeadline, ruleWaitDays } from "./recurring";
import { getRow, jsonIds, listRows, save } from "./repo";
import { tripTagIds } from "./trips";

export interface RecurringClaim {
  rule: RecurringRule;
  /** The occurrence this transaction settles (YYYY-MM-DD). */
  occurrence: string;
}

export interface ClaimOptions {
  /** Today, YYYY-MM-DD — only used to keep a charge dated far in the future out of it. */
  today: string;
  /** App-wide wait window in days; 0 when waiting is off, in which case nothing is ever claimed. */
  waitDefault: number;
}

/**
 * How far the amount may stray from the rule's when the name matches. A named match is the strong
 * signal — "Netflix" is Netflix whether it costs 12.99 or 15.49 this year, and a heating bill in
 * January is a multiple of one in June — but an order of magnitude apart is more likely a different
 * purchase at the same shop than the same commitment, and that one should stay its own row.
 */
const NAMED_AMOUNT_FACTOR = 4;

/**
 * Does this transaction name what the rule names? `match_payee` is asked first and is the whole
 * point of it — the name the bank actually uses, taken from a payment the user pointed the rule at.
 * The rule's own title is tried too, because "Netflix" usually is how the charge reads.
 *
 * Compared as whole words after normalisation, plus word-prefix either way, so "NETFLIX.COM
 * AMSTERDAM" and "Netflix" find each other while "Netflix" and "Net-a-Porter" do not.
 */
function namesMatch(rule: RecurringRule, tx: Pick<Transaction, "payee" | "notes">): boolean {
  const seen = [normTitle(tx.payee), normTitle(tx.notes)].filter(Boolean);
  if (!seen.length) return false;
  for (const name of [rule.match_payee, rule.payee]) {
    const want = normTitle(name);
    if (want.length < 3) continue;
    for (const got of seen) {
      if (` ${got} `.includes(` ${want} `)) return true;
      if (got.split(" ").some((w) => w.length >= 4 && (w.startsWith(want) || want.startsWith(w)))) return true;
    }
  }
  return false;
}

/**
 * The occurrence this transaction is the real charge for, or null.
 *
 * A candidate has to be the same account and the same direction, and land inside the occurrence's
 * window — from `CLAIM_LEAD_DAYS` before it (a standing order taken on the Friday before the 1st) to
 * the end of the rule's wait. Then either the amount is exactly the rule's, or the name says it is
 * this commitment and the amount is at least in the same league.
 */
export function matchRecurring(db: SqlDriver, tx: Transaction, o: ClaimOptions): RecurringClaim | null {
  if (o.waitDefault <= 0) return null;
  // A transfer moves your own money, and a row that already belongs to a rule has nothing to claim.
  if (tx.deleted || tx.transfer_id || tx.recurring_id) return null;
  const day = tx.date.slice(0, 10);
  const rules = listRows(db, "recurring_rules", "deleted=0 AND active=1 AND account_id=?", [tx.account_id], "next_date") as RecurringRule[];
  for (const rule of rules) {
    const wait = ruleWaitDays(rule, o.waitDefault);
    if (wait <= 0) continue;
    if ((rule.amount_minor < 0) !== (tx.amount_minor < 0)) continue;
    const occ = rule.next_date;
    if (rule.end_date && occ > rule.end_date) continue;
    if (day < addPeriod(occ, "daily", -CLAIM_LEAD_DAYS) || day > claimDeadline(occ, wait)) continue;
    if (tx.amount_minor === rule.amount_minor) return { rule, occurrence: occ };
    const ratio = Math.abs(tx.amount_minor) / Math.max(1, Math.abs(rule.amount_minor));
    if (namesMatch(rule, tx) && ratio <= NAMED_AMOUNT_FACTOR && ratio >= 1 / NAMED_AMOUNT_FACTOR) return { rule, occurrence: occ };
  }
  return null;
}

/**
 * Hand this transaction to the rule it settles: stamp `recurring_id`, fill in what the row does not
 * already say, and move the rule past the occurrence. Returns the claim, or null when nothing
 * matched.
 *
 * Only empty fields are written, never an overwrite — the same rule `fillPending` follows, and for
 * the same reason: whatever the entry already says was decided by something closer to the payment
 * than a rule written months ago. A claimed entry also leaves the pending queue once it has a
 * category, because the rule *is* a decision already made and there is nothing left to ask.
 */
export function claimRecurring(db: SqlDriver, tx: Transaction, o: ClaimOptions): RecurringClaim | null {
  const hit = matchRecurring(db, tx, o);
  if (!hit) return null;
  db.transaction(() => {
    const row = getRow(db, "transactions", tx.id);
    if (!row || row.deleted || row.recurring_id) return;
    const category_id = row.category_id ?? hit.rule.category_id;
    // A subscription is not something the trip bought: travel mode put its tag on the charge because
    // it arrived while away, and claiming it is where that turns out to be wrong. Without it the row
    // may have no tags of its own left, and then the rule's go on as they would have.
    const trips = new Set(tripTagIds(db));
    const own = jsonIds(row.tag_ids).filter((x) => !trips.has(x));
    save(db, "transactions", {
      ...row,
      recurring_id: hit.rule.id,
      category_id,
      tag_ids: own.length ? JSON.stringify(own) : hit.rule.tag_ids,
      pending: category_id ? 0 : row.pending,
    });
    // A rule that did not know how its charge is written now does: the next one is recognised by
    // name, so a price that has changed since no longer keeps it from being claimed.
    const learned = !hit.rule.match_payee && row.payee?.trim() ? { ...hit.rule, match_payee: row.payee.trim() } : hit.rule;
    advanceRule(db, learned, hit.occurrence);
  });
  return hit;
}
