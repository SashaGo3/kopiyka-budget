#!/usr/bin/env bash
# Screenshots on the foldable iPhone Duo, on the pipeline's own "Kopiyka Shots Duo" simulator.
#
#   bun run screenshots:duo                    # every language, light + dark
#   bun run screenshots:duo -- --lang uk --theme dark --only budgets
#   bun run screenshots:duo -- --build         # rebuild the Release simulator app first
#
# Builds the Release simulator app only when there is none (or with --build), installs it, seeds
# each language's demo data and shoots the same screens as the iPad set. The simulator needs an
# iOS 27.1+ runtime (xcodebuild -downloadPlatform iOS). Output: screenshots/raw/<lang>/duo/<theme>/.
# frame.mjs frames them (story style) into appstore/<lang>/duo, and upload.sh sends them (upload-duo.mjs).
# Everything else is passed to capture.sh (--lang, --theme, --only, --settle).
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
cd "$MOBILE_DIR"

BUILD=0; PASS=()
for a in "$@"; do [[ "$a" == --build ]] && BUILD=1 || PASS+=("$a"); done

DUO="$(ensure_sim "$DUO_NAME" "$DUO_TYPE" iOS)"
if [[ $BUILD == 1 || ! -d "$APP_PATH" ]]; then
  bash scripts/screenshots/run.sh --build || die "build failed"
fi
boot_sim "$DUO"
log "Installing on \"$DUO_NAME\""
xcrun simctl terminate "$DUO" "$APP_ID" 2>/dev/null || true
xcrun simctl install "$DUO" "$APP_PATH"
xcrun simctl privacy "$DUO" grant location "$APP_ID" >/dev/null 2>&1 || true

# --seed: every language gets its own demo data written just before it is shot, even a single one.
exec bash scripts/screenshots/capture.sh --duo --seed ${PASS[@]+"${PASS[@]}"}
