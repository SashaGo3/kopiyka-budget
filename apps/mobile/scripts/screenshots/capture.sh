#!/usr/bin/env bash
# Capture raw screenshots of the iPhone app and the Apple Watch app on the pipeline's own simulators.
#
#   scripts/screenshots/capture.sh                 # phone (light + dark) and watch
#   scripts/screenshots/capture.sh --phone --theme light
#   scripts/screenshots/capture.sh --watch
#   scripts/screenshots/capture.sh --only log,budgets --theme dark
#
# Expects the Release build installed and the demo data seeded (run.sh does both). Every phone
# shot is a cold start into a deep link, so the navigation stack is identical on every run and a
# screen never inherits state from the previous one. Output: screenshots/raw/iphone/<theme>/<id>.png
# (1320×2868) and screenshots/raw/watch/<id>.png (422×514). frame.mjs turns them into App Store art.
#
# Phone navigation is `xcrun simctl openurl` and nothing else — no taps, see the note below on why
# agent-device must stay out of the way. The watch has no accessibility bridge on simulators, so it
# is driven by idb taps at points calibrated against a screenshot.

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

DO_PHONE=1; DO_WATCH=1; THEMES=(light dark); ONLY=""; SETTLE="${SHOTS_SETTLE:-3}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --phone) DO_WATCH=0 ;;
    --watch) DO_PHONE=0 ;;
    --theme) shift; [[ "$1" == both ]] && THEMES=(light dark) || THEMES=("$1") ;;
    --only) shift; ONLY=",$1," ;;
    --settle) shift; SETTLE="$1" ;;
    -h|--help) sed -n 2,16p "$0"; exit 0 ;;
    *) die "unknown flag $1" ;;
  esac; shift
done

wanted() { [[ -z "$ONLY" || "$ONLY" == *",$1,"* ]]; }

DEMO_JSON="$SHOTS_DIR/demo/kopiyka-demo.json"
[[ -f "$DEMO_JSON" ]] || die "No demo data at $DEMO_JSON — run: bun scripts/screenshots/demo-data.ts"

# Ids the deep links need, read from the demo file so a regenerated dataset keeps working.
eval "$(node -e '
  const b = require(process.argv[1]);
  const cat = (n) => (b.categories.find((c) => c.name === n) || {}).id || "";
  const trip = b.budgets.find((x) => x.period === "once" && x.tag_id && !x.ended);
  const tag = trip ? b.tags.find((t) => t.id === trip.tag_id) : null;
  const q = (s) => JSON.stringify(String(s ?? ""));
  console.log(`CAT_RESTAURANTS=${q(cat("Restaurants & cafés"))}`);
  console.log(`TRIP_TAG=${q(trip ? trip.tag_id : "")}`);
  console.log(`TRIP_NAME=${q(tag ? encodeURIComponent(tag.name) : "")}`);
' "$DEMO_JSON")"

# ---------------------------------------------------------------- phone
PHONE="$(ensure_sim "$PHONE_NAME" "$PHONE_TYPE" iOS)"

# Every shot is reachable by deep link alone, so nothing taps the phone and agent-device is not
# used here. If you ever do need a gesture (say a dataset where the trip card pushes every budget
# below the fold), open a session once *before* the loop and swipe like this:
#
#   ad() { agent-device "$@" --platform ios --device "$PHONE_NAME" --session shots; }
#   ad open "$APP_ID"            # once, up front
#   ad swipe 220 760 220 260 700 # one screenful up, in points (440×956 pt on the 6.9")
#
# and never between the deep link and the screenshot: agent-device runs every command through an
# XCTest runner app, and bringing that runner up pushes Kopiyka into the background — the shot then
# comes out as the iOS home screen, which is what the old "press Open on the Open in Kopiyka Budget?
# prompt" step silently did to all 16 shots. There is no such prompt to press anyway: it belongs to
# links opened from another app, not to `simctl openurl`.

open_url() { xcrun simctl openurl "$PHONE" "$1"; }

# Cold start straight into a deep link: a clean stack every time.
cold() {
  xcrun simctl terminate "$PHONE" "$APP_ID" 2>/dev/null || true
  sleep 0.5
  open_url "$1"
  sleep "$SETTLE"
}

shoot() { # <id>
  local out="$RAW_DIR/iphone/$THEME/$1.png"
  mkdir -p "$(dirname "$out")"
  xcrun simctl io "$PHONE" screenshot "$out" >/dev/null 2>&1
  log "  $THEME/$1  $(png_size "$out")"
}

# One entry per shot id in shots.json (plus a few spares). Add a screen here and in shots.json.
phone_shot() {
  case "$1" in
    welcome)      cold "kopiyka://onboarding" ;;
    log|watch)    cold "kopiyka://log?amount=14.50&category=$CAT_RESTAURANTS&note=Lunch%20at%20Time%20Out%20Market" ;;  # "watch" = the phone half of the Apple Watch slide
    transactions) cold "kopiyka://transactions" ;;
    budgets)      cold "kopiyka://budgets" ;;
    trip)         cold "kopiyka://transactions?tag=$TRIP_TAG&name=$TRIP_NAME&from=0000&nonce=$(date +%s)" ;;
    insights)     cold "kopiyka://insights" ;;
    recurring)    cold "kopiyka://settings/recurring" ;;
    debts)        cold "kopiyka://settings/debts" ;;
    accounts)     cold "kopiyka://settings/accounts" ;;
    categories)   cold "kopiyka://settings/categories" ;;
    tags)         cold "kopiyka://settings/tags" ;;
    settings)     cold "kopiyka://settings" ;;
    shortcut)     cold "kopiyka://settings/shortcut" ;;
    data)         cold "kopiyka://settings/data" ;;
    pending)      cold "kopiyka://pending" ;;
    *) warn "no recipe for phone shot '$1'"; return 1 ;;
  esac
  shoot "$1"
}

PHONE_SHOTS=(welcome log watch transactions budgets trip insights recurring debts accounts categories tags settings shortcut data pending)

if [[ $DO_PHONE == 1 ]]; then
  boot_sim "$PHONE"
  xcrun simctl get_app_container "$PHONE" "$APP_ID" >/dev/null 2>&1 || die "Kopiyka is not installed on \"$PHONE_NAME\" — run scripts/screenshots/run.sh --install"
  pretty_status_bar "$PHONE"
  for THEME in "${THEMES[@]}"; do
    log "iPhone · $THEME"
    xcrun simctl ui "$PHONE" appearance "$THEME" >/dev/null 2>&1 || true
    for id in "${PHONE_SHOTS[@]}"; do wanted "$id" && phone_shot "$id" || true; done
  done
  xcrun simctl ui "$PHONE" appearance light >/dev/null 2>&1 || true
fi

# ---------------------------------------------------------------- watch
# Points on the 49 mm Ultra (211×257 pt, 2× scale). Calibrated against the Release build on
# 2026-09-12; re-check with a screenshot (px / 2 = pt) after any keypad layout change.
# The keypad's top row is 7-8-9 and its bottom row is .-0-⌫ (see LogPage in
# targets/watch/ContentView.swift) — the old table had the rows upside down and every point ~40 pt
# too high, so "14.50" came out as another number or as taps on the amount field.
KEY_COLS=(38 105 172)            # x of the three keypad columns
KEY_ROWS=(121 157 194 230)       # y of rows 7-8-9 / 4-5-6 / 1-2-3 / .-0-⌫
AMOUNT_ROW_Y=77                  # the amount row doubles as "Next"
FIRST_ROW_Y=96                   # first list row on the category / tag pages

wtap()   { idb ui tap --udid "$WATCH" "$1" "$2" >/dev/null 2>&1; sleep 0.7; }
wswipe() { idb ui swipe --udid "$WATCH" "$1" "$2" "$3" "$4" --duration 0.25 >/dev/null 2>&1; sleep 1.2; }
wshoot() { mkdir -p "$RAW_DIR/watch"; xcrun simctl io "$WATCH" screenshot "$RAW_DIR/watch/$1.png" >/dev/null 2>&1; log "  watch/$1  $(png_size "$RAW_DIR/watch/$1.png")"; }
wkey() { # digit or "." or "⌫"
  local k="$1" col row
  case "$k" in
    7|8|9) row=0; col=$((k - 7)) ;;
    4|5|6) row=1; col=$((k - 4)) ;;
    1|2|3) row=2; col=$((k - 1)) ;;
    .) row=3; col=0 ;;  0) row=3; col=1 ;;  ⌫) row=3; col=2 ;;
  esac
  wtap "${KEY_COLS[$col]}" "${KEY_ROWS[$row]}"
}
wrelaunch() {
  xcrun simctl terminate "$WATCH" "$WATCH_APP_ID" 2>/dev/null || true
  sleep 0.5
  xcrun simctl launch "$WATCH" "$WATCH_APP_ID" >/dev/null
  sleep 5
}

if [[ $DO_WATCH == 1 ]]; then
  WATCH="$(ensure_sim "$WATCH_NAME" "$WATCH_TYPE" watchOS)"
  ensure_pair "$WATCH" "$PHONE"
  boot_sim "$PHONE"; boot_sim "$WATCH"
  xcrun simctl get_app_container "$WATCH" "$WATCH_APP_ID" >/dev/null 2>&1 || die "The watch app is not installed on \"$WATCH_NAME\" — run scripts/screenshots/run.sh --install"
  pretty_status_bar "$WATCH"   # watchOS rejects status-bar overrides, so the watch clock is the host's real time
  # The watch gets its data from the phone over WatchConnectivity: the phone app must be up.
  xcrun simctl ui "$PHONE" appearance light >/dev/null 2>&1 || true
  xcrun simctl terminate "$PHONE" "$APP_ID" 2>/dev/null || true
  xcrun simctl launch "$PHONE" "$APP_ID" >/dev/null; sleep 4
  idb connect "$WATCH" >/dev/null 2>&1 || { idb kill >/dev/null 2>&1 || true; idb connect "$WATCH" >/dev/null 2>&1 || die "idb cannot connect to the watch (brew install idb-companion; pipx install fb-idb)"; }

  log "Watch"
  wrelaunch
  for k in 1 4 . 5 0; do wkey "$k"; done
  wanted keypad && wshoot keypad || true
  wtap 105 "$AMOUNT_ROW_Y"; sleep 1
  wanted categories && wshoot categories || true
  wtap 105 "$FIRST_ROW_Y"; sleep 1
  wanted tags && wshoot tags || true

  # One horizontal pager holds all four pages — Log (the keypad, page 0), History, Budgets, Status
  # (the TabView in targets/watch/ContentView.swift). Each right-to-left swipe moves on by one;
  # there is no vertical gesture, and a vertical swipe near the top opens Notification Centre.
  # The swipe runs at mid-height across almost the full width so it is read as a page turn and not
  # as a tap on whatever list row it starts on.
  wrelaunch
  wswipe 200 128 15 128
  wanted history && wshoot history || true
  wswipe 200 128 15 128
  wanted budgets && wshoot budgets || true
  wswipe 200 128 15 128
  wanted status && wshoot status || true
  xcrun simctl terminate "$WATCH" "$WATCH_APP_ID" 2>/dev/null || true
fi

log "Raw screenshots in $RAW_DIR"
