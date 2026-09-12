# Contributing to Kopiyka

Thanks for looking. Kopiyka is a small, opinionated app and a one-person project most of the time,
so the best contributions are the ones that keep it that way: focused, tested, and in the spirit of
the design rules below.

## Before you start

- **Bugs and small fixes:** open an issue or a pull request straight away.
- **Features:** open an issue first and describe the problem you are solving, not only the feature.
  Kopiyka deliberately says no to a lot (accounts, servers, bank aggregation, ads, Android for now),
  and it is kinder to find that out before writing code.
- **Data behaviour** (import, export, backups, migrations, anything that writes rows): read
  [DATA.md](DATA.md) first. Every rule there is enforced somewhere and the file names where. The
  SQLite schema only ever grows: new migrations are appended, existing ones are never edited.

## Setup

```sh
bun install
bun test                              # packages/core, ~150 tests, runs in a second
cd apps/mobile
bun run prebuild                      # generates ios/ (needs Xcode 26 + CocoaPods)
bun run ios                           # builds the dev client for a simulator and starts Metro
```

Device builds need an Apple Team ID in `apps/mobile/.env` (copy `.env.example`); simulators do not.
Swift changes in `apps/mobile/native` are picked up by the next `bun run ios`. The parsers have
Mac-side harnesses that compile a single Swift file with `swiftc` and run fixtures against it
(`apps/mobile/scripts/payment-parse`, `receipt-parse`, `payee-history` — each has a README), which is
the quickest loop for parser work.

## Design rules worth knowing

- **Local-first.** The phone's SQLite file is the truth. Nothing talks to a server; the only network
  call is the exchange-rate lookup.
- **Native feel.** Native stack, native tabs, iOS form sheets. Every sheet has information at the top
  and all inputs in a bottom-anchored bar. Amounts use the custom keypad, text uses the system
  keyboard.
- **Two taps to log.** Anything added to the entry sheet must not slow the amount → category → done
  path.
- **No blue.** The palette is off-white, graphite and the category colours; `C.tint` is the accent,
  `C.onTint` the text on it. No system blue anywhere.
- **Folders are not categories.** A folder is a category with children; nothing is ever filed into
  one (budgets are the documented exception).
- **Accessibility labels are the test API.** Every control has one; the Maestro flows in
  `apps/mobile/.maestro` and the screenshot pipeline drive the app through them.

## Checks before a pull request

```sh
bun test                              # core
cd apps/mobile && bun run typecheck   # TypeScript
cd apps/mobile && bun run lint        # eslint (a handful of react-compiler warnings are known)
```

If you touched a screen, run the relevant Maestro flow (`apps/mobile/.maestro/README.md`) or at least
walk it on a simulator in light and dark mode and at a large Dynamic Type size.

## Commit style

Short imperative subject, a body that says *why*. One change per pull request.

## Android

Not planned for now, maybe later. If you want to make it work before then, go ahead — the core package
is platform-agnostic and the Expo app should get most of the way — but expect to own it for a while.
See the roadmap in the README for what is planned.
