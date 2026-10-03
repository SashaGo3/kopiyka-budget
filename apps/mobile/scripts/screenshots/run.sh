#!/usr/bin/env bash
# App Store screenshots, end to end:  build → install → seed demo data → capture → frame.
#
#   bun run screenshots                    # everything (a Release build takes ~5 min the first time)
#   bun run screenshots -- --no-build      # reuse the last Release build
#   bun run screenshots -- --capture --frame            # only re-shoot and re-frame
#   bun run screenshots -- --frame                      # only re-frame (edit screenshots/shots.json, then this)
#   bun run screenshots -- --capture --phone --theme light --only log,budgets
#   bun run screenshots -- --capture --frame --ipad                # only the 13" iPad set
#   bun run screenshots -- --no-ipad                               # everything except the iPad
#   bun run screenshots -- --no-build --lang uk                    # only the Ukrainian set
#
# Steps can be picked individually: --build --install --seed --capture --frame (default: all).
# --lang <code>|all (default all, i.e. apps/mobile/locales/languages.json; several as en,uk) picks the
# languages: each is seeded with its own demo data and captured in turn, then framed.
# Everything else is passed through to capture.sh (--phone / --ipad / --watch / --theme / --only) or,
# for --frame runs, to frame.mjs (e.g. --contact-sheet).
#
# Output, per language (en → en-US, uk → uk, the App Store's codes):
# screenshots/appstore/<store lang>/iphone-6.9/*.png, iphone-6.5/*.png, ipad-13/*.png, watch/*.png
# (+ contact-sheet.png); raw captures in screenshots/raw/<lang>/; the listing text to paste is in
# screenshots/metadata/<store lang>/ (written by `bun run i18n`, not by this). Uses its own simulators
# ("Kopiyka Shots" / "Kopiyka Shots Watch" / "Kopiyka Shots iPad"); yours are never touched.

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
cd "$MOBILE_DIR"

STEPS=(); PASS=(); FRAME_ARGS=(); LANG_SPEC=all
while [[ $# -gt 0 ]]; do
  case "$1" in
    --build|--install|--seed|--capture|--frame) STEPS+=("${1#--}") ;;
    --no-build) STEPS+=(install seed capture frame) ;;
    --no-ipad) PASS+=("$1"); FRAME_ARGS+=("$1") ;;   # skip it in both halves, not just one
    --contact-sheet|--contact-sheet=*|--out=*|--raw=*) FRAME_ARGS+=("$1") ;;
    --lang) shift; LANG_SPEC="$1" ;;
    --lang=*) LANG_SPEC="${1#--lang=}" ;;
    -h|--help) sed -n 2,24p "$0"; exit 0 ;;
    *) PASS+=("$1") ;;
  esac; shift
done
[[ ${#STEPS[@]} -gt 0 ]] || STEPS=(build install seed capture frame)
has() { local s; for s in "${STEPS[@]}"; do [[ "$s" == "$1" ]] && return 0; done; return 1; }
LANGS=($(lang_codes "$LANG_SPEC"))
[[ ${#LANGS[@]} -gt 0 ]] || die "no languages"

PHONE="$(ensure_sim "$PHONE_NAME" "$PHONE_TYPE" iOS)"
WATCH="$(ensure_sim "$WATCH_NAME" "$WATCH_TYPE" watchOS)"
IPAD="$(ensure_sim "$IPAD_NAME" "$IPAD_TYPE" iOS)"
ensure_pair "$WATCH" "$PHONE"

if has build; then
  [[ -d ios/Kopiyka.xcworkspace ]] || die "apps/mobile/ios is missing — run: bun run prebuild && (cd ios && pod install)"
  log "Building Release for the simulator (iPhone app + watch app + complications)…"
  # No -sdk here: it would force the watch targets onto the iOS SDK. The destination is enough.
  # Signing stays on (ad-hoc for the simulator): CODE_SIGNING_ALLOWED=NO drops the entitlements,
  # and without the App Group entitlement the database lands outside the group container.
  xcodebuild -workspace ios/Kopiyka.xcworkspace -scheme Kopiyka -configuration Release \
    -destination 'generic/platform=iOS Simulator' -derivedDataPath "$DERIVED" build -quiet \
    || die "xcodebuild failed"
fi

if has install; then
  [[ -d "$APP_PATH" ]] || die "No Release build at $APP_PATH — run with --build"
  boot_sim "$PHONE"; boot_sim "$WATCH"; boot_sim "$IPAD"
  log "Installing on \"$PHONE_NAME\", \"$IPAD_NAME\" and \"$WATCH_NAME\""
  xcrun simctl terminate "$PHONE" "$APP_ID" 2>/dev/null || true
  xcrun simctl terminate "$IPAD" "$APP_ID" 2>/dev/null || true
  xcrun simctl install "$PHONE" "$APP_PATH"
  # The same Release build: it is offered on iPad (supportsTablet), so the .app installs as it is.
  xcrun simctl install "$IPAD" "$APP_PATH"
  xcrun simctl install "$WATCH" "$WATCH_APP_PATH"
  # The dev-menu gear is not in a Release build, but the location prompt would be: grant it up front
  # so the "Remember location" setting shows as on and the log sheet never opens under a system alert.
  xcrun simctl privacy "$PHONE" grant location "$APP_ID" >/dev/null 2>&1 || true
  xcrun simctl privacy "$IPAD" grant location "$APP_ID" >/dev/null 2>&1 || true
  xcrun simctl privacy "$WATCH" grant location "$WATCH_APP_ID" >/dev/null 2>&1 || true
  # (The simulators' location is set per language when the demo data is seeded: Lisbon, Kyiv.)
fi

# Seed and capture one language at a time: the simulators hold one dataset, in one language.
# demo-data.ts seeds its ids from its own PRNG, so both devices get the same dataset — the same
# category and tag ids the deep links in capture.sh carry.
for code in "${LANGS[@]}"; do
  if has seed || { has capture && [[ ${#LANGS[@]} -gt 1 ]]; }; then
    boot_sim "$PHONE"; boot_sim "$IPAD"
    seed_demo "$code" "$PHONE" "$IPAD"
  fi
  if has capture; then
    scripts/screenshots/capture.sh --lang "$code" --no-seed "${PASS[@]+"${PASS[@]}"}"
  fi
done

if has frame; then
  node scripts/screenshots/frame.mjs --lang "$(IFS=,; echo "${LANGS[*]}")" "${FRAME_ARGS[@]+"${FRAME_ARGS[@]}"}"
fi
