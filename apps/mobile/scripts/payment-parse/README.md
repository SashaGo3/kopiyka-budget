# Payment notification parse harness

Runs the app's notification reader (`native/KPPaymentText.swift`) on notification text, so a bank whose
notifications read wrong can be fixed without a device build.

```sh
cd apps/mobile/scripts/payment-parse
swiftc -O main.swift ../../native/KPPaymentText.swift -o /tmp/payment-parse

/tmp/payment-parse                                     # the built-in samples, with a pass/fail line
/tmp/payment-parse "<whole notification>"              # one notification, the way the automation passes it
/tmp/payment-parse "<title>" "<subtitle>" "<message>"  # the three fields separately
```

One argument is the **Notification** variable the Shortcuts automation hands to "Log payment from an app
notification"; three arguments are the older Title / Subtitle / Message fields. Prints the amount,
currency, shop, city, card, sender, transfer title, closing balance and timestamp, or one of:

- `IGNORED` — no money in the text, or money the bank is explicitly not charging (a declined card, a
  balance, a one-time code). The automation does nothing and says nothing; this is most notifications.
- `UNREADABLE` — money is named and no amount could be read. The one outcome the automation reports
  back to the user, because it is the one they can act on.

Adding a bank: paste one of its notifications into `samples` — with names, account numbers and amounts changed to invented ones, since the file is public — (or `blobs`, for a whole Notification
variable) in `main.swift` with the outcome you expect, then make it pass. The category, the account and
the pending queue are database work and live in `native/KopiykaIntents.swift`; they are not exercised here.
