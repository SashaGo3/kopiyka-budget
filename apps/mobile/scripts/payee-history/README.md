# Payee-history parity harness

`packages/core/src/payee.ts` and `native/KPShared.swift` hold the same three rules twice — what history
knows about a shop or a note, whether a charge of the same amount is already logged, and how a pending
entry is filled in and confirmed. Core's copy runs while the app is open; the Swift copy runs when a
card-payment automation fires with the app **closed**, which is most of the time. This harness asks both
the same questions against the same fixture database and reports every answer that differs.

```sh
bash apps/mobile/scripts/payee-history/run.sh
```

Core is the reference; the Swift copy has to match it. A difference prints the question, core's answer
and Swift's.

- `seed.ts` builds the fixture, lists the questions and answers them with core.
- `main.swift` answers them with `KPStore`, linking the real `native/KPShared.swift`.
- `compare.ts` diffs the two.

`KPStore` always opens the App Group container, so the fixture is written to
`~/Library/Group Containers/group.dev.kopiyka/kopiyka.db` and deleted again. The run refuses to start if
that file already exists, so a real database is never touched.

Adding a case: put the row in `build()` and the question in `questions`, then make both sides agree.
The notification parser itself is a separate harness, `../payment-parse`.
