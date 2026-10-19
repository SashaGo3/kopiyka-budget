/**
 * Moves the app onto the UIScene lifecycle.
 *
 * iOS 27 stops an app at launch when it was built with the iOS 27 SDK and still runs the old
 * app-delegate window lifecycle (`_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`,
 * a SIGTRAP inside `-[UIApplication workspace:didCreateScene:…]` — TestFlight 1.0.4 (66) on 27.2).
 * The Expo 57 template still creates its window in `application(_:didFinishLaunchingWithOptions:)`,
 * so this plugin patches the generated AppDelegate.swift and Info.plist:
 *
 *  - Info.plist gets a `UIApplicationSceneManifest` with one window scene, `KPSceneDelegate`.
 *  - `didFinishLaunching` still builds the React Native factory, but no longer makes a window or
 *    starts React Native: it keeps its launch options for the scene.
 *  - `KPSceneDelegate` makes the window when the scene connects and starts React Native in it. What
 *    a cold start used to find in the launch options — a deep link, the quick action, a universal
 *    link — arrives in the scene's connection options instead and is put back where React Native
 *    (and KPQuickLog) read it.
 *  - Once running, a scene gets URLs, user activities and quick actions instead of the app
 *    delegate, so the scene hands each one to the app delegate's existing method. Everything those
 *    already do — Expo's subscribers, RCTLinkingManager, KPQuickLog — stays in one place.
 *
 * Expo runs a later plugin's AppDelegate mod first, so this one patches the template before
 * `withQuickLog` sees it (it accepts either launch-options name anyway), and `withQuickLog` leaves
 * the launch options alone once this marker is there. Idempotent, and every patch warns instead of
 * failing when the template changes.
 */
const { withAppDelegate, withInfoPlist } = require("expo/config-plugins");

const MARK = "// kopiyka:scene-lifecycle";

function warn(what) {
  console.warn(`withSceneLifecycle: could not patch ${what} — AppDelegate.swift no longer matches. The app will crash at launch on iOS 27 until this is fixed.`);
}

const SCENE_DELEGATE = `
${MARK} — the window lives in a scene (iOS 27 refuses to launch an app built with its SDK without one).
@objc(KPSceneDelegate)
class KPSceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
    guard let windowScene = scene as? UIWindowScene,
          let app = UIApplication.shared.delegate as? AppDelegate,
          let factory = app.reactNativeFactory else { return }
    // A cold start's deep link, quick action or universal link comes with the scene now; React
    // Native reads its initial URL from the launch options, so that is where they go.
    var options = app.sceneLaunchOptions ?? [:]
    if let url = connectionOptions.urlContexts.first?.url { options[.url] = url }
    if let item = connectionOptions.shortcutItem { options[.shortcutItem] = item }
    if let activity = connectionOptions.userActivities.first {
      options[.userActivityDictionary] = [
        UIApplication.LaunchOptionsKey.userActivityType.rawValue: activity.activityType,
        "UIApplicationLaunchOptionsUserActivityKey": activity,
      ]
    }
    let window = UIWindow(windowScene: windowScene)
    self.window = window
    app.window = window
    factory.startReactNative(withModuleName: "main", in: window, launchOptions: KPQuickLog.launchOptions(for: options))
  }

  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    guard let app = UIApplication.shared.delegate as? AppDelegate else { return }
    for context in URLContexts {
      var options: [UIApplication.OpenURLOptionsKey: Any] = [:]
      if let source = context.options.sourceApplication { options[.sourceApplication] = source }
      if let annotation = context.options.annotation { options[.annotation] = annotation }
      _ = app.application(UIApplication.shared, open: context.url, options: options)
    }
  }

  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    _ = (UIApplication.shared.delegate as? AppDelegate)?.application(UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
  }

#if os(iOS)
  func windowScene(_ windowScene: UIWindowScene, performActionFor shortcutItem: UIApplicationShortcutItem, completionHandler: @escaping (Bool) -> Void) {
    guard let app = UIApplication.shared.delegate as? AppDelegate else { completionHandler(false); return }
    app.application(UIApplication.shared, performActionFor: shortcutItem, completionHandler: completionHandler)
  }
#endif
}
`;

/** @type {import('expo/config-plugins').ConfigPlugin} */
module.exports = (config) => {
  config = withInfoPlist(config, (c) => {
    c.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          { UISceneConfigurationName: "Default Configuration", UISceneDelegateClassName: "KPSceneDelegate" },
        ],
      },
    };
    return c;
  });
  return withAppDelegate(config, (c) => {
    let src = c.modResults.contents;
    if (src.includes(MARK)) return c;

    // The window and React Native's start move to the scene; the launch options wait for it.
    const start = /#if os\(iOS\) \|\| os\(tvOS\)\n {4}window = UIWindow\(frame: UIScreen\.main\.bounds\)\n {4}factory\.startReactNative\(\n {6}withModuleName: "main",\n {6}in: window,\n {6}launchOptions: (?:kpLaunchOptions|launchOptions)\)\n#endif\n/;
    if (!start.test(src)) { warn("the window start"); return c; }
    src = src.replace(start, `    ${MARK} — KPSceneDelegate makes the window and starts React Native when the scene connects.\n    sceneLaunchOptions = launchOptions\n`);

    const field = "  var reactNativeFactory: RCTReactNativeFactory?\n";
    if (!src.includes(field)) { warn("the factory property"); return c; }
    src = src.replace(field, field + `  /** What launched the app, for KPSceneDelegate to start React Native with. */\n  var sceneLaunchOptions: [UIApplication.LaunchOptionsKey: Any]?\n`);

    src = src.trimEnd() + "\n" + SCENE_DELEGATE;
    c.modResults.contents = src;
    return c;
  });
};
