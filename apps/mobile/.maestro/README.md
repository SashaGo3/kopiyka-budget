# Maestro flows

End-to-end flows against the dev build on the iOS simulator (Metro must be running).

```sh
export PATH="$HOME/.maestro/bin:$PATH"
maestro --device <simulator udid> test .maestro
```

Flows use the accessibility labels the app sets on every control, so they double as
an accessibility check. `_launch.yaml` is shared and dismisses the dev-client onboarding.

The transfer flows (12–14) work on their own test accounts. Seed them while the app is closed, and
remove them afterwards — the script goes through the core API, never the sqlite3 CLI (DATA.md rule 10):

```sh
bun apps/mobile/.maestro/seed/transfers.ts <udid>          # E2E PLN, E2E PLN 2, E2E USD + two unpaired bank legs
maestro --device <udid> test .maestro/12-transfer-same-currency.yaml .maestro/13-transfer-cross-currency.yaml .maestro/14-transfer-pending-approve.yaml
bun apps/mobile/.maestro/seed/transfers.ts <udid> --clean
```
