/**
 * Tells the project which languages the generated String Catalog (native/Localizable.xcstrings,
 * from `bun run i18n`) has.
 *
 * The catalogue itself needs no wiring: native/ is the inline-modules folder, which Expo adds to the
 * app target as a synchronized folder, and that takes every file in it — resources as well as Swift.
 * Adding it again by hand is what Xcode refuses with "Cannot have multiple Localizable.xcstrings
 * files in same target", so this plugin also takes out the symlink and the file reference an earlier
 * version of it put into ios/<name>/.
 *
 * The rest of the languages wiring is in app.config.js: `locales` (Info.plist strings, which Expo
 * writes per language) and CFBundleLocalizations, which is what makes Settings → Kopiyka → Language
 * appear. Idempotent, like every plugin here.
 */
const fs = require("fs");
const path = require("path");
const { withDangerousMod, withXcodeProject, IOSConfig } = require("expo/config-plugins");

const FILE = "Localizable.xcstrings";

/** @type {import('expo/config-plugins').ConfigPlugin<{ languages: string[] }>} */
module.exports = (config, { languages }) => {
  config = withDangerousMod(config, ["ios", (c) => {
    const name = IOSConfig.XcodeUtils.getProjectName(c.modRequest.projectRoot);
    try { fs.unlinkSync(path.join(c.modRequest.platformProjectRoot, name, FILE)); } catch { /* not there */ }
    return c;
  }]);
  return withXcodeProject(config, (c) => {
    const project = c.modResults;
    const name = IOSConfig.XcodeUtils.getProjectName(c.modRequest.projectRoot);
    removeStale(project, `${name}/${FILE}`);
    for (const l of languages) project.addKnownRegion(l);
    return c;
  });
};

/** Drops the file reference to `stale`, its build files, and every group and phase listing them. */
function removeStale(project, stale) {
  const objects = project.hash.project.objects;
  const unq = (v) => String(v ?? "").replace(/"/g, "");
  const refs = new Set(Object.entries(objects.PBXFileReference ?? {})
    .filter(([k, r]) => !k.endsWith("_comment") && unq(r.path) === stale).map(([k]) => k));
  if (refs.size === 0) return;
  const builds = new Set(Object.entries(objects.PBXBuildFile ?? {})
    .filter(([k, b]) => !k.endsWith("_comment") && refs.has(b.fileRef)).map(([k]) => k));
  const drop = (section, keys) => {
    for (const k of keys) { delete objects[section][k]; delete objects[section][`${k}_comment`]; }
  };
  drop("PBXFileReference", refs);
  drop("PBXBuildFile", builds);
  for (const section of ["PBXGroup", "PBXResourcesBuildPhase"]) {
    for (const [k, o] of Object.entries(objects[section] ?? {})) {
      if (k.endsWith("_comment")) continue;
      const list = o.children ?? o.files;
      if (!list) continue;
      const kept = list.filter((e) => !refs.has(e.value) && !builds.has(e.value));
      if (o.children) o.children = kept; else o.files = kept;
    }
  }
}
