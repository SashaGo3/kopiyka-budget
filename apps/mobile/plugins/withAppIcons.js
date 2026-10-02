/**
 * The alternate app icons, one per colour theme (assets/icons/<id>.png, drawn by
 * scripts/icons/generate.ts). JS side: setAppIcon in src/lib/bridge.ts, which calls
 * `setAppIcon` in native/KPBridgeModule.swift with "AppIcon-<id>", or nil for the primary icon.
 *
 * The primary icon is untouched: Expo's own icon plugin copies ios.icon (the Icon Composer
 * assets/expo.icon) into the project and points ASSETCATALOG_COMPILER_APPICON_NAME at it ("expo").
 * The alternates go beside it as ordinary single-size app icon sets in Images.xcassets, which is
 * already in the app target's resources, and are listed by name in
 * ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES. actool then compiles them and writes the
 * CFBundleAlternateIcons entries into the built Info.plist itself — nothing goes into Info.plist
 * here. The list is explicit rather than ASSETCATALOG_COMPILER_INCLUDE_ALL_APPICON_ASSETS, which
 * would also ship the empty AppIcon.appiconset the Expo template leaves in the catalogue.
 *
 * The icons are whatever PNGs assets/icons holds, so adding a theme is: add it to
 * packages/core/src/themes.ts, run `bun run icons:themes`, prebuild. Theme ids name the sets and
 * are forever. Idempotent, like every plugin here: sets are rewritten on every run, and a set this
 * plugin made for an icon that is no longer in assets/icons is removed.
 */
const fs = require("fs");
const path = require("path");
const { withDangerousMod, withXcodeProject, IOSConfig } = require("expo/config-plugins");

const PREFIX = "AppIcon-";
const SOURCE = "assets/icons";

/** Theme ids that have an icon: every assets/icons/<id>.png. */
function iconIds(projectRoot) {
  const dir = path.join(projectRoot, SOURCE);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith(".png"))
    .map((f) => f.slice(0, -4))
    .sort();
}

const contents = (file) => JSON.stringify({
  images: [{ filename: file, idiom: "universal", platform: "ios", size: "1024x1024" }],
  info: { author: "kopiyka", version: 1 },
}, null, 2) + "\n";

/** @type {import('expo/config-plugins').ConfigPlugin} */
module.exports = (config) => {
  config = withDangerousMod(config, ["ios", (c) => {
    const { projectRoot, platformProjectRoot } = c.modRequest;
    const name = IOSConfig.XcodeUtils.getProjectName(projectRoot);
    const catalog = path.join(platformProjectRoot, name, "Images.xcassets");
    fs.mkdirSync(catalog, { recursive: true });
    const ids = iconIds(projectRoot);
    const wanted = new Set(ids.map((id) => `${PREFIX}${id}.appiconset`));
    for (const entry of fs.readdirSync(catalog)) {
      if (entry.startsWith(PREFIX) && entry.endsWith(".appiconset") && !wanted.has(entry)) {
        fs.rmSync(path.join(catalog, entry), { recursive: true, force: true });
      }
    }
    for (const id of ids) {
      const set = path.join(catalog, `${PREFIX}${id}.appiconset`);
      fs.rmSync(set, { recursive: true, force: true });
      fs.mkdirSync(set, { recursive: true });
      fs.copyFileSync(path.join(projectRoot, SOURCE, `${id}.png`), path.join(set, `${id}.png`));
      fs.writeFileSync(path.join(set, "Contents.json"), contents(`${id}.png`));
    }
    return c;
  }]);

  return withXcodeProject(config, (c) => {
    const project = c.modResults;
    const name = IOSConfig.XcodeUtils.getProjectName(c.modRequest.projectRoot);
    const ids = iconIds(c.modRequest.projectRoot);
    const [, target] = IOSConfig.Target.findNativeTargetByName(project, name);
    const configs = IOSConfig.XcodeUtils.getBuildConfigurationsForListId(project, target.buildConfigurationList);
    for (const [, cfg] of configs) {
      const settings = cfg.buildSettings;
      if (!settings) continue;
      if (ids.length === 0) {
        delete settings.ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES;
        continue;
      }
      settings.ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES = `"${ids.map((id) => PREFIX + id).join(" ")}"`;
    }
    return c;
  });
};
