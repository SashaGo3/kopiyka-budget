#!/usr/bin/env bash
# Capture raw screenshots of the iPhone app, the 13" iPad and the Apple Watch app on the pipeline's
# own simulators.
#
#   scripts/screenshots/capture.sh                 # iPhone + iPad (light + dark) and watch
#   scripts/screenshots/capture.sh --phone --theme light
#   scripts/screenshots/capture.sh --ipad
#   scripts/screenshots/capture.sh --phone --watch # several flags pick several devices
#   scripts/screenshots/capture.sh --no-ipad       # everything except the iPad
#   scripts/screenshots/capture.sh --only log,budgets --theme dark
#
# Expects the Release build installed and the demo data seeded (run.sh does both). Every iPhone and
# iPad shot is a cold start into a deep link, so the navigation stack is identical on every run and
# a screen never inherits state from the previous one. Output:
# screenshots/raw/iphone/<theme>/<id>.png (1320×2868), screenshots/raw/ipad/<theme>/<id>.png
# (2064×2752) and screenshots/raw/watch/<id>.png (422×514). frame.mjs turns them into App Store art.
#
# iPhone navigation is `xcrun simctl openurl` and nothing else — no taps, see the note below on why
# agent-device must stay out of the way. The iPad opens the same links but has to have iPadOS's
# "Open in …?" confirmation tapped away (see confirm_open). The watch has no accessibility bridge on
# simulators, so it is driven by idb taps at points calibrated against a screenshot.

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

# No device flag means every device; one or more pick exactly those, so `--phone --watch` is the
# old two-device run and `--ipad` on its own re-shoots the iPad set.
DO_PHONE=1; DO_WATCH=1; DO_IPAD=1; PICKED=0; THEMES=(light dark); ONLY=""; SETTLE="${SHOTS_SETTLE:-3}"
pick() { [[ $PICKED == 1 ]] || { DO_PHONE=0; DO_WATCH=0; DO_IPAD=0; PICKED=1; }; }
while [[ $# -gt 0 ]]; do
  case "$1" in
    --phone) pick; DO_PHONE=1 ;;
    --watch) pick; DO_WATCH=1 ;;
    --ipad)  pick; DO_IPAD=1 ;;
    --no-ipad) DO_IPAD=0 ;;
    --theme) shift; [[ "$1" == both ]] && THEMES=(light dark) || THEMES=("$1") ;;
    --only) shift; ONLY=",$1," ;;
    --settle) shift; SETTLE="$1" ;;
    -h|--help) sed -n 2,21p "$0"; exit 0 ;;
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

# ------------------------------------------------------------------ iPhone + iPad
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

# The iPhone and the iPad are shot by the same three lines — terminate, open the deep link, wait —
# so there is one recipe list and capture_ios points it at whichever simulator is being shot. $SIM,
# $KIND, $EXPECT and $THEME are set by capture_ios and read by the helpers below.
open_url() { xcrun simctl openurl "$SIM" "$1"; }

# iPadOS asks "Open in "Kopiyka Budget"?" before it hands a scheme over — every time, whether the
# app is running or not, and on the iPad only: the same openurl on the iPhone goes straight into the
# app. The prompt is SpringBoard's, so the app cannot turn it off, and a shot taken over it is a
# picture of an alert on the home screen (which is what the whole iPad set came out as until this
# was added). So it is tapped away.
#
# `idb ui tap` injects at the HID level — no XCTest runner, so nothing is pushed into the background,
# unlike agent-device above. The button is looked up by its accessibility label rather than tapped at
# a fixed point because the alert is still sliding in when the first look happens, and a point
# measured mid-animation lands below it; the loop simply looks again until the alert is gone.
confirm_open() {
  local try pt
  for try in 1 2 3 4; do
    pt="$(idb ui describe-all --udid "$SIM" 2>/dev/null | python3 -c '
import json, sys
try:
    els = json.load(sys.stdin)
except Exception:
    sys.exit(0)
hit = [e for e in els if e.get("type") == "Button" and (e.get("AXLabel") or "") == "Open"]
if hit:
    f = hit[-1]["frame"]
    print(int(f["x"] + f["width"] / 2), int(f["y"] + f["height"] / 2))
' || true)"
    [[ -n "$pt" ]] || return 0      # no confirmation on screen: nothing to do
    idb ui tap --udid "$SIM" $pt >/dev/null 2>&1 || true   # unquoted on purpose: "<x> <y>"
    sleep 1.2
  done
  warn "    the \"Open in …\" confirmation would not go away — the shot may be of the alert"
}

# Cold start straight into a deep link: a clean stack every time.
cold() {
  xcrun simctl terminate "$SIM" "$APP_ID" 2>/dev/null || true
  sleep 0.5
  open_url "$1"
  if [[ "$CONFIRM" == 1 ]]; then
    sleep 1.5      # let the alert finish sliding in before looking for it
    confirm_open
  fi
  sleep "$SETTLE"
}

shoot() { # <id>
  local out="$RAW_DIR/$KIND/$THEME/$1.png" size
  mkdir -p "$(dirname "$out")"
  xcrun simctl io "$SIM" screenshot "$out" >/dev/null 2>&1
  size="$(png_size "$out")"
  log "  $KIND/$THEME/$1  $size"
  # frame.mjs lays its slides out against the native size; a rotated or differently sized
  # simulator would be resampled into the bezel instead of landing in it 1:1.
  [[ "$size" == "$EXPECT" ]] || warn "    expected $EXPECT — is \"$SIM_NAME\" the right device, in portrait?"
}

# One entry per shot id in shots.json (plus a few spares). Add a screen here and in shots.json.
ios_shot() {
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
    *) warn "no recipe for shot '$1'"; return 1 ;;
  esac
  shoot "$1"
}

IOS_SHOTS=(welcome log watch transactions budgets trip insights recurring debts accounts categories tags settings shortcut data pending)
# The iPad set has no Apple Watch slide — the watch pairs with an iPhone — so it skips that shot,
# which is the `log` screen a second time anyway.
IPAD_SHOTS=(); for id in "${IOS_SHOTS[@]}"; do [[ "$id" == watch ]] || IPAD_SHOTS+=("$id"); done

capture_ios() { # <udid> <name> <kind: iphone|ipad> <expected WxH> <radio: cellular|wifi> <id…>
  SIM="$1"; SIM_NAME="$2"; KIND="$3"; EXPECT="$4"; local radio="$5"; shift 5
  CONFIRM=0; [[ "$KIND" == ipad ]] && CONFIRM=1
  boot_sim "$SIM"
  xcrun simctl get_app_container "$SIM" "$APP_ID" >/dev/null 2>&1 \
    || die "Kopiyka is not installed on \"$SIM_NAME\" — run scripts/screenshots/run.sh --install"
  if [[ "$CONFIRM" == 1 ]]; then
    idb connect "$SIM" >/dev/null 2>&1 \
      || { idb kill >/dev/null 2>&1 || true; idb connect "$SIM" >/dev/null 2>&1 \
           || die "idb cannot connect to \"$SIM_NAME\" (brew install idb-companion; pipx install fb-idb) — the iPad needs it to tap away iPadOS's \"Open in …\" prompt"; }
  fi
  pretty_status_bar "$SIM" "$radio"
  for THEME in "${THEMES[@]}"; do
    log "$SIM_NAME · $THEME"
    xcrun simctl ui "$SIM" appearance "$THEME" >/dev/null 2>&1 || true
    for id in "$@"; do wanted "$id" && ios_shot "$id" || true; done
  done
  xcrun simctl ui "$SIM" appearance light >/dev/null 2>&1 || true
}

if [[ $DO_PHONE == 1 ]]; then
  capture_ios "$PHONE" "$PHONE_NAME" iphone "$PHONE_SIZE" cellular "${IOS_SHOTS[@]}"
fi

if [[ $DO_IPAD == 1 ]]; then
  IPAD="$(ensure_sim "$IPAD_NAME" "$IPAD_TYPE" iOS)"
  capture_ios "$IPAD" "$IPAD_NAME" ipad "$IPAD_SIZE" wifi "${IPAD_SHOTS[@]}"
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
