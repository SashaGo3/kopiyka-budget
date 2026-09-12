/**
 * Wires the quick-log entry points (native/KPQuickLog.swift) into the generated AppDelegate.
 *
 * `kopiyka://log` opens the app's own JS Log sheet, so the URL only has to reach React Native:
 *  - cold start: the launch options are passed through untouched, except that a launch by the
 *    `dev.kopiyka.log` home-screen quick action carries no URL, so one is synthesized into
 *    `launchOptions[.url]` (RN reads its initial deep link from there);
 *  - running app: `application(_:open:)` asks KPQuickLog first (today it always declines) and then
 *    falls through to RCTLinkingManager as before;
 *  - `application(_:performActionFor:)` hands `kopiyka://log` to RCTLinkingManager.
 *
 * `expo prebuild` rewrites ios/Kopiyka/AppDelegate.swift from the Expo template, hence the patches.
 * Idempotent: a marker comment makes a second run a no-op, and every patch is skipped (with a
 * warning) when the template no longer matches, so prebuild never fails on this.
 */
const { withAppDelegate } = require("expo/config-plugins");

const MARK = "// kopiyka:quick-log";

/** Straight string replacement; warns instead of throwing so a template change cannot break prebuild. */
function swap(src, find, replace, what) {
  if (!src.includes(find)) {
    console.warn(`withQuickLog: could not patch ${what} — AppDelegate.swift no longer matches. The "${"dev.kopiyka.log"}" quick action stays off.`);
    return src;
  }
  return src.replace(find, replace);
}

/** @type {import('expo/config-plugins').ConfigPlugin} */
module.exports = (config) =>
  withAppDelegate(config, (c) => {
    let src = c.modResults.contents;
    if (src.includes(MARK)) return c;

    // A quick-action launch has no URL of its own; give React Native one.
    src = swap(src,
      "    let delegate = ReactNativeDelegate()",
      `    ${MARK} — a launch by the "${"dev.kopiyka.log"}" quick action gets kopiyka://log put into the launch options.\n` +
      "    let kpLaunchOptions = KPQuickLog.launchOptions(for: launchOptions)\n" +
      "    let delegate = ReactNativeDelegate()",
      "launch options");

    src = swap(src, "      launchOptions: launchOptions)", "      launchOptions: kpLaunchOptions)", "startReactNative");

    src = swap(src,
      "    return super.application(app, open: url, options: options) || RCTLinkingManager.application(app, open: url, options: options)",
      `    if KPQuickLog.handleOpen(url: url) { return true }   ${MARK}\n` +
      "    return super.application(app, open: url, options: options) || RCTLinkingManager.application(app, open: url, options: options)",
      "open URL");

    // Home-screen quick action (long-press the icon) while the app runs.
    src = swap(src,
      "  // Universal Links",
      `  ${MARK} — home-screen quick action\n` +
      "#if os(iOS)\n" +
      "  public override func application(\n" +
      "    _ application: UIApplication,\n" +
      "    performActionFor shortcutItem: UIApplicationShortcutItem,\n" +
      "    completionHandler: @escaping (Bool) -> Void\n" +
      "  ) {\n" +
      "    if let url = KPQuickLog.handleShortcut(shortcutItem) {\n" +
      "      completionHandler(RCTLinkingManager.application(application, open: url, options: [:]))\n" +
      "      return\n" +
      "    }\n" +
      "    super.application(application, performActionFor: shortcutItem, completionHandler: completionHandler)\n" +
      "  }\n" +
      "#endif\n\n" +
      "  // Universal Links",
      "quick action");

    c.modResults.contents = src;
    return c;
  });
