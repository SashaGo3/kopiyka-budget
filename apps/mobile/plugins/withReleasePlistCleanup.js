/**
 * Strips expo-dev-launcher's local-network keys (NSLocalNetworkUsageDescription with its "Expo Dev
 * Launcher…" text, and the `_expo._tcp` Bonjour service) from every non-Debug build.
 *
 * expo-dev-launcher adds a build phase that does exactly this, but it declares no inputs, so Xcode's
 * build system is free to run it before `ProcessInfoPlistFile` has written the plist — and on this
 * project it does (the script ran ~600 log lines before the plist existed), leaving a Release app
 * that advertises a development server. This phase declares the built Info.plist as an input, which
 * orders it after the plist is produced. Running the strip twice is harmless.
 *
 * It has to be the LAST build phase of the app target: declaring the plist as an input makes every
 * phase listed after it wait for the plist too, and "Embed Watch Content" sits in the chain that
 * produces the plist — with this phase anywhere before it, Xcode reports "Cycle inside Kopiyka".
 * @bacons/apple-targets adds the embed phase after every ordinary `withXcodeProject` mod has run, so
 * the ordering is done in a *finalized* mod, which runs after all the others and edits the project
 * file on disk.
 */
const fs = require("fs");
const { withFinalizedMod, IOSConfig } = require("expo/config-plugins");

const PHASE = "[Kopiyka] Strip dev-launcher keys from non-Debug builds";

const SCRIPT = `
if [ "$CONFIGURATION" != "Debug" ]; then
  PLIST="\${TARGET_BUILD_DIR}/\${INFOPLIST_PATH}"
  if [ -f "$PLIST" ]; then
    DESC=$(/usr/libexec/PlistBuddy -c "Print :NSLocalNetworkUsageDescription" "$PLIST" 2>/dev/null || true)
    if echo "$DESC" | grep -q "Expo Dev Launcher"; then
      /usr/libexec/PlistBuddy -c "Delete :NSLocalNetworkUsageDescription" "$PLIST"
    fi
    COUNT=$(/usr/libexec/PlistBuddy -c "Print :NSBonjourServices" "$PLIST" 2>/dev/null | grep -c "^    " || true)
    i=$((COUNT - 1))
    while [ "$i" -ge 0 ]; do
      SVC=$(/usr/libexec/PlistBuddy -c "Print :NSBonjourServices:$i" "$PLIST" 2>/dev/null || true)
      if echo "$SVC" | grep -q "_expo._tcp"; then /usr/libexec/PlistBuddy -c "Delete :NSBonjourServices:$i" "$PLIST"; fi
      i=$((i - 1))
    done
    LEFT=$(/usr/libexec/PlistBuddy -c "Print :NSBonjourServices" "$PLIST" 2>/dev/null | grep -c "^    " || true)
    if [ "$LEFT" -eq 0 ]; then /usr/libexec/PlistBuddy -c "Delete :NSBonjourServices" "$PLIST" 2>/dev/null || true; fi
  fi
fi
`;

module.exports = function withReleasePlistCleanup(config) {
  return withFinalizedMod(config, [
    "ios",
    async (config) => {
      const project = IOSConfig.XcodeUtils.getPbxproj(config.modRequest.projectRoot);
      const target = project.getFirstTarget();
      const phases = project.hash.project.objects.PBXShellScriptBuildPhase ?? {};
      let uuid = Object.keys(phases).find((k) => phases[k] && typeof phases[k] === "object" && phases[k].name === `"${PHASE}"`);
      if (!uuid) {
        const added = project.addBuildPhase([], "PBXShellScriptBuildPhase", PHASE, target.uuid, {
          shellPath: "/bin/sh",
          shellScript: SCRIPT,
          // The xcode library writes values verbatim: paths with `$(…)` must arrive pre-quoted or it
          // splits them into nested dictionaries and xcodebuild crashes while parsing the project.
          inputPaths: ['"$(TARGET_BUILD_DIR)/$(INFOPLIST_PATH)"'],
        });
        uuid = added.uuid;
        // No outputs on purpose; always-out-of-date makes Xcode run it every build without the
        // "no outputs" warning.
        project.hash.project.objects.PBXShellScriptBuildPhase[uuid].alwaysOutOfDate = 1;
      }
      const list = project.hash.project.objects.PBXNativeTarget[target.uuid].buildPhases;
      const i = list.findIndex((e) => e.value === uuid);
      if (i >= 0 && i !== list.length - 1) list.push(...list.splice(i, 1));
      fs.writeFileSync(project.filepath, project.writeSync());
      return config;
    },
  ]);
};
