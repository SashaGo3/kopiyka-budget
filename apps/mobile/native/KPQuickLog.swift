import React
import UIKit

/// Routing for the quick-log entry points — `kopiyka://log` (Action button, Siri, Shortcuts,
/// `OpenLogIntent`) and the `dev.kopiyka.log` home-screen quick action.
///
/// The sheet they open is the app's own one: React Native's `src/app/log.tsx` replaces itself with
/// the Log sheet (`/transaction/new?kind=expense`, carrying `account`/`amount`). So all this layer
/// does is make sure the URL reaches React Native unchanged.
///
/// Until 2026-09 a native SwiftUI keypad answered these URLs so a cold start had something on
/// screen in the first frame. It was a second, poorer copy of the JS sheet (no date, place, photo,
/// split, transfer) and looked nothing like it, so it is gone; JS anchors the tabs and skips the
/// boot skeleton for deep links, which is fast enough.
@MainActor
enum KPQuickLog {
  /// Home-screen quick action (`UIApplicationShortcutItems` in app.json) and the launch-option key we match.
  static let quickActionType = "dev.kopiyka.log"

  /// A cold launch by the quick action delivered the URL through the launch options, so the
  /// `performActionFor` call iOS makes right after must not deliver it a second time.
  private static var consumedColdShortcut = false

  // MARK: Entry points used by the app delegate (patched in by plugins/withQuickLog.js)

  /// Cold start. The launch options React Native should get: unchanged, except that a launch by the
  /// quick action carries no URL — RN reads its initial deep link from `launchOptions[.url]`, so we
  /// synthesize `kopiyka://log` there.
  static func launchOptions(for options: [UIApplication.LaunchOptionsKey: Any]?) -> [UIApplication.LaunchOptionsKey: Any]? {
    consumedColdShortcut = false
    guard (options?[.shortcutItem] as? UIApplicationShortcutItem)?.type == quickActionType,
          options?[.url] == nil else { return options }
    consumedColdShortcut = true
    var out = options ?? [:]
    out[.url] = KP.url("log")
    return out
  }

  /// Already-running app. Always false: `kopiyka://log` is a JS route now, so the app delegate
  /// carries on to `RCTLinkingManager`. Kept as the seam, so intercepting a URL natively again
  /// stays a one-line change here instead of another AppDelegate patch.
  static func handleOpen(url: URL) -> Bool { false }

  // MARK: Opening our own deep links from inside the app

  /// Hands one of our own `kopiyka://…` URLs to React Native **inside this process** — for code
  /// that already runs in the app, such as `OpenLogIntent` after `openAppWhenRun` brought the app
  /// forward.
  ///
  /// Never `UIApplication.open` our own scheme for this: iOS treats it as one app opening another
  /// and slides the whole app in over itself, so with the app already running the user sees a
  /// second copy of Kopiyka appear as a modal card on top of the first. `RCTLinkingManager` posts
  /// exactly the notification a real deep link would, so JS routing is identical minus the app
  /// switch.
  ///
  /// The one thing the app switch did buy was time: `RCTLinkingManager` drops its event when JS is
  /// not listening yet, and the intent can be what launched the app. So when the app is not on
  /// screen yet the URL waits for the activation plus a beat, rather than for a guessed delay.
  static func deliver(_ url: URL) {
    guard UIApplication.shared.applicationState == .active else {
      var token: NSObjectProtocol?
      token = NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { _ in
        if let token { NotificationCenter.default.removeObserver(token) }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { post(url) }
      }
      return
    }
    post(url)
  }

  private static func post(_ url: URL) { RCTLinkingManager.application(UIApplication.shared, open: url, options: [:]) }

  /// Home-screen quick action. Returns the URL React Native should be handed, or nil when the item
  /// is not ours (or a cold launch already delivered it through the launch options).
  static func handleShortcut(_ item: UIApplicationShortcutItem) -> URL? {
    guard item.type == quickActionType else { return nil }
    if consumedColdShortcut { consumedColdShortcut = false; return nil }
    return KP.url("log")
  }
}
