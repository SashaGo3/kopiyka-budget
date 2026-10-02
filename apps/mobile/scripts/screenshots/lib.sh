#!/usr/bin/env bash
# Shared helpers for the screenshot pipeline. Sourced by run.sh and capture.sh.
#
# The pipeline owns three simulators of its own ("Kopiyka Shots", "Kopiyka Shots Watch" and
# "Kopiyka Shots iPad") so it never taps on a simulator you are working in. They are created on
# first use and reused afterwards.

set -euo pipefail

MOBILE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SHOTS_DIR="$MOBILE_DIR/screenshots"
RAW_ROOT="${RAW_DIR:-$SHOTS_DIR/raw}"   # raw captures land in $RAW_ROOT/<lang>/…
APP_ID="dev.kopiyka.app"
WATCH_APP_ID="dev.kopiyka.app.watchkitapp"

PHONE_NAME="${SHOTS_PHONE_NAME:-Kopiyka Shots}"
WATCH_NAME="${SHOTS_WATCH_NAME:-Kopiyka Shots Watch}"
IPAD_NAME="${SHOTS_IPAD_NAME:-Kopiyka Shots iPad}"
PHONE_TYPE="${SHOTS_PHONE_TYPE:-com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro-Max}"   # 6.9" → 1320×2868
WATCH_TYPE="${SHOTS_WATCH_TYPE:-com.apple.CoreSimulator.SimDeviceType.Apple-Watch-Ultra-3-49mm}" # 422×514
# App Store Connect's "iPad 13-inch" set is 2064×2752 (it also takes the 12.9" 2048×2732 there).
# Any 13" iPad gives the same 2064×2752: Pro M4/M5 and Air 13" M2/M3/M4 all share that screen.
IPAD_TYPE="${SHOTS_IPAD_TYPE:-com.apple.CoreSimulator.SimDeviceType.iPad-Pro-13-inch-M4-8GB}"   # 13" → 2064×2752

# The raw capture sizes the framer lays its slides out against.
PHONE_SIZE="1320x2868"
IPAD_SIZE="2064x2752"

# Release simulator build (no Metro, no dev-client launcher, cold-start deep links work).
DERIVED="${SHOTS_DERIVED:-$MOBILE_DIR/build/ddr}"
APP_PATH="${SHOTS_APP:-$DERIVED/Build/Products/Release-iphonesimulator/Kopiyka.app}"
WATCH_APP_PATH="$APP_PATH/Watch/KopiykaWatch.app"

log()  { printf '\033[1;34m▸\033[0m %s\n' "$*" >&2; }
warn() { printf '\033[1;33m!\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

# Newest runtime identifier for a platform ("iOS" / "watchOS").
latest_runtime() {
  xcrun simctl list runtimes | awk -v p="$1" '$1 == p && /\(available\)|com.apple.CoreSimulator.SimRuntime/ { id = $NF } END { print id }'
}

# UDID of a simulator by exact name, or empty.
sim_udid() {
  xcrun simctl list devices | awk -v n="$1" -F'[()]' 'index($0, "    " n " (") == 1 { print $2; exit }'
}

# Create the simulator if it does not exist; print its UDID.
ensure_sim() {
  local name="$1" type="$2" platform="$3" udid
  udid="$(sim_udid "$name")"
  if [[ -z "$udid" ]]; then
    local runtime; runtime="$(latest_runtime "$platform")"
    [[ -n "$runtime" ]] || die "No $platform simulator runtime installed (Xcode → Settings → Components)."
    log "Creating simulator \"$name\" ($type, $runtime)"
    udid="$(xcrun simctl create "$name" "$type" "$runtime")"
  fi
  echo "$udid"
}

ensure_pair() {
  local watch="$1" phone="$2"
  if ! xcrun simctl list pairs | grep -A2 "Watch: .*($watch)" | grep -q "Phone: .*($phone)"; then
    log "Pairing watch with phone"
    xcrun simctl pair "$watch" "$phone" >/dev/null || warn "pair failed (already paired elsewhere?) — the watch may not receive data"
  fi
}

boot_sim() {
  local udid="$1"
  xcrun simctl bootstatus "$udid" -b >/dev/null 2>&1 || xcrun simctl boot "$udid" 2>/dev/null || true
  xcrun simctl bootstatus "$udid" >/dev/null 2>&1 || true
}

# Apple's marketing status bar: 9:41, full battery, full signal, no carrier text.
# A Wi-Fi iPad shows no cellular chrome at all, so pass "wifi" to leave those keys out rather than
# put a carrier signal on a device that has none.
pretty_status_bar() {
  local udid="$1" radio="${2:-cellular}"
  local args=(--time "9:41" --batteryState discharging --batteryLevel 100 --wifiBars 3)
  [[ "$radio" == wifi ]] || args+=(--cellularBars 4 --operatorName "")
  xcrun simctl status_bar "$udid" override "${args[@]}" >/dev/null 2>&1 || true
}

# ------------------------------------------------------------------------------- languages
# Every language is shot over its own demo data, with the app and iOS both set to it. The list and
# the App Store code come from langs.mjs (apps/mobile/locales/languages.json + i18n.config.ts).

# "all" or "en,uk" → one line per language: "<code> <App Store code> <locale>".
lang_lines() { node "$MOBILE_DIR/scripts/screenshots/langs.mjs" "${1:-all}" || die "bad --lang ${1:-}"; }
# Just the codes, space-separated.
lang_codes() { lang_lines "${1:-all}" | awk '{ printf "%s%s", (NR > 1 ? " " : ""), $1 }'; }
# The locale for a code ("uk" → "uk-UA").
lang_locale() { lang_lines "$1" | awk '{ print $3 }'; }

# Where the persona of each language lives: the simulator's location, so "Remember location" and
# the place suggestions agree with the demo data's coordinates (demo-data.ts PROFILES).
lang_location() {
  case "$1" in
    uk) echo "50.4501,30.5234" ;;   # Kyiv
    *)  echo "38.7223,-9.1393" ;;   # Lisbon
  esac
}

# iOS itself in the language — system-drawn text in the app (pickers, share sheets, permission
# alerts) and SpringBoard's own prompts. Written through the simulator's own `defaults`, so its
# cfprefsd sees it; an app launched afterwards picks it up. `-AppleLanguages`/`-AppleLocale` launch
# arguments do the same for one launch, but `simctl openurl` (every iPhone/iPad shot) takes none, so
# the global setting is what holds for a cold start into a deep link.
set_sim_language() { # <udid> <code>
  local udid="$1" code="$2" locale
  locale="$(lang_locale "$code")"; locale="${locale//-/_}"
  [[ "$code" == en ]] && locale="en_US"   # what the simulators were left at before languages existed
  xcrun simctl spawn "$udid" defaults write -g AppleLanguages -array "$code" >/dev/null 2>&1 || warn "could not set the language on $udid"
  xcrun simctl spawn "$udid" defaults write -g AppleLocale -string "$locale" >/dev/null 2>&1 || true
}

# The same, as launch arguments for `simctl launch` (the watch half launches the apps directly).
lang_launch_args() { # <code> → prints the arguments, one per line
  local locale; locale="$(lang_locale "$1")"; locale="${locale//-/_}"
  [[ "$1" == en ]] && locale="en_US"
  printf '%s
' -AppleLanguages "($1)" -AppleLocale "$locale"
}

# Write a language's demo data into the given simulators (terminates the app first; never sqlite3 —
# demo-data.ts goes through @kopiyka/core, DATA.md rule 10). The database's meta `language` is the
# code, so the app opens in it.
seed_demo() { # <code> <udid…>
  local code="$1"; shift
  local udid
  for udid in "$@"; do
    log "Seeding the $code demo data into $udid"
    (cd "$MOBILE_DIR" && bun scripts/screenshots/demo-data.ts --lang="$code" --apply="$udid") >/dev/null \
      || die "demo-data.ts --lang=$code --apply=$udid failed"
    xcrun simctl location "$udid" set "$(lang_location "$code")" >/dev/null 2>&1 || true
  done
}

# Pixel size of a PNG, "WxH".
png_size() {
  python3 - "$1" <<'PY'
import struct, sys
with open(sys.argv[1], 'rb') as f:
    f.seek(16); w, h = struct.unpack('>II', f.read(8)); print(f"{w}x{h}")
PY
}
