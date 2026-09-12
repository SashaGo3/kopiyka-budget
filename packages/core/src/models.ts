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
}

export interface Tag extends Synced {
  name: string;
  color: string | null;
  /** JSON array of category ids (folder or category) this tag is meant for; [] = any category. */
  category_ids: string;
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
}

export interface Budget extends Synced {
  category_id: string | null; // null = overall budget
  /** Budget for a tag instead of a category: every expense carrying the tag counts (any category). */
  tag_id: string | null;
  currency: string;
  amount_minor: number;
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

export type InsightKind = "savings_goal" | "account_balance" | "free_money" | "days_to_salary" | "checklist" | "subscriptions" | "upcoming" | "regular" | "recurring_spend";

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
