#!/usr/bin/env bash
# Uploads the App Store listing with fastlane deliver, every language: the screenshots from
# screenshots/Finals (iPhone 6.9" and 6.3", iPad 13", Apple Watch) in slide order, replacing whatever the
# version had, and the text from screenshots/metadata (name, subtitle, description, keywords,
# promotional text, what's new — written there by `bun run i18n` from packages/i18n/locales/*/store.json).
#
#   bun run screenshots:upload                        # the version open for editing on App Store Connect
#   bun run screenshots:upload -- 1.1.0               # that version (created if it does not exist yet)
#   bun run screenshots:upload -- --screenshots-only  # leave the listing text alone
#   bun run screenshots:upload -- --lang uk           # one language (en or en-US, uk); the others stay as they are
#   bun run screenshots:upload -- --no-creative       # leave the header and search results art alone
#   bun run screenshots:upload -- --creative-only     # only that art: no screenshots, no text
#
# The web uploader places files in whatever order they finish uploading; deliver uploads them one
# by one, sorted by file name, so the numbers in the names become the order on the store.
# Then the header and search results art in Finals/<lang>/creative, which deliver has no place for:
# upload-creative.mjs puts it in the app's asset library and places it on the version (--no-creative
# skips it). Nothing else is touched: no binary, no URLs or age rating, no submission for review.
#
# Login: an App Store Connect API key when apps/mobile/.env has ASC_KEY_PATH / ASC_KEY_ID /
# ASC_ISSUER_ID (see .env.example), otherwise fastlane asks for your Apple ID and the 2FA code.
set -euo pipefail

MOBILE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$MOBILE_DIR"
[[ -f .env ]] && { set -a; source .env; set +a; }

# No version given: deliver edits whichever version App Store Connect has open for editing (the
# newest one not yet live or in review) and never creates one. A version given is used as named.
VERSION=""; TEXT=true; ONLY_LANG=""; CREATIVE=true; CREATIVE_ONLY=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --screenshots-only) TEXT=false ;;
    --no-creative) CREATIVE=false ;;
    --creative-only) CREATIVE_ONLY=true ;;
    --lang) shift; ONLY_LANG="${1:?--lang needs a language}" ;;
    --lang=*) ONLY_LANG="${1#--lang=}" ;;
    *) VERSION="$1" ;;
  esac
  shift
done
# An app language code (en) becomes its App Store folder name (en-US); a store code is kept.
if [[ -n "$ONLY_LANG" && ! -d "screenshots/Finals/$ONLY_LANG" ]]; then
  ONLY_LANG="$(node scripts/screenshots/langs.mjs "$ONLY_LANG" 2>/dev/null | awk '{print $2}')"
  [[ -n "$ONLY_LANG" && -d "screenshots/Finals/$ONLY_LANG" ]] || { echo "No such language in screenshots/Finals" >&2; exit 1; }
fi
# deliver replaces only the languages it is handed, so leaving one out leaves it alone on the store.
want_lang() { [[ -z "$ONLY_LANG" || "$1" == "$ONLY_LANG" ]]; }
if $CREATIVE_ONLY; then
  exec node "$MOBILE_DIR/scripts/screenshots/upload-creative.mjs" ${VERSION:+"$VERSION"} ${ONLY_LANG:+--lang "$ONLY_LANG"}
fi
if [[ -n "$VERSION" ]]; then
  VERSION_ARGS=(--app_version "$VERSION")
else
  VERSION_ARGS=(--skip_app_version_update true)
fi
BUNDLE_ID="$(node -p 'require("./app.json").expo.ios.bundleIdentifier')"
FINALS="screenshots/Finals"
[[ -d "$FINALS" ]] || { echo "No $FINALS — run: bun run screenshots -- --frame" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# deliver wants one flat folder per App Store language and tells the devices apart by pixel size.
# The prefixes keep the sets from colliding (they share names like 01-log.png) and keep each set's
# own numbering as its order. 1320×2868 lands in the 6.9" slot and 1206×2622 in the 6.3" one.
for lang_dir in "$FINALS"/*/; do
  lang="$(basename "$lang_dir")"
  want_lang "$lang" || continue
  mkdir -p "$WORK/shots/$lang"
  for set in iphone iphone-6.3 ipad watch; do
    for f in "$lang_dir$set"/*.png; do
      [[ -e "$f" ]] && cp "$f" "$WORK/shots/$lang/$set-$(basename "$f")"
    done
  done
  echo "$lang: $(ls "$WORK/shots/$lang" | grep -c '^iphone-[0-9][0-9]-') iPhone 6.9\", $(ls "$WORK/shots/$lang" | grep -c '^iphone-6.3-') iPhone 6.3\", $(ls "$WORK/shots/$lang" | grep -c '^ipad-') iPad, $(ls "$WORK/shots/$lang" | grep -c '^watch-') watch"
done

AUTH=()
if [[ -n "${ASC_KEY_PATH:-}" ]]; then
  KEY_FILE="${ASC_KEY_PATH/#\~/$HOME}"
  node -e '
    const fs = require("fs");
    const [file, id, issuer, out] = process.argv.slice(1);
    fs.writeFileSync(out, JSON.stringify({ key_id: id, issuer_id: issuer, key: fs.readFileSync(file, "utf8") }), { mode: 0o600 });
  ' "$KEY_FILE" "${ASC_KEY_ID:?ASC_KEY_ID is not set}" "${ASC_ISSUER_ID:?ASC_ISSUER_ID is not set}" "$WORK/api-key.json"
  AUTH=(--api_key_path "$WORK/api-key.json")
fi

echo "Uploading to $BUNDLE_ID ${VERSION:-(the version open for editing)}…"
# deliver's own file names for the fields `bun run i18n` writes. A language folder holds only these,
# so nothing else on the listing (URLs, copyright, age rating) is sent.
mkdir -p "$WORK/metadata"
if $TEXT; then
  for lang_dir in screenshots/metadata/*/; do
    lang="$(basename "$lang_dir")"
    want_lang "$lang" || continue
    mkdir -p "$WORK/metadata/$lang"
    for pair in name:name subtitle:subtitle description:description keywords:keywords \
                promotionalText:promotional_text whatsNew:release_notes; do
      src="$lang_dir${pair%%:*}.txt"
      [[ -f "$src" ]] && cp "$src" "$WORK/metadata/$lang/${pair#*:}.txt"
    done
  done
  echo "Listing text: $(ls "$WORK/metadata" | tr '\n' ' ')"
fi
# Run from the scratch folder, beside metadata/: without one, deliver takes the directory for an
# unconfigured project and stops to ask whether to set it up.
cd "$WORK"
FASTLANE_SKIP_UPDATE_CHECK=1 fastlane deliver \
  --metadata_path "$WORK/metadata" \
  --app_identifier "$BUNDLE_ID" \
  "${VERSION_ARGS[@]}" \
  --screenshots_path "$WORK/shots" \
  --overwrite_screenshots true \
  --skip_binary_upload true \
  --skip_metadata "$($TEXT && echo false || echo true)" \
  --submit_for_review false \
  --run_precheck_before_submit false \
  --force true \
  "${AUTH[@]+"${AUTH[@]}"}"

if $CREATIVE; then
  [[ -n "${ASC_KEY_PATH:-}" ]] || { echo "Header and search results art skipped: it needs the API key (ASC_KEY_PATH in .env)" >&2; exit 0; }
  node "$MOBILE_DIR/scripts/screenshots/upload-creative.mjs" ${VERSION:+"$VERSION"} ${ONLY_LANG:+--lang "$ONLY_LANG"}
fi
