# How it works

The parts of Kopiyka that are not obvious from a screen: where the data lives, how backups behave,
and how an expense gets in without the app being open. The rules that keep the data safe across all
of it are in [DATA.md](../DATA.md).

## iCloud backups (phone)

The app writes a full backup (accounts, categories, tags, transactions, recurring rules, budgets,
insights, debts, preferences; the same JSON as Settings → Data management → Export) into its iCloud
container, shown in Files as **iCloud Drive → Kopiyka → Backups → `<day>`**. Every device signed in
to the same iCloud account sees the files; Settings → Data management → **Restore from a backup**
lists them and merges one in (newer rows win, nothing is deleted).

- A backup is written 20 s after the last change, at most every 5 minutes, when the app goes to the
  background with unsaved changes, and at least once a day when the app is opened.
- Each day keeps up to 7 files (Settings → Data management → Backups per day: 1–24): the day's first
  backup plus the newest ones. Days older than 30 are removed. Automatic backups are compact (null
  fields dropped, tombstones older than 30 days shrunk); the manual JSON export is complete. The
  policy lives in `packages/core/src/backupSchedule.ts`.
- With iCloud Drive off, backups stay in the app's Documents folder (Files → On My iPhone → Kopiyka).
- **Receipt photos** are mirrored *beside* the backups, in **iCloud Drive → Kopiyka → Photos**, not
  inside them. A photo file is written once under a name nobody reuses and never changed, so one copy
  serves every backup that mentions it; base64 in the JSON would re-upload every photo several times a
  day. Up to 25 are copied after each backup and the rest follow on later ones, so a phone with a
  backlog catches up on its own — Settings → Data management → **Receipt photos** shows how many are
  left and copies the rest on a tap. A restore pulls back the photos its rows point at, and a name
  with no file behind it is skipped rather than failing the restore.
- **Exchange rates travel with the backup.** They look like a cache and are not one: rates are looked
  up *by day*, so the row for the day of a 2021 transfer is what still converts it correctly today,
  and neither a currency the rate source does not carry nor a rate entered by hand can be fetched
  again. On import the newer `fetched_at` wins, so an old backup cannot undo a rate this phone has
  since learned.
- **Bundle (ZIP)** — Settings → Data management → Export → Bundle. One file holding the backup plus
  every receipt photo its rows point at: `backup.json` at the root and `photos/<name>.jpg` beside it.
  No index is needed because the backup already names each photo, so the file name *is* the key.
  JPEGs are stored rather than deflated. Packing and unpacking live in `packages/core/src/bundle.ts`;
  the file I/O is in `apps/mobile/src/lib/bundle.ts`. A zip entry whose name is not a plain file name
  is ignored, so a crafted bundle cannot write outside the photos folder.
- **Replacing everything.** A normal restore merges: newer rows win and nothing is deleted, so two
  devices converge. That is wrong for an export you have restructured elsewhere — the categories you
  removed would quietly survive. *Replace everything with a file* makes the file the whole truth: its
  rows are written even when the phone's copy is newer, and every row it does not mention is deleted.
  Exchange rates are the exception and are always merged. The way back is built in: a replace takes
  a backup *first* and names it in the result, and Restore from a backup offers **Replace everything**
  as well as Merge — so undoing a replace is the same operation pointed at the copy taken before it.
- **What a backup does not carry:** the three `meta` keys that describe the install rather than the
  data (`device_id`, `last_pulled_seq`, `onboarded`). Everything else — all eight tables with every
  column, deleted rows as tombstones, every preference in `BACKUP_META_KEYS`, the rates and the
  photos — is included.
- Requires the `iCloud.dev.kopiyka` container (entitlements in `app.json`); Xcode's automatic signing
  creates it for the team on the first device build.

## Quick logging

- `kopiyka://log` (also the "Log expense" home-screen quick action and the Action button via the
  "New expense in Kopiyka" shortcut) opens the entry sheet straight from a cold start, before
  anything else renders.
- **Bank notifications (beta).** iOS exposes no Wallet transactions to apps, but a Shortcuts
  automation (Automation → When I receive a notification → your bank's app) can run the "Log payment
  from an app notification" intent. It takes the whole **Notification** variable and reads the
  amount, currency, shop or sender, transfer title, card, account number, timestamp and closing
  balance out of it (`apps/mobile/native/KPPaymentText.swift`; `apps/mobile/scripts/payment-parse`
  runs that reader on a Mac against sample texts). Settings → Automate with Shortcut walks through
  the setup.
- That automation is silent. A notification that is not a payment is passed over without a word —
  which is most of them — and the user hears from it only when a notification names money that could
  not be read, when there is no account, or when the write failed.
- **Where you paid is optional and the automation supplies it.** The intent runs in the background
  off a notification, where the app's when-in-use permission grants nothing, so it never takes a fix
  itself: Shortcuts' own "Get Current Location" action goes above the Kopiyka action and its result
  into the new **Location** parameter (`CLPlacemark`). Its coordinate becomes the row's `lat`/`lon`
  and its placemark the `place`, in the same shape a hand-logged entry gets (`kpPlaceName` mirrors
  `src/lib/location.ts` `placeName` — name, else street, else district or city). A second
  notification for the same payment fills a location in through `fillIn`, which never overwrites one.
- A category may be guessed from the words of the shop's name — or, when a location came with it and
  the name said nothing, from the category used near that spot (`suggestCategoryNear`, the same
  question the entry sheet and the watch ask; it runs against SQLite with the app closed and is
  forwarded to JS as op "suggest" while the app is running). A guess is never a filing: the row
  is saved *pending* and its `source` is `shortcut-guess`, which is what makes the Pending queue show
  the category in the tint colour with "· guess" after it. Only history skips the queue.
- A shop (or a note) the database has seen before files itself: the category, tags and place of the
  last entry with that name are copied on, and the entry skips the Pending queue, because the filing
  is a decision you already made. The rule lives in `packages/core/src/payee.ts` and, for the
  automations that run with the app closed, in `apps/mobile/native/KPShared.swift`; the two are kept
  in step by `apps/mobile/scripts/payee-history/run.sh`.
- Money in another currency looks for an account held in it before it converts anything. A bank that
  prints the purchase twice ("36,00 EUR (154,80 PLN)") has already converted it, and that figure is
  preferred over any cached rate. When it does have to convert, the entry stays pending whatever its
  history says, and the bank's own figure is kept in `entered_amount_minor` / `entered_currency` /
  `exchange_rate` so the conversion can be checked; with no rate at all the amount is 0 and the row
  cannot be confirmed until one is typed.
- A folder is never filed into — not by the pickers, not by an intent, not by the receipt reader. A
  folder is a category that has categories inside it; a top-level category with nothing inside it is
  an ordinary category.
- The same amount on the same account within a minute is one payment, not two: Wallet and the bank
  app both notify a tap and iOS re-delivers notifications, so the entry that is already there is kept.
  One still in Pending takes whatever the later notification knows and it does not; one already
  confirmed is left alone.
- While the JS app runs it owns the SQLite file; Swift never opens it (two SQLite copies in one
  process corrupt the WAL). Native code reads `watch-state.json` / `widget-snapshot.json` written by
  JS after every change and forwards writes to JS. Only background launches (intents, the watch, a
  cold quick log) touch SQLite from Swift.

## Apple Watch

The phone builds a compact state file (accounts, categories with recent usage, tags, the last
transactions, budgets for the current period, cached rates) after every change and pushes it over
WatchConnectivity; the watch caches it in its own App Group so it works with the phone out of reach.
Entries made on the watch are sent as messages when the phone is reachable and queued
(`transferUserInfo`) when it is not; the row shows as "Waiting for iPhone" until it lands. Category
and tag ordering on the watch reproduces the phone's pickers so the two never disagree.

## Travel mode

Settings → Travel mode asks for a name, a planned last day and a budget in the current account's
currency. It creates a tag and a one-off budget for it; every new expense — phone, watch, Shortcuts —
carries the tag while the trip runs, the trip card on Budgets and the watch show what is left and
the daily allowance, and spend in other currencies is converted with cached rates. Turning the mode
off keeps the trip under "Past trips". Budgets can also be set per tag on their own.
