# Receipt parse harness

Runs the app's receipt text parser (`native/KPReceiptParse.swift`) on a photo using macOS Vision,
so a receipt that reads wrong can be fixed without a device build. HEIC works directly.

```sh
cd apps/mobile/scripts/receipt-parse
swiftc -O main.swift ../../native/KPReceiptParse.swift -o /tmp/receipt-parse
/tmp/receipt-parse ~/Downloads/IMG_6864.heic
```

Prints merchant, total, paid, currency, date, items and the note the app would save.
The on-device model step (category choice, non-Polish receipts) is iOS-only and not exercised here.
