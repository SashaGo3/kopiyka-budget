#!/usr/bin/env bash
# Payee-history parity harness: does the Swift copy of `payeeHistory` / the duplicate window / the
# pending fill-in answer exactly what core answers? See README.md.
#
#   bash run.sh
#
# Core (packages/core/src/payee.ts) is the reference; native/KPShared.swift has to match it, because
# that copy is what runs when a card-payment automation fires with the app closed.
set -euo pipefail
cd "$(dirname "$0")"

DB="$HOME/Library/Group Containers/group.dev.kopiyka/kopiyka.db"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# KPStore always opens the App Group container, so the fixture has to live there. Never over a real one.
if [[ -e "$DB" ]]; then
  echo "✗ $DB already exists — refusing to overwrite it. Move it aside and re-run."; exit 1
fi
mkdir -p "$(dirname "$DB")"
cleanup() { rm -rf "$WORK" "$DB" "$DB-wal" "$DB-shm"; }
trap cleanup EXIT

echo "▸ Seeding the fixture and asking core…"
bun seed.ts "$DB" "$WORK"

echo "▸ Building the Swift harness…"
swiftc -O main.swift ../../native/KPShared.swift -o "$WORK/payee-history"

echo "▸ Asking KPStore the same questions…"
"$WORK/payee-history" "$WORK/questions.json" "$WORK/actual.json"

bun compare.ts "$WORK/questions.json" "$WORK/expected.json" "$WORK/actual.json"
