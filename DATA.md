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

One name can be held by **more than one row**: the parts of a split share the receipt that was
photographed once (rule 11). So deleting a row is not a reason to delete its photo — `photoInUse`
(`packages/core/src/repo.ts`) asks whether any live row still points at the file, and only the last
one to let go takes it with them.

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

A budget also carries a `name` of its own (NULL = name it after what it covers), a `sort` for the
order on the screen, and `in_planned`: 0 leaves it on the screen with its own bar but out of Planned,
Available and `freeMoney` — a limit kept as a yardstick rather than money set aside. It is left out
of `freeMoney`'s "is there an overall budget in this currency" question too, or switching an overall
budget off would silently suppress every category budget beside it and show nothing at all.

A budget's scope is a **set**, not one category: `budgets.category_ids` (JSON, `"[]"` = everything),
read through `budgetCategoryIds` and matched with `inBudgetScope` — never by hand, because a budget
written before v12, or restored from a backup of that time, carries its single category in the older
`category_id` column instead. `category_id` is still written, holding the *first* of the set, so such
a row read by an older build is a narrower budget than intended rather than an "everything" one —
which would have silently suppressed every other budget of that currency in `freeMoney`. Keep the two
in step with `scopedBudget` before every save.

A trip's money is the trip's. Travel mode is a one-off budget on a tag (`packages/core/src/trips.ts`),
and whatever carries a trip tag (`tripTagIds`) is left out of every monthly budget — `budgetRows`,
so `freeMoney` and the budget suggestion too — except a budget on that very tag; the Budgets screen's
Spending list shows it as a group of its own instead of inside Food and Taxis. The one thing a trip
never counts is a **recurring payment** (`recurring_id` set): rent and subscriptions go on at home, so
`tripStats` skips them, they stay in the month's budgets even carrying the tag, earlier purchases
cannot be added to a trip from among them, and a charge that claims a rule's occurrence
(`claimRecurring`) drops the trip tag travel mode put on it.

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
`backup_per_day` and the home location until 2026-09-12. Removing one takes its key off the list in
the same breath (on 2026-09-18 `backup_per_day` became `backup_keep_days`, and `language` went with
the language picker — the app is English only); an old backup still carrying the key is ignored on
import, and on 2026-09-20 `shortcut_notify` joined the list, so a restored phone keeps the answer
the old one gave about hearing from the automation; `recurring_wait` and `recurring_wait_days`
joined it on 2026-09-21 with rule 13, and `budgets_sections` (the order of the Budgets screen's
sections) on 2026-09-25. `backup.test.ts` pins the list so the next drift shows up in a
diff.

Keys are deliberately excluded when they describe *this install* rather than your data:
`device_id`, `last_pulled_seq`, `onboarded`, and auto-sync's own bookkeeping (`icloud_sync`,
`sync_seen`, `sync_last_at`, `sync_last_rows` — rule 12). Carrying `sync_seen` onto another phone
would tell it that it had already merged files it has never read.

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

## 11. A split is several entries, not one entry with parts

One shop sells dinner and a lamp, and filing the whole receipt under either is a lie. So the entry
sheet's Split writes **one ordinary transaction per part** (`packages/core/src/split.ts`), all sharing
the account, date, payee, note, place, coordinates and photo, each with its own amount, category and
tags. The entry being edited keeps its id and takes whatever the other parts leave it (rule 1), so
splitting an existing row never detaches its history.

Nothing links the parts afterwards — there is no `split_id`, and there is deliberately nothing to
find: each row is the entry for what it says it is, and behaves like any other from then on. Two
consequences worth holding on to: the parts always add up to the total exactly, because the first
one is the remainder rather than a number of its own; and a foreign original is shared out in the
same proportions (`shareEntered`), with the first part taking the rounding, so a part still shows
what the bank actually charged for it (rule 6).

## 12. Two of your own devices meet in the backup folder

Every device signed in to the same iCloud account backs up into the same container, so the container
is a shared inbox and auto-sync is the other half of it: `pullFromCloud` (`apps/mobile/src/lib/backup.ts`)
lists the files, reads the ones this install has never read, and imports each one with **merge**.

Merge is the whole safety argument (rule 2). Nothing is deleted, and a row is written only when the
file's copy is newer, so whatever was typed on *this* device in the meantime survives. Deletions
still travel, because an automatic backup carries tombstones (rule 8) and a tombstone is a newer row.
Settings are left alone (`applySettings: false`): `current_account`, `budget_scope` and the rest say
what this device is showing, and a background merge has no business moving another phone's furniture.

Three things follow, and each is load-bearing:

- **"Never read" is a set of file names (`sync_seen`), not a high-water mark.** Two devices stamp
  names from their own clocks, so a file written while this phone was offline can be *older* than
  the phone's own latest one; a timestamp cutoff would skip it silently and forever. The first run
  seeds the set with everything already in the container — that is this install's own history, and
  merging a month of our own backups back in is a lot of work to change nothing.
- **Retention may not delete a file that has not been merged.** `retentionPlan` is per container and
  another device's backup lives in the same one, so while auto-sync is on only files in `sync_seen`
  are allowed to age out. Otherwise tidying up on one phone could throw away the only copy of what
  the other one did.
- **A merge that imported nothing must not count as a change.** `notifyChange()` is called only when
  rows were actually written; otherwise the database would be marked dirty, a backup about nothing
  would be written, and the other device would have a new file to merge back — for ever.

And one thing it cannot do: `replace` is local. A replace deletes rows outright rather than
tombstoning them (rule 2), so the other device's next backup will hand them straight back. Replace on
each device, or turn merging off while you do it.

## 13. A rule can wait for the bank instead of writing the payment itself

With the notification automation running, a subscription is written twice: once by the recurring rule
on the day it was arranged for, once by the bank's own message when the money actually moves. Waiting
turns that around, and it is off by default — with `recurring_wait` off nothing waits and every rule
behaves exactly as it did before.

On, the rule posts nothing on its day. The charge that arrives claims the occurrence
(`claimRecurring`, `packages/core/src/claim.ts`): it takes the rule's id in `recurring_id`, the
category and tags the rule already decided — only into fields the row leaves empty, the same rule
`fillPending` follows — and moves `next_date` on. The row that survives carries the **bank's** amount
and the **bank's** day, which is what makes a subscription that went up in price file itself
correctly. Only when the window closes with nothing to claim does the rule act: `auto_post` rules
post their own amount, manual ones reach the confirm queue, both later than before and only when it
is actually needed.

Three things are load-bearing:

- **Only the earliest unposted occurrence is claimable.** A rule several periods behind has that
  backlog in the queue; letting one charge jump to the newest occurrence would settle the arrears by
  forgetting them.
- **The window has two ends.** From `CLAIM_LEAD_DAYS` before the occurrence (a standing order taken
  on the Friday before the 1st) to `wait_days` after it. `wait_days` is NULL for "whatever the
  app-wide default says" and at least 1 otherwise — there is no per-rule 0, because the setting that
  turns waiting on is the switch, and a stored 0 falls back to the default rather than quietly
  opting one rule out.
- **A name beats an amount.** `recurring_rules.match_payee` is the shop as the *bank* prints it
  ("NETFLIX.COM AMSTERDAM" for a rule you called "Netflix"), set by pointing the rule at a payment
  that already happened and learned from the first charge that claims an occurrence. With a name the
  charge is recognised whatever it costs this time; without one only the exact amount identifies it.

## 14. Archived is not deleted

A category or a tag can be retired (`archived=1`) instead of deleted, because what was filed under it
is the reason not to delete it. Nothing already written changes, and nothing stops being counted:
budgets, charts and every total read the same numbers as before. What changes is that it is no longer
*offered*.

Archiving a folder retires the categories inside it, so "may I file into this" is one question and
every caller asks it through `archivedCategoryIds` (`packages/core/src/repo.ts`) rather than testing
`archived` and forgetting the folder.

Where it is enforced: both category pickers and the tag picker (each keeping whatever the row already
carries, or the sheet would claim a transaction has no category at all), `tagsForCategory`,
`suggestCategoryAt` — and, deliberately, `payeeHistory`. A shop whose category has since been
archived comes back with **no** category and no `match`, so the payment the automation writes lands in
the Pending queue for you to file under whatever replaced it, rather than being filed silently
somewhere the app will not even offer. The watch, the App Intents and the receipt reader are sent
archived rows *with a flag* — a history row still has to print the name it was filed under — and the
filtering happens in one place on the other side, `KPRank.categories` / `KPRank.tags`.

Two things are refused rather than discovered later: a tag that travel mode is using right now (the
trip is applying it to everything you log — end the trip first), and nothing else. Recurring rules
carrying the tag are named in the confirmation instead of blocked; they go on writing it, which is
odd but not wrong.

## 15. A folder answers for its categories

`categories.importance` — 0 unset, 1 low, 2 medium, 3 high (v16) — is how much a category matters,
which only a person can say and nothing can be derived from. A category left at **0 inherits its
folder's mark**, and that inheritance is the point: mark "Subscriptions" once and the twelfth thing
added to it next year is already answered.

So it is read through **one** function, `categoryImportance` (`packages/core/src/importance.ts`),
never off the column — the same arrangement as `archivedCategoryIds` (rule 14), and for the same
reason: a folder-level mark honoured by three callers and ignored by the fourth is worse than no
mark at all.

The flow that sets it (`app/category/importance.tsx`) asks two questions — what you could not live
without, then, of what is left, what you could stop tomorrow — and everything neither answer claimed
is Medium. Medium is deliberately not askable: as a third question it is where everything you did
not want to think about goes, and by elimination it honestly means "the things in between". It also
makes High-and-Low-at-once unreachable rather than a contradiction settled by some arbitrary rule.

Two things the writer must keep doing:

- **A level that covers a whole folder is written on the folder, and its categories cleared to 0.**
  Stamping the children instead would freeze them against the folder ever changing its mind. A
  folder whose categories disagree keeps no mark, so the next one added to it lands in the "not
  marked" count rather than quietly taking a side.
- **Rows the marking would not change are not written** (`importanceAffected`). Forty categories
  marked at once on one of two phones is the exact shape of the bug in rule 2: an untouched row with
  a fresh `updated_at` wins a merge it should have lost.

Like `archived`, importance is a fact about the category and not about the money: it filters
nothing, hides nothing and changes no total.

## Handing an export to an AI to restructure

The workflow this is written for: export, have a model reorganise categories/tags/folders, import
back. What to tell it:

1. **Keep every `id`** you are not deliberately deleting (rule 1).
2. Rename and re-parent freely — `parent_id` is how a category joins a folder, and a folder is just a
   category with children (rule 5).
3. Do not touch `rates`, `settings`, or any `photo` field (rules 3, 4, 7).
4. Leave `amount_minor` and every transaction alone unless the point of the pass is the transactions.
   Leave `importance` alone too, or say nothing about it: a column the file omits keeps whatever the
   phone already had, but an `importance: 0` written over a marked category erases an answer only a
   person could give (rule 15).
5. Import with **Replace everything**, not Merge — otherwise the categories it removed survive
   (rule 2), and `updated_at` would have to be raised on every edited row for merge to take them.
6. The safety copy is written automatically; its name is in the result. Keep it until you are happy.
