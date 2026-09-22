/** Fields present on every synced row. updated_at is epoch ms; deleted is a tombstone. */
export interface Synced {
  id: string;
  updated_at: number;
  deleted: 0 | 1;
}

export type AccountType = "cash" | "bank" | "card" | "investment" | "savings" | "other";

/**
 * Every account belongs to a group: the scope picker, the Accounts screen and the account pickers
 * are all organised by it, and a group of one is still a group.
 * Accounts that name none get this one — the v9 migration moved the existing ones here too, so
 * renaming this constant does not rewrite what is already in a database.
 */
export const DEFAULT_ACCOUNT_GROUP = "Personal";

/**
 * When a debt reminder fires, unless the debt says otherwise. Early enough to act on the day it
 * is due, late enough not to wake anyone. The v10 migration spells it out separately, so changing
 * this moves only debts written from here on.
 */
export const DEFAULT_DEBT_NOTIFY_TIME = "08:00";

export interface Account extends Synced {
  name: string;
  currency: string;
  type: AccountType;
  group_name: string;
  icon: string | null;
  color: string | null;
  sort: number;
  archived: 0 | 1;
  include_in_net_worth: 0 | 1;
  /** Balance before the first recorded transaction, in minor units. */
  opening_balance_minor: number;
}

export interface Category extends Synced {
  name: string;
  parent_id: string | null;
  icon: string | null;
  color: string | null;
  sort: number;
  kind: "expense" | "income";
  /** What belongs here, in the user's words; the receipt scanner matches against it. */
  description: string | null;
  /**
   * Retired: still the category of everything already filed under it, and still counted everywhere
   * money is counted, but no longer offered when anything new is filed. A folder that is archived
   * takes the categories inside it with it (`archivedCategoryIds`), because a category you cannot
   * reach is not one you can file into.
   */
  archived: 0 | 1;
  /**
   * How much this matters: 0 unset, 1 low, 2 medium, 3 high. A category left at 0 inherits its
   * folder's answer, which is the point of marking a folder — read it through `categoryImportance`
   * rather than off the row, or a folder-level mark will be honoured by three callers and ignored
   * by the fourth. Not a filter: it hides nothing and changes no total.
   */
  importance: Importance;
}

/** 0 unset, 1 low, 2 medium, 3 high. */
export type Importance = 0 | 1 | 2 | 3;

export interface Tag extends Synced {
  name: string;
  color: string | null;
  /** JSON array of category ids (folder or category) this tag is meant for; [] = any category. */
  category_ids: string;
  /** Retired: kept on every transaction that carries it, never offered for a new one. */
  archived: 0 | 1;
}

export interface Transaction extends Synced {
  account_id: string;
  /** ISO 8601 with offset, e.g. 2026-03-17T16:28:39+01:00 */
  date: string;
  /** Minor units in the account currency. Negative = expense. */
  amount_minor: number;
  category_id: string | null;
  payee: string | null;
  notes: string | null;
  /** JSON array of tag ids */
  tag_ids: string;
  pending: 0 | 1;
  /** Both legs of a transfer share this id. */
  transfer_id: string | null;
  /** For cross-currency entries: what the user typed, and the rate used (entered units per 1 account unit). */
  entered_amount_minor: number | null;
  entered_currency: string | null;
  exchange_rate: number | null;
  recurring_id: string | null;
  /** Coarse location where the transaction was logged, if the user allowed it. */
  lat: number | null;
  lon: number | null;
  /** Optional human name for the place (reverse geocoded, best effort). */
  place: string | null;
  /** File name of an attached photo (see apps/mobile/src/lib/photos.ts); the file is device-local for now. */
  photo: string | null;
  /**
   * Where the row came from: "shortcut" (a notification automation), "shortcut-guess" (the same, but
   * its category was guessed from the shop's name rather than filed before — the Pending queue says
   * so), "receipt", "watch", "siri", or null for hand-entered.
   */
  source: string | null;
  /**
   * Money that came back on this very row: you paid the whole table, someone handed you their share,
   * and the expense is smaller than what left the account at the till. Signed minor units in the
   * account currency, always opposite in sign to `amount_minor`, and summed over every return booked
   * so far — so what was originally paid is `amount_minor - refunded_minor` and no second row has to
   * remember it. 0 on everything that never had a return (see `packages/core/src/returns.ts`).
   */
  refunded_minor: number;
}

export type Frequency = "daily" | "weekly" | "monthly" | "yearly";

export interface RecurringRule extends Synced {
  account_id: string;
  amount_minor: number;
  category_id: string | null;
  payee: string | null;
  notes: string | null;
  tag_ids: string;
  frequency: Frequency;
  interval: number;
  /** YYYY-MM-DD of the first occurrence */
  start_date: string;
  end_date: string | null;
  /** YYYY-MM-DD of the next occurrence not yet posted */
  next_date: string;
  notify: 0 | 1;
  notify_days_before: number;
  /** Post automatically when due, instead of asking to confirm. */
  auto_post: 0 | 1;
  active: 0 | 1;
  /** HH:MM local time used for the posted transaction and the reminder. */
  time_of_day: string;
  /**
   * How many days this rule waits for the bank's own charge to turn up before acting on its own —
   * at least 1. `null` means "whatever the app-wide default says" (`recurring_wait_days`), which is
   * what a rule normally carries; a number is this one rule wanting a longer or shorter rope. There
   * is no per-rule way to switch waiting off, because the setting that turns it on is the switch:
   * with it off nothing waits at all and every rule behaves as it did before waiting existed.
   * While a rule waits, the real charge claims the occurrence (`claimRecurring`) and no second row
   * is written; see `ruleWaitDays`.
   */
  wait_days: number | null;
  /**
   * The name this rule's charge arrives under, as the bank prints it — "NETFLIX.COM AMSTERDAM" for a
   * rule you called "Netflix". Set by pointing the rule at a payment that already happened, and
   * learned from the first charge that claims an occurrence when it is still empty. With a name, a
   * charge is recognised whatever it costs this time (a price rise, a heating bill in January);
   * without one only the exact amount can identify it. Never used for anything but matching: the
   * rule is still called `payee`.
   */
  match_payee: string | null;
}

export interface Budget extends Synced {
  /**
   * The categories (or folders) this budget counts, as a JSON array; `"[]"` is an overall budget.
   * A folder id counts everything inside it, future categories included — the deliberate exception
   * to "nothing is filed into a folder" (DATA.md rule 5). Read it through `budgetCategoryIds`,
   * never directly: rows written before this was a set carry their one category in `category_id`.
   */
  category_ids: string;
  /** The first of `category_ids`, kept in step with it so older builds still read the budget as scoped. */
  category_id: string | null;
  /** Budget for a tag instead of a category: every expense carrying the tag counts (any category). */
  tag_id: string | null;
  currency: string;
  amount_minor: number;
  /**
   * What to call it. NULL means "name it after what it covers", which is what every budget did
   * before there was a name: the categories, the tag, or "Everything". A name of its own is for the
   * budget whose scope does not explain it — three categories that are really "the car".
   */
  name: string | null;
  /** Position on the Budgets screen. Equal values keep the order they were already in. */
  sort: number;
  /**
   * Counts towards Planned and Available. 0 leaves the budget on the screen, with its own bar and
   * its own spending, but out of the two numbers at the top — for a limit you keep as a yardstick
   * rather than as money you have set aside. `freeMoney` (and so "days to salary") honours it too:
   * a budget you do not count is not part of what you have free.
   */
  in_planned: 0 | 1;
  /** "monthly" renews every period; "once" is a one-off pot (a trip) that runs from `starts` until it is ended. */
  period: "monthly" | "once";
  /** YYYY-MM-DD, budget applies from this month on until superseded (monthly), or the first day of the trip (once). */
  starts: string;
  /** Day of month the budget period begins (1 = calendar month, 15 = salary day). */
  start_day: number;
  /** null = budget for all accounts; otherwise only that account's spending counts and it is shown only in that scope. */
  account_id: string | null;
  /** Once only: planned last day (YYYY-MM-DD) used for the daily allowance. */
  ends: string | null;
  /** Once only: day the trip was actually ended; null while travel mode is on. */
  ended: string | null;
}

export type InsightKind = "savings_goal" | "account_balance" | "free_money" | "days_to_salary" | "checklist" | "subscriptions" | "upcoming" | "regular" | "recurring_spend" | "values" | "safety_buffer" | "safe_to_spend";

/** A user-added statistics card on the Insights tab. `params` is JSON, shape depends on `kind`. */
export interface Insight extends Synced {
  kind: InsightKind;
  params: string;
  sort: number;
}

/** "owed_to_me": someone owes the user. "i_owe": the user owes someone. */
export type DebtDirection = "owed_to_me" | "i_owe";

/** Money lent or borrowed. Not a transaction: it only becomes one when it is actually paid. */
export interface Debt extends Synced {
  person: string;
  direction: DebtDirection;
  /** Always positive; `direction` carries the sign. */
  amount_minor: number;
  currency: string;
  /** Where the money moved, if the user said; also the account a settling transaction is written to. */
  account_id: string | null;
  /** YYYY-MM-DD the debt started. */
  opened_date: string;
  /** YYYY-MM-DD it is due back, or null for open-ended. Reminders are built from it (`notify_time`). */
  due_date: string | null;
  notes: string | null;
  /** YYYY-MM-DD it was paid back; null while it is still open. */
  settled_date: string | null;
  notify: 0 | 1;
  /** HH:MM (device local) the reminders fire at. */
  notify_time: string;
  /** The transaction written when it was settled, if one was. */
  transaction_id: string | null;
}

export const SYNCED_TABLES = ["accounts", "categories", "tags", "transactions", "recurring_rules", "budgets", "insights", "debts"] as const;
export type SyncedTable = (typeof SYNCED_TABLES)[number];

export interface RowByTable {
  accounts: Account;
  categories: Category;
  tags: Tag;
  transactions: Transaction;
  recurring_rules: RecurringRule;
  budgets: Budget;
  insights: Insight;
  debts: Debt;
}
