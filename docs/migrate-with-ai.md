# Migrating from another app (with an AI's help)

Kopiyka imports one thing: its own backup format, a single JSON file. There is no importer for other
apps' exports on purpose — every app exports something different, and a converter that is right
for one export is wrong for the next. What works instead: export from your old app, hand that file
and the prompt below to an AI assistant (Claude, ChatGPT, a local model — anything that can read a
file and write JSON), and import the result.

The whole thing takes a few minutes. Your data goes wherever you send it and nowhere else; if that
matters to you, use a local model, or ask the assistant for a script and run it yourself.

## Steps

1. **Export from your old app.** CSV is ideal; JSON or XLSX also work. You want *transactions* with
   date, amount, currency, account, category and (if you have them) notes, tags and transfers.
2. **Open a chat with an AI assistant**, attach the export, and paste the prompt from the next
   section. Read its questions — it will usually need to know your base currency and how transfers
   are represented.
3. **Save the answer as `kopiyka-import.json`** (the assistant may offer a file; if it prints JSON,
   copy everything between the outer braces).
4. **Get the file onto your phone** — AirDrop, iCloud Drive, Files.
5. In Kopiyka: **Settings → Data management → Import → Replace everything with a file** (on a fresh
   install) or **Merge** (to add to what is already there). The app writes a safety backup before a
   replace and tells you where it is.
6. Check a few months in Transactions and the account balances under Settings → Accounts. If a
   balance is off, the export had no opening balance: set `opening_balance_minor` on that account
   in the JSON (or edit the account in the app) so the balance today matches your bank.

## The prompt

Copy this whole block. Attach your export in the same message.

````text
I am moving my personal finance history into an app called Kopiyka. It imports one file format,
described below. Please convert the attached export into that format.

Before you write anything, ask me (in one message) about anything you cannot infer from the file:
my base currency, how transfers between my accounts appear in the export, whether categories are
nested (folder › category), and the time zone to use if dates have no offset.

Then produce ONE JSON document that follows the specification exactly. Rules:

- Keep every transaction. Do not summarise, sample, or drop rows. If a row cannot be converted,
  list it at the end of your reply instead of silently skipping it.
- Money is integers in minor units of the *account's* currency (cents, groszy, kopiykas):
  12.34 EUR → 1234. Expenses are negative, income positive.
- Every row needs an `id`: use a fresh UUID v4 for each row, and reuse the same id everywhere that
  row is referenced (account_id, category_id, parent_id, tag_ids). Never derive an id from a name.
- Categories: one row per category. A folder is simply a category whose `parent_id` is null and
  that has other categories pointing at it. Transactions must point at the innermost category,
  never at a folder. If the export has a flat category list, make them all top-level.
- Tags: one row per distinct tag; a transaction's `tag_ids` is a JSON array *string* of tag ids,
  e.g. "[\"…\",\"…\"]" (an empty list is "[]").
- Transfers: an export usually has either one row with a source and a target account, or two rows
  (money out, money in). Produce two transactions — negative on the source account, positive on
  the destination, each in its own account's currency — sharing one new `transfer_id`, with
  `category_id` null. If the two legs are in different currencies, set `entered_amount_minor`,
  `entered_currency` and `exchange_rate` on the destination leg as described below.
- Dates are ISO 8601 with an offset: "2026-03-17T16:28:39+01:00". If the export has only a day,
  use 12:00:00 in the time zone I gave you. `updated_at` is epoch milliseconds — use the export
  time (now) for every row. `deleted` is always 0.
- Recurring rules, budgets, debts and insights are optional. Include recurring rules only if the
  export clearly has them (subscriptions with a period); otherwise leave the arrays empty and I
  will set them up in the app.
- `settings.base_currency` is my base currency. Leave `rates` as an empty array unless the export
  contains exchange rates.
- Output the JSON and nothing else in that code block. Pretty-print with 1 space of indentation.

=== SPECIFICATION: Kopiyka backup JSON ===

{
 "format": "kopiyka-backup",          // exactly this
 "version": 1,
 "exported_at": "2026-09-12T10:00:00.000Z",
 "settings": { "base_currency": "EUR" },
 "accounts": [ Account ],
 "categories": [ Category ],
 "tags": [ Tag ],
 "transactions": [ Transaction ],
 "recurring_rules": [ RecurringRule ],  // may be []
 "budgets": [],                          // may be []
 "insights": [],                         // may be []
 "debts": [],                            // may be []
 "rates": []                             // may be []
}

Every row in every table has these three fields:
  id: string (UUID v4)   updated_at: integer (epoch ms)   deleted: 0

Account {
  name: string
  currency: string                 // ISO 4217, "EUR", "USD", "PLN", "UAH" …
  type: "cash" | "bank" | "card" | "investment" | "savings" | "other"
  group_name: string               // a heading the accounts are listed under; "Personal" if the export has none
  icon: string | null              // SF Symbol name, e.g. "creditcard.fill", "banknote.fill", "building.columns.fill"; null is fine
  color: string | null             // "#RRGGBB" or null
  sort: integer                    // display order, 0, 1, 2 …
  archived: 0 | 1
  include_in_net_worth: 0 | 1      // 1 unless it is a loan/credit account you exclude
  opening_balance_minor: integer   // balance before the first transaction in the file; 0 if unknown
}

Category {
  name: string
  parent_id: string | null         // id of the folder category, or null for a top-level one
  icon: string | null              // SF Symbol name or null
  color: string | null             // "#RRGGBB" or null
  sort: integer
  kind: "expense" | "income"
  description: string | null       // optional words that describe what belongs here
}

Tag {
  name: string
  color: string | null
  category_ids: string             // JSON array string of category ids the tag is meant for; "[]" = any
}

Transaction {
  account_id: string
  date: string                     // ISO 8601 with offset
  amount_minor: integer            // minor units of the account's currency; negative = expense
  category_id: string | null       // innermost category; null for transfers or uncategorised rows
  payee: string | null             // shop or counterparty, if the export separates it from the note
  notes: string | null             // the note / description
  tag_ids: string                  // JSON array string of tag ids, "[]" if none
  pending: 0 | 1                   // 0 for history
  transfer_id: string | null       // same new UUID on both legs of a transfer, else null
  entered_amount_minor: integer | null   // only when the payment was in another currency: the amount as charged
  entered_currency: string | null        // … and its currency
  exchange_rate: number | null           // entered units per 1 account unit (entered_amount / amount)
  recurring_id: string | null      // id of a recurring rule that produced this row, else null
  lat: number | null               // where it was logged, if known
  lon: number | null
  place: string | null             // human name of that place
  photo: null                      // receipt photos cannot be imported this way
  source: null
}

RecurringRule {
  account_id: string
  amount_minor: integer            // negative = expense
  category_id: string | null
  payee: string | null
  notes: string | null
  tag_ids: string                  // "[]" if none
  frequency: "daily" | "weekly" | "monthly" | "yearly"
  interval: integer                // 1 = every period, 2 = every second period …
  start_date: string               // "YYYY-MM-DD"
  end_date: string | null
  next_date: string                // "YYYY-MM-DD", the first occurrence not yet posted (after today)
  notify: 0 | 1
  notify_days_before: integer
  auto_post: 0 | 1                 // 1 = posts itself on the day; 0 = asks first
  active: 0 | 1
  time_of_day: string              // "HH:MM"
}

=== EXAMPLE (two accounts, a folder with one category, a tag, one expense and one transfer) ===

{
 "format": "kopiyka-backup",
 "version": 1,
 "exported_at": "2026-09-12T10:00:00.000Z",
 "settings": { "base_currency": "EUR" },
 "accounts": [
  { "id": "5f1a2b3c-0001-4a00-8000-000000000001", "updated_at": 1757671200000, "deleted": 0,
    "name": "Main", "currency": "EUR", "type": "bank", "group_name": "Personal", "icon": "building.columns.fill",
    "color": "#2B2B2E", "sort": 0, "archived": 0, "include_in_net_worth": 1, "opening_balance_minor": 250000 },
  { "id": "5f1a2b3c-0001-4a00-8000-000000000002", "updated_at": 1757671200000, "deleted": 0,
    "name": "Cash", "currency": "EUR", "type": "cash", "group_name": "Personal", "icon": "banknote.fill",
    "color": null, "sort": 1, "archived": 0, "include_in_net_worth": 1, "opening_balance_minor": 0 }
 ],
 "categories": [
  { "id": "5f1a2b3c-0002-4a00-8000-000000000001", "updated_at": 1757671200000, "deleted": 0,
    "name": "Food", "parent_id": null, "icon": "cart.fill", "color": "#FF9F0A", "sort": 0, "kind": "expense", "description": null },
  { "id": "5f1a2b3c-0002-4a00-8000-000000000002", "updated_at": 1757671200000, "deleted": 0,
    "name": "Groceries", "parent_id": "5f1a2b3c-0002-4a00-8000-000000000001", "icon": "cart.fill", "color": "#FF9F0A",
    "sort": 1, "kind": "expense", "description": "supermarket, market, bakery" }
 ],
 "tags": [
  { "id": "5f1a2b3c-0003-4a00-8000-000000000001", "updated_at": 1757671200000, "deleted": 0,
    "name": "Weekend", "color": "#30D158", "category_ids": "[]" }
 ],
 "transactions": [
  { "id": "5f1a2b3c-0004-4a00-8000-000000000001", "updated_at": 1757671200000, "deleted": 0,
    "account_id": "5f1a2b3c-0001-4a00-8000-000000000001", "date": "2026-09-06T18:42:00+01:00", "amount_minor": -2350,
    "category_id": "5f1a2b3c-0002-4a00-8000-000000000002", "payee": "Pingo Doce", "notes": null,
    "tag_ids": "[\"5f1a2b3c-0003-4a00-8000-000000000001\"]", "pending": 0, "transfer_id": null,
    "entered_amount_minor": null, "entered_currency": null, "exchange_rate": null, "recurring_id": null,
    "lat": null, "lon": null, "place": null, "photo": null, "source": null },
  { "id": "5f1a2b3c-0004-4a00-8000-000000000002", "updated_at": 1757671200000, "deleted": 0,
    "account_id": "5f1a2b3c-0001-4a00-8000-000000000001", "date": "2026-09-07T09:00:00+01:00", "amount_minor": -10000,
    "category_id": null, "payee": null, "notes": "ATM", "tag_ids": "[]", "pending": 0,
    "transfer_id": "5f1a2b3c-0005-4a00-8000-000000000001",
    "entered_amount_minor": null, "entered_currency": null, "exchange_rate": null, "recurring_id": null,
    "lat": null, "lon": null, "place": null, "photo": null, "source": null },
  { "id": "5f1a2b3c-0004-4a00-8000-000000000003", "updated_at": 1757671200000, "deleted": 0,
    "account_id": "5f1a2b3c-0001-4a00-8000-000000000002", "date": "2026-09-07T09:00:00+01:00", "amount_minor": 10000,
    "category_id": null, "payee": null, "notes": "ATM", "tag_ids": "[]", "pending": 0,
    "transfer_id": "5f1a2b3c-0005-4a00-8000-000000000001",
    "entered_amount_minor": null, "entered_currency": null, "exchange_rate": null, "recurring_id": null,
    "lat": null, "lon": null, "place": null, "photo": null, "source": null }
 ],
 "recurring_rules": [],
 "budgets": [],
 "insights": [],
 "debts": [],
 "rates": []
}
````

## Checking the result before you import

- It must start with `"format": "kopiyka-backup"` and have an `accounts` array, or the app rejects
  it with "Not a Kopiyka backup".
- Every `account_id` / `category_id` / `parent_id` / tag id must exist in the file. The app does not
  verify this on import: a transaction pointing at an unknown account shows up nowhere and counts in
  no balance.
- Amounts must be integers. `12.34` is wrong; `1234` is right.
- Transfers must be two rows with the same `transfer_id` and opposite signs.
- If you ran the conversion twice, import only the last file: ids are freshly generated each time,
  so importing both would double everything. (If you *do* want to re-import a corrected version,
  use *Replace everything* — merge never deletes, so the old rows would stay.)

The full set of rules the importer follows — ids are the identity, merge never deletes, replace does,
exchange rates are never dropped — is in [DATA.md](../DATA.md) at the repository root. A rendered
example of a complete backup with budgets, rules, trips and debts is the demo dataset the screenshots
use: `apps/mobile/screenshots/demo/kopiyka-demo.json`.
