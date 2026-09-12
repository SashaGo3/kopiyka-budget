# Kopiyka Budget — Privacy Policy

_Last updated: 12 September 2026_

Kopiyka Budget ("Kopiyka", the app) is an open-source app published by its maintainer ("the developer"). The source code and the issue tracker are at the repository linked below.

**Kopiyka does not collect any personal data.** There is no account, no server, and no way for the
developer to see what you enter. This page explains where your data actually lives and what the
app asks your permission for.

## What Kopiyka is

Kopiyka is a personal finance app for iPhone and Apple Watch. You record what you spend and earn,
set budgets, and look at your own numbers. Everything happens on your device.

## What it stores, and where

| What | Where it lives |
|---|---|
| Accounts, transactions, categories, tags, budgets, recurring rules, debts, notes, and your preferences | A database file inside the app on your iPhone |
| The same data, in a form the Apple Watch app, the widgets and the Shortcuts actions can read | A shared container on your iPhone that only Kopiyka's own parts can open (the "App Group") |
| Receipt photos you attach | Files in the app's own Documents folder on your iPhone |
| Backups, if you turn them on | **Your own iCloud Drive**, in a folder named **Kopiyka** — visible to you in the Files app. This is your Apple Account's storage, not the developer's. With iCloud Drive turned off, backups stay in the app's folder on the phone instead. |

Nothing on that list is ever sent to the developer of Kopiyka, or to anyone else.

## What Kopiyka never does

- No accounts, no sign-in, no profile.
- No analytics, no usage statistics, no crash reporting service.
- No advertising, no advertising identifier (IDFA), no trackers or tracking SDKs of any kind — the app never shows the App Tracking Transparency prompt because there is nothing to ask permission for.
- No third-party software development kits that collect data.
- **No connection to your bank.** Kopiyka has no banking API, no card credentials, and no access
  to your bank account. See the section on Shortcuts below for what it does instead.
- No selling, sharing, or transferring of your data, because the developer never has it.

## The one thing that leaves your phone

Kopiyka makes a single kind of network request: an exchange rate lookup.

When you record something in a currency that differs from the account's currency and the app has
no rate stored for that day, it asks **api.frankfurter.dev** — a free public service that
publishes the European Central Bank's reference rates — for that rate.

The request contains two currency codes and a date. It contains no personal data, no identifier,
no account information, and no amount. Rates are then stored on your phone so the same day is
never asked for twice, and if you are offline the app falls back to the last rate it knows.

If you only ever use one currency, this request never happens at all.

## Permissions

Each of these is optional. Kopiyka works without any of them, and you can change your mind at any
time in the iOS Settings app.

- **Location (while using the app).** Off until you turn it on. When enabled, Kopiyka attaches a
  rough location to an entry you log, and uses it to suggest the category you last chose at that
  same place — so the coffee shop you visit every week fills itself in. The location is written
  into your own database on the phone and is never transmitted. You can also set a "home"
  location, where no suggestion is made because anything can be bought there.
- **Camera.** Used only to photograph a receipt and attach it to a transaction.
- **Photo library.** Used only to attach a receipt picture you have already taken.
- **Notifications.** Used only for reminders scheduled on your own device: a recurring payment
  coming up, or a debt falling due. Kopiyka has no push notification server and cannot send you
  anything from the internet.

## The Shortcuts automation (beta)

iOS never gives an app your card transactions. What it does allow is an automation you build
yourself in Apple's Shortcuts app: when your bank's app shows you a notification about a payment,
the automation hands that notification to Kopiyka.

Kopiyka reads the amount, the shop or sender, the card and the time **out of that text, on your
device**, and saves an entry for you to review. The notification text is never sent anywhere. The
app still has no link to your bank — it is reading a message your phone already received.

If you add Shortcuts' own "Get Current Location" action to the automation, where you paid is passed
to Kopiyka by the Shortcuts app and stored in your own database like any other entry — Kopiyka never
asks for a location itself while the automation runs, and the step is optional.

If you do not set this automation up, none of it happens.

## Apple Watch

If you use the watch app, your accounts, categories, tags and budgets travel between your iPhone
and your Apple Watch over Apple's WatchConnectivity, which is a direct link between two devices
you own. That data does not pass through the developer, and it is not stored anywhere else.

## Backups, export, and deleting everything

- **Backups** are written to your own iCloud Drive folder, described above. They are yours: open
  them in Files, move them, or delete them.
- **Export.** At any time you can export everything from Settings → Data management, as a JSON
  backup, a CSV file, or a ZIP bundle that includes your receipt photos.
- **Deleting your data.** Settings → Reset all data erases every account, category, tag, budget
  and transaction from the phone. Deleting the app removes its database and its receipt photos
  along with it. Backups already written to iCloud Drive are separate — delete the **Kopiyka**
  folder in the Files app to remove those too.

Because the developer receives no data at all, **there is nothing held on the developer's side to
request, correct, or delete.** Any right you have over your data you exercise directly, on your
own device and in your own iCloud account, using the controls above.

## Children

Kopiyka is not directed at children and collects no data from anyone, of any age.

## Changes to this policy

If this policy changes, the updated version will be published at this address with a new date at
the top. The app is open source, so any change to what it actually does is visible in the
repository's history as well.

## Contact

Questions about this policy:

- Repository and issue tracker: <https://github.com/SashaGo3/kopiyka-budget>
- Email: <kopiyka_budget@icloud.com>
