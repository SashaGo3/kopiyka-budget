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
#   scripts/screenshots/capture.sh --lang uk       # one language (default: all of them, in turn)
#   scripts/screenshots/capture.sh --phone --palette siri --theme light --only log
#                                                  # in a colour theme: raw/<lang>/iphone/siri-light/
#
# Languages: each one is shot over its own demo data (demo-data.ts --lang), with the app's meta
# `language` and iOS's own language set to it. With one --lang the simulators are expected to hold
# that language's data already (run.sh --seed does it); with several, each is seeded just before it
# is shot, since the data cannot be two languages at once. --seed seeds even a single language;
# --no-seed never seeds.
#
# Expects the Release build installed and the demo data seeded (run.sh does both). Every iPhone and
# iPad shot is a cold start into a deep link, so the navigation stack is identical on every run and
# a screen never inherits state from the previous one. Output:
# screenshots/raw/<lang>/iphone/<theme>/<id>.png (1320×2868), screenshots/raw/<lang>/ipad/<theme>/<id>.png
# (2064×2752) and screenshots/raw/<lang>/watch/<id>.png (422×514). frame.mjs turns them into App Store art.
#
# iPhone and iPad navigation is a launch with the shot's link as an argument (`-KPLink`) and nothing
# else — no taps, see the note below on why agent-device must stay out of the way. (An openurl waits
# behind iPadOS's "Open in …?" prompt, and stopped reaching a cold iPhone app on iOS 27.) The watch is
# launched straight onto each screen (`-KPShot`). Nothing taps: idb's taps need a framework Xcode 27
# moved, and its companion has not been updated since 2022.

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

# No device flag means every device; one or more pick exactly those, so `--phone --watch` is the
# old two-device run and `--ipad` on its own re-shoots the iPad set.
# SETTLE: seconds from launch to shot. On the iOS 27 simulators a launch onto a link is drawn about
# 4 s in (3 was enough on iOS 26), later while the other simulators are busy, so 6.
DO_PHONE=1; DO_WATCH=1; DO_IPAD=1; PICKED=0; THEMES=(light dark); ONLY=""; SETTLE="${SHOTS_SETTLE:-6}"
LANG_SPEC="all"; SEED=auto; PALETTE=""
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
    --lang) shift; LANG_SPEC="$1" ;;
    --lang=*) LANG_SPEC="${1#--lang=}" ;;
    --seed) SEED=yes ;;
    --palette) shift; PALETTE="$1" ;;
    --no-seed) SEED=no ;;
    -h|--help) sed -n 2,29p "$0"; exit 0 ;;
    *) die "unknown flag $1" ;;
  esac; shift
done

wanted() { [[ -z "$ONLY" || "$ONLY" == *",$1,"* ]]; }

LANGS=($(lang_codes "$LANG_SPEC"))
[[ ${#LANGS[@]} -gt 0 ]] || die "no languages to capture"
[[ "$SEED" == auto ]] && { [[ ${#LANGS[@]} -gt 1 ]] && SEED=yes || SEED=no; }

# Ids and words the deep links need, read from the language's demo file (so a regenerated dataset
# keeps working) and its demo text: the Restaurants category by its preset key, the running trip's
# tag, and the amount and note typed on the entry sheet and the watch.
load_lang() { # <code>
  local code="$1" demo="$SHOTS_DIR/demo/kopiyka-demo-$1.json"
  [[ -f "$demo" ]] || die "No demo data at $demo — run: bun scripts/screenshots/demo-data.ts --lang=$code"
  eval "$(node -e '
    const b = require(process.argv[1]);
    const words = require(process.argv[2]);
    const cat = (key) => (b.categories.find((c) => c.preset === key) || {}).id || "";
    const trip = b.budgets.find((x) => x.period === "once" && x.tag_id && !x.ended);
    const tag = trip ? b.tags.find((t) => t.id === trip.tag_id) : null;
    const q = (s) => JSON.stringify(String(s ?? ""));
    if ((b.settings || {}).language !== process.argv[3]) console.error(`warn: ${process.argv[1]} is not the ${process.argv[3]} dataset`);
    console.log(`CAT_RESTAURANTS=${q(cat("food.restaurants"))}`);
    console.log(`TRIP_TAG=${q(trip ? trip.tag_id : "")}`);
    console.log(`TRIP_NAME=${q(tag ? encodeURIComponent(tag.name) : "")}`);
    console.log(`LOG_AMOUNT=${q(words["demo.capture.logAmount"])}`);
    console.log(`LOG_NOTE=${q(encodeURIComponent(words["demo.capture.logNote"]))}`);
  ' "$demo" "$MOBILE_DIR/scripts/screenshots/i18n/$code.json" "$code")"
  LANG_CODE="$code"
  RAW_DIR="$RAW_ROOT/$code"
}

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

# The iPhone and the iPad are shot by the same three lines — terminate, launch onto the deep link,
# wait — so there is one recipe list and capture_ios points it at whichever simulator is being shot.
# $SIM, $KIND, $EXPECT and $THEME are set by capture_ios and read by the helpers below.

# Cold start straight into a deep link: a clean stack every time.
cold() {
  xcrun simctl terminate "$SIM" "$APP_ID" 2>/dev/null || true
  sleep 0.5
  # Launched with the link as an argument (`openLaunchLink`, src/lib/launchLink.ts). An openurl
  # waits behind iPadOS's "Open in …" prompt, and on the iOS 27 simulators a cold openurl started
  # the iPhone app on Transactions without handing it the link at all.
  xcrun simctl launch "$SIM" "$APP_ID" -KPLink "$1" >/dev/null
  sleep "$SETTLE"
}

shoot() { # <id>
  local out="$RAW_DIR/$KIND/${PALETTE:+$PALETTE-}$THEME/$1.png" size
  mkdir -p "$(dirname "$out")"
  xcrun simctl io "$SIM" screenshot "$out" >/dev/null 2>&1
  size="$(png_size "$out")"
  log "  $LANG_CODE/$KIND/$THEME/$1  $size"
  # frame.mjs lays its slides out against the native size; a rotated or differently sized
  # simulator would be resampled into the bezel instead of landing in it 1:1.
  [[ "$size" == "$EXPECT" ]] || warn "    expected $EXPECT — is \"$SIM_NAME\" the right device, in portrait?"
}

# One entry per shot id in shots.json (plus a few spares). Add a screen here and in shots.json.
ios_shot() {
  case "$1" in
    welcome)      cold "kopiyka://onboarding" ;;
    log|watch)    cold "kopiyka://log?amount=$LOG_AMOUNT&category=$CAT_RESTAURANTS&note=$LOG_NOTE" ;;  # "watch" = the phone half of the Apple Watch slide
    transactions) cold "kopiyka://transactions" ;;
    budgets)      cold "kopiyka://budgets" ;;
    trip)         cold "kopiyka://transactions?tag=$TRIP_TAG&name=$TRIP_NAME&from=0000&nonce=$(date +%s)" ;;
    insights)     cold "kopiyka://insights" ;;
    recurring)    cold "kopiyka://settings/recurring" ;;
    debts)        cold "kopiyka://settings/debts" ;;
    themes)       cold "kopiyka://settings/theme" ;;
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

IOS_SHOTS=(welcome log watch transactions budgets trip insights recurring themes debts accounts categories tags settings shortcut data pending)
# The iPad set has no Apple Watch slide — the watch pairs with an iPhone — so it skips that shot,
# which is the `log` screen a second time anyway.
IPAD_SHOTS=(); for id in "${IOS_SHOTS[@]}"; do [[ "$id" == watch ]] || IPAD_SHOTS+=("$id"); done

capture_ios() { # <udid> <name> <kind: iphone|ipad> <expected WxH> <radio: cellular|wifi> <id…>
  SIM="$1"; SIM_NAME="$2"; KIND="$3"; EXPECT="$4"; local radio="$5"; shift 5
  boot_sim "$SIM"
  xcrun simctl get_app_container "$SIM" "$APP_ID" >/dev/null 2>&1 \
    || die "Kopiyka is not installed on \"$SIM_NAME\" — run scripts/screenshots/run.sh --install"
  set_sim_language "$SIM" "$LANG_CODE"
  if [[ "$KIND" == ipad ]]; then
    # The iPad's status bar prints the date, and SpringBoard reads the language only when it starts:
    # without a restart the English slides carried the Ukrainian date of the run before.
    xcrun simctl shutdown "$SIM" >/dev/null 2>&1 || true
    boot_sim "$SIM"
  fi
  pretty_status_bar "$SIM" "$radio"
  # A colour theme is meta `theme`, so it is set the way the demo data is: re-seeded, app closed.
  [[ -n "$PALETTE" ]] && seed_demo_theme "$LANG_CODE" "$SIM" "$PALETTE"
  # One launch off-camera first. A simulator's first start of a fresh install takes far longer than
  # the settle time (a just-created iOS 27 simulator drew the launch skeleton into every light shot);
  # every launch after it is quick.
  xcrun simctl launch "$SIM" "$APP_ID" >/dev/null 2>&1 || true
  sleep "${SHOTS_WARMUP:-15}"
  xcrun simctl terminate "$SIM" "$APP_ID" 2>/dev/null || true
  for THEME in "${THEMES[@]}"; do
    log "$SIM_NAME · $LANG_CODE · $THEME"
    xcrun simctl ui "$SIM" appearance "$THEME" >/dev/null 2>&1 || true
    for id in "$@"; do wanted "$id" && ios_shot "$id" || true; done
  done
  xcrun simctl ui "$SIM" appearance light >/dev/null 2>&1 || true
  [[ -n "$PALETTE" ]] && seed_demo_theme "$LANG_CODE" "$SIM" graphite
  true
}

capture_phone_ipad() {
  if [[ $DO_PHONE == 1 ]]; then
    capture_ios "$PHONE" "$PHONE_NAME" iphone "$PHONE_SIZE" cellular "${IOS_SHOTS[@]}"
  fi
  if [[ $DO_IPAD == 1 ]]; then
    IPAD="$(ensure_sim "$IPAD_NAME" "$IPAD_TYPE" iOS)"
    capture_ios "$IPAD" "$IPAD_NAME" ipad "$IPAD_SIZE" wifi "${IPAD_SHOTS[@]}"
  fi
}

# ---------------------------------------------------------------- watch
# No taps: the watch app opens the screen it is launched with (`-KPShot`, `WatchShot` in
# targets/watch/KopiykaWatchApp.swift), the amount already typed. idb's taps need SimulatorKit where
# Xcode kept it until 26, and coordinates broke whenever a row was added above the one they hit.
wshoot() { mkdir -p "$RAW_DIR/watch"; xcrun simctl io "$WATCH" screenshot "$RAW_DIR/watch/$1.png" >/dev/null 2>&1; log "  $LANG_CODE/watch/$1  $(png_size "$RAW_DIR/watch/$1.png")"; }
# Wait until the watch holds the phone's state in this language (watch-state.json in its App Group,
# written when the state arrives), launching the watch app so it asks. A new watch has none, and a
# shot taken before it lands is the "Open Kopiyka on your iPhone" keypad over an empty list.
wait_watch_state() {
  local group file try
  group="$(xcrun simctl get_app_container "$WATCH" "$WATCH_APP_ID" groups 2>/dev/null | awk '$1 == "group.dev.kopiyka" { print $2 }')"
  file="$group/watch-state.json"
  xcrun simctl launch "$WATCH" "$WATCH_APP_ID" $(lang_launch_args "$LANG_CODE") >/dev/null 2>&1 || true
  for try in $(seq 1 45); do
    if [[ -f "$file" ]] && grep -q "\"language\":\"$LANG_CODE\"" "$file" && ! grep -q '"accounts":\[\]' "$file"; then return 0; fi
    sleep 2
  done
  warn "    the watch has no $LANG_CODE data from the phone after 90 s — the shots may be empty"
}

# Open one screen and photograph it.
wscreen() {
  wanted "$1" || return 0
  xcrun simctl terminate "$WATCH" "$WATCH_APP_ID" 2>/dev/null || true
  sleep 0.5
  # shellcheck disable=SC2046 # one argument per line, none with spaces
  xcrun simctl launch "$WATCH" "$WATCH_APP_ID" $(lang_launch_args "$LANG_CODE") -KPShot "$1" -KPShotAmount "$LOG_AMOUNT" >/dev/null
  sleep 5
  wshoot "$1"
}

capture_watch() {
  WATCH="$(ensure_sim "$WATCH_NAME" "$WATCH_TYPE" watchOS)"
  ensure_pair "$WATCH" "$PHONE"
  boot_sim "$PHONE"; boot_sim "$WATCH"
  set_sim_language "$PHONE" "$LANG_CODE"; set_sim_language "$WATCH" "$LANG_CODE"
  xcrun simctl get_app_container "$WATCH" "$WATCH_APP_ID" >/dev/null 2>&1 || die "The watch app is not installed on \"$WATCH_NAME\" — run scripts/screenshots/run.sh --install"
  pretty_status_bar "$WATCH"   # watchOS rejects status-bar overrides, so the watch clock is the host's real time
  # The watch gets its data from the phone over WatchConnectivity: the phone app must be up.
  xcrun simctl ui "$PHONE" appearance light >/dev/null 2>&1 || true
  xcrun simctl terminate "$PHONE" "$APP_ID" 2>/dev/null || true
  # shellcheck disable=SC2046
  xcrun simctl launch "$PHONE" "$APP_ID" $(lang_launch_args "$LANG_CODE") >/dev/null; sleep 4

  log "Watch · $LANG_CODE"
  wait_watch_state
  wscreen keypad
  local screen
  for screen in categories tags history budgets status; do wscreen "$screen"; done
  xcrun simctl terminate "$WATCH" "$WATCH_APP_ID" 2>/dev/null || true
}

# ---------------------------------------------------------------- every language in turn
for code in "${LANGS[@]}"; do
  load_lang "$code"
  if [[ "$SEED" == yes ]]; then
    targets=()
    [[ $DO_PHONE == 1 || $DO_WATCH == 1 ]] && targets+=("$PHONE")
    [[ $DO_IPAD == 1 ]] && targets+=("$(ensure_sim "$IPAD_NAME" "$IPAD_TYPE" iOS)")
    for t in "${targets[@]}"; do boot_sim "$t"; done
    seed_demo "$code" "${targets[@]}"
    load_lang "$code"   # the seed rewrote the demo file; read the ids again
  fi
  capture_phone_ipad
  [[ $DO_WATCH == 1 ]] && capture_watch
  log "Raw screenshots in $RAW_DIR"
done
