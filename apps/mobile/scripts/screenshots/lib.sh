#!/usr/bin/env bash
# Shared helpers for the screenshot pipeline. Sourced by run.sh and capture.sh.
#
# The pipeline owns two simulators of its own ("Kopiyka Shots" + "Kopiyka Shots Watch") so it never
# taps on a simulator you are working in. They are created on first use and reused afterwards.

set -euo pipefail

MOBILE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SHOTS_DIR="$MOBILE_DIR/screenshots"
RAW_DIR="${RAW_DIR:-$SHOTS_DIR/raw}"
APP_ID="dev.kopiyka.app"
WATCH_APP_ID="dev.kopiyka.app.watchkitapp"

PHONE_NAME="${SHOTS_PHONE_NAME:-Kopiyka Shots}"
WATCH_NAME="${SHOTS_WATCH_NAME:-Kopiyka Shots Watch}"
PHONE_TYPE="${SHOTS_PHONE_TYPE:-com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro-Max}"   # 6.9" → 1320×2868
WATCH_TYPE="${SHOTS_WATCH_TYPE:-com.apple.CoreSimulator.SimDeviceType.Apple-Watch-Ultra-3-49mm}" # 422×514

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
pretty_status_bar() {
  xcrun simctl status_bar "$1" override --time "9:41" --batteryState discharging --batteryLevel 100 \
    --cellularBars 4 --operatorName "" --wifiBars 3 >/dev/null 2>&1 || true
}

# Pixel size of a PNG, "WxH".
png_size() {
  python3 - "$1" <<'PY'
import struct, sys
with open(sys.argv[1], 'rb') as f:
    f.seek(16); w, h = struct.unpack('>II', f.read(8)); print(f"{w}x{h}")
PY
}
