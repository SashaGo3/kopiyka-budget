#!/usr/bin/env bash
# Release build of Kopiyka for TestFlight: iOS app + widgets + Apple Watch app + watch complications,
# all inside one archive (the watch targets are embedded in the iPhone app, so one upload ships everything).
#
#   bun run release:ios          bump build number, archive, upload to App Store Connect (TestFlight)
#   bun run release:ios:ipa      same, but write build/export/Kopiyka.ipa instead of uploading
#   NO_BUMP=1 bun run release:ios     keep the current build number
#   SKIP_ARCHIVE=1 NO_BUMP=1 bun run release:ios   re-run only the upload/export of the existing build/Kopiyka.xcarchive
#
# Signing is automatic with the team from APPLE_TEAM_ID (apps/mobile/.env, see .env.example). Uploading needs either Xcode signed in to the
# Apple ID of that team (Xcode → Settings → Accounts) or an App Store Connect API key:
#   ASC_KEY_PATH=~/.private_keys/AuthKey_XXXX.p8 ASC_KEY_ID=XXXX ASC_ISSUER_ID=uuid bun run release:ios
set -euo pipefail
cd "$(dirname "$0")/.."

MODE=${1:-upload}                       # upload | ipa
[[ -f .env ]] && set -a && source .env && set +a
TEAM=${APPLE_TEAM_ID:-}
VERSION=$(node -p "require('./app.json').expo.version")
SCHEME=Kopiyka
WORKSPACE=ios/Kopiyka.xcworkspace
ARCHIVE=build/Kopiyka.xcarchive
EXPORT=build/export

if [[ -z "$TEAM" ]]; then echo "Set APPLE_TEAM_ID in apps/mobile/.env (copy .env.example) first."; exit 1; fi
if [[ "${NO_BUMP:-}" != "1" ]]; then node scripts/bump-build.js; fi
BUILD=$(node -p "require('./app.json').expo.ios.buildNumber")
echo "▸ Kopiyka $VERSION ($BUILD) · team $TEAM · $MODE"

if [[ "${SKIP_ARCHIVE:-}" == "1" && -d "$ARCHIVE" ]]; then
  echo "▸ Reusing $ARCHIVE"
else
  echo "▸ Syncing the native project (expo prebuild)…"
  npx expo prebuild -p ios >/dev/null

  echo "▸ Archiving (Release, iOS + watch targets)… this takes a few minutes"
  rm -rf "$ARCHIVE"
  xcodebuild -workspace "$WORKSPACE" -scheme "$SCHEME" -configuration Release -destination 'generic/platform=iOS' \
    -archivePath "$ARCHIVE" archive -allowProvisioningUpdates -allowProvisioningDeviceRegistration \
    CODE_SIGN_STYLE=Automatic DEVELOPMENT_TEAM="$TEAM" -quiet
fi

DEST=$([[ "$MODE" == "ipa" ]] && echo export || echo upload)
mkdir -p build
cat > build/ExportOptions.plist <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>$DEST</string>
  <key>teamID</key><string>$TEAM</string>
  <key>signingStyle</key><string>automatic</string>
  <key>uploadSymbols</key><true/>
  <key>manageAppVersionAndBuildNumber</key><false/>
</dict></plist>
PLIST

# macOS ships bash 3.2, where "${ARR[@]}" on an empty array trips `set -u`; hence the ${AUTH[@]+…} form below.
AUTH=()
if [[ -n "${ASC_KEY_PATH:-}" ]]; then AUTH=(-authenticationKeyPath "$ASC_KEY_PATH" -authenticationKeyID "${ASC_KEY_ID:?}" -authenticationKeyIssuerID "${ASC_ISSUER_ID:?}"); fi

echo "▸ $([[ "$DEST" == upload ]] && echo 'Uploading to App Store Connect' || echo 'Exporting .ipa')…"
rm -rf "$EXPORT"
xcodebuild -exportArchive -archivePath "$ARCHIVE" -exportOptionsPlist build/ExportOptions.plist -exportPath "$EXPORT" \
  -allowProvisioningUpdates ${AUTH[@]+"${AUTH[@]}"} -quiet

if [[ "$DEST" == upload ]]; then
  echo "✓ Uploaded Kopiyka $VERSION ($BUILD). It appears in App Store Connect → TestFlight after processing (5–30 min)."
else
  echo "✓ Exported: $EXPORT/$SCHEME.ipa"
fi
