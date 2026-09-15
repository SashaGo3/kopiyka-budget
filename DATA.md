# Rules for anything that touches the data

Read this before writing code that imports, exports, merges, deletes or rewrites rows — and before
handing an export to a tool (or an AI) to restructure. Every rule here is enforced somewhere; the
file that enforces it is named so you can check rather than trust.

## 1. The id is the identity

Every synced table merges and replaces **by `id`**. Nothing is matched by name, ever.

So a tool that rewrites an export must **keep the `id` of every row it is not deleting**. Rename a
category, move it to another folder, change its colour — keep the id and every transaction pointing
at it follows along. Give it a fresh id and you have described a *different* category: the old one is
deleted and the new one starts empty, and the history detaches.

Generating new ids is right in exactly one case: a row that genuinely did not exist before.

## 2. Merge is the default and never deletes; replace makes the file the truth

`importBackup(db, file, { mode })` — `packages/core/src/backup.ts`.

- **`merge`** (default, and what a routine restore does): a row is written when the file's copy is
  newer (`updated_at`), and **nothing is ever deleted**. Two devices, or a phone and an old backup,
  converge. A category you removed from the file simply stays on the phone.
- **`replace`**: the file's rows are written *even when the phone's copy is newer*, and every row the
  file does not mention is deleted outright. This is the mode for an export you restructured
  elsewhere, where the point is that the categories you removed actually go.

Consequences worth holding on to:

- Editing a row in an export and re-importing with **merge** does nothing unless you also raise its
  `updated_at`. The phone's copy is newer, so the phone wins. This is not a bug to work around; it is
  what stops an old backup from undoing recent work.
- **Replace is destructive and needs a way back before it runs, not after.** Settings → Data
  management → "Replace everything with a file" writes a backup first and names it in the result; if
  that copy cannot be written it says so and makes the user confirm there is no way back. Undoing a
  replace is the same operation pointed at that copy — which is why "Restore from a backup" offers
  Replace as well as Merge. A merge-only restore could not undo a replace: it would re-add the old
  rows and leave every new one in place.

## 3. Exchange rates are history, not a cache

`exchange_rates` is keyed `(base, quote, day)` and looked up **by day** (`cachedRate`), so the row for
the day of a 2021 transfer is what still converts it correctly today. Some of it cannot be fetched
again — the rate source covers a fixed currency list only so far back, and a rate entered by hand was
never fetched at all.

Therefore: rates travel with every backup, `replace` **never** deletes them, and on import the newer
`fetched_at` wins so an old backup cannot undo a rate the phone has since learned. A tool rewriting
categories has no business touching rates; omitting the key from a file leaves them alone.

## 4. Photos live outside the database, keyed by file name

`transactions.photo` holds a file name, never an image. The file is in the app's Documents, written
once under a name nobody reuses and never modified (`apps/mobile/src/lib/photos.ts`). That
immutability is what the rest relies on:

- backups mirror each photo **once** into iCloud Drive → Kopiyka → Photos (`lib/backup.ts`),
- a Bundle (ZIP) carries `photos/<name>.jpg` beside `backup.json`, and the name in the row *is* the
  index (`packages/core/src/bundle.ts`).

So changing `photo` to a name nothing wrote orphans the image, and clearing it strands the file. If
you ever need to rewrite photo names, move the files in the same pass.

## 5. A folder is not a category and nothing is filed into one

A folder is a category that has (live) categories inside it — `folderIds` in
`packages/core/src/repo.ts`. A top-level category with nothing inside it is an ordinary category and
stays pickable, so a flat database is never left with nothing to choose.

Transactions, intents, the watch and the receipt reader all filter through that rule. **Budgets are
the deliberate exception**: a budget on a folder counts every category inside it, which is why the
budget sheet picks through `/pick/categories` — the multi-picker, which resolves a fully ticked
folder back to the folder's own id, so the budget keeps meaning "this folder, including whatever is
added to it later". Any new caller has to decide which of the two it is: does the answer end up on a
transaction (folders out) or on a budget/insight/tag scope (folders in)?

A budget's scope is a **set**, not one category: `budgets.category_ids` (JSON, `"[]"` = everything),
read through `budgetCategoryIds` and matched with `inBudgetScope` — never by hand, because a budget
written before v12, or restored from a backup of that time, carries its single category in the older
`category_id` column instead. `category_id` is still written, holding the *first* of the set, so such
a row read by an older build is a narrower budget than intended rather than an "everything" one —
which would have silently suppressed every other budget of that currency in `freeMoney`. Keep the two
in step with `scopedBudget` before every save.

## 6. Money is integers, in minor units

`amount_minor` is minor units of the **account's** currency, negative for an expense. Never a float.

For a payment the bank charged in another currency, the original is kept in `entered_amount_minor` /
`entered_currency` / `exchange_rate` so the conversion can be checked and corrected. When no rate is
known the amount is **0** and the note says so — deliberately, because a zero cannot distort a total
and the entry sheet refuses to save at zero, whereas writing the foreign number as if it were the
account's currency silently inflates the month.

## 7. Preferences live in `meta`, and only some of them travel

Adding a preference means adding its key to `BACKUP_META_KEYS` (`packages/core/src/backup.ts`) or it
is silently lost on restore — which is exactly what happened to `hide_income`, `show_balance`,
`backup_per_day` and the home location until 2026-09-12. `backup.test.ts` pins the list so the next
drift shows up in a diff.

Three keys are deliberately excluded because they describe *this install* rather than your data:
`device_id`, `last_pulled_seq`, `onboarded`.

## 8. Tombstones are rows

`deleted=1` is a row, not an absence. Automatic iCloud backups include them (`includeDeleted: true`)
so a merge restore propagates deletions; the manual JSON export and the Bundle carry live rows only,
which is fine because `replace` deletes by absence anyway. Do not "tidy" tombstones out of a file
that a merge will read — the deletion would be forgotten and the row would come back.

## 9. `source` records where a row came from, and how sure it is

`"shortcut"` (a notification automation), `"shortcut-guess"` (the same, but its category was guessed
from the shop's name rather than filed before — the Pending queue shows it in the tint colour with
"· guess"), `"receipt"`, `"watch"`, `"siri"`, or `null` for hand-entered. A guess never skips the
Pending queue; only history does.

## 10. Never write the database file from outside the running app

While the JS runtime owns `kopiyka.db`, native code must not open it — not even read-only. expo-sqlite
bundles its own SQLite and the system copy cannot see its locks; the system copy takes the WAL DMS
lock, believes it is the first connection and truncates the `-shm` file that JS has mmapped. That is a
SIGBUS, and it cost real data once already (2026-09-08/09).

The same goes for tooling: never point the `sqlite3` CLI at a simulator's or device's live database.
Create and remove test rows through the core API (`bun -e` with `openBunDb` + `createTransaction` /
`remove`) or through the app, and clean up afterwards.

## Handing an export to an AI to restructure

The workflow this is written for: export, have a model reorganise categories/tags/folders, import
back. What to tell it:

1. **Keep every `id`** you are not deliberately deleting (rule 1).
2. Rename and re-parent freely — `parent_id` is how a category joins a folder, and a folder is just a
   category with children (rule 5).
3. Do not touch `rates`, `settings`, or any `photo` field (rules 3, 4, 7).
4. Leave `amount_minor` and every transaction alone unless the point of the pass is the transactions.
5. Import with **Replace everything**, not Merge — otherwise the categories it removed survive
   (rule 2), and `updated_at` would have to be raised on every edited row for merge to take them.
6. The safety copy is written automatically; its name is in the result. Keep it until you are happy.
