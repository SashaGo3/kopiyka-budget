# Security

Kopiyka stores everything on the device and in the user's own iCloud; there is no server to attack
and no account to take over. The parts worth a second look are the on-device parsers: bank
notification text (`apps/mobile/native/KPPaymentText.swift`), receipt text, backup and bundle
import (`packages/core/src/backup.ts`, `bundle.ts`), and deep links (`apps/mobile/src/app/+native-intent.ts`).

If you find something — a crafted backup or ZIP that writes outside the app's folders, a deep link
that does something it should not, a notification text that crashes the parser — please open a
private security advisory on GitHub rather than a public issue. Include the input that triggers it.
Expect a reply within a week.
