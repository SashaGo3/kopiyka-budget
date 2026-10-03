internal import ExpoModulesCore
import WidgetKit
import UIKit
import WatchConnectivity
import Darwin

/// Wall-clock marks for the boot-time trace (Settings → Diagnostics "Last launch" card; JS side:
/// src/lib/boot.ts). All in ms since epoch, so JS can line them up with its own `Date.now()` marks.
private enum KPLaunch {
  /// Set from `KPBridgeModule`'s `OnCreate`, which Expo runs while the app delegate is still inside
  /// `didFinishLaunching`: close enough to "native ready" without patching AppDelegate.swift.
  nonisolated(unsafe) static var didFinishLaunching: Double?

  /// Exact process start (`kp_proc.p_starttime`), read from the kernel — unlike `ProcessInfo`, this
  /// is stable across the process lifetime and isn't affected by clock changes after launch.
  static func processStart() -> Double {
    var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()]
    var info = kinfo_proc()
    var size = MemoryLayout<kinfo_proc>.stride
    guard sysctl(&mib, u_int(mib.count), &info, &size, nil, 0) == 0 else { return Date().timeIntervalSince1970 * 1000 }
    let tv = info.kp_proc.p_starttime
    return Double(tv.tv_sec) * 1000 + Double(tv.tv_usec) / 1000
  }
}

/// Expo inline module (compiled into the app target from `native/`). JS side: src/lib/bridge.ts.
///  - reloadWidgets(): WidgetKit re-reads the snapshot the JS side just wrote
///  - updateWatch(): push the watch state (the JSON file JS just wrote) over WatchConnectivity
///  - "externalChange" event: a Shortcut, Siri or the watch wrote to the database; JS refreshes
///  - "nativeWrite" event: a write the native side wants JS to make on its behalf (KPWrites)
///  - launchTimestamps(): boot-trace marks for Settings → Diagnostics (src/lib/boot.ts)
///  - setLanguage(code): the app's language, for every Swift surface (native/KPLocale.swift)
///  - setAppIcon(id): the home-screen icon for a colour theme (plugins/withAppIcons.js)
///  - beginThemeTransition() / endThemeTransition(s): the cross-fade over a theme switch (KPThemeTransition)
///  - setWindowBackground(light, dark): the theme's background behind everything React draws
final class KPBridgeModule: Module {
  private var observer: NSObjectProtocol?
  /// The moment this module instance was created — Expo builds it while setting up the bridge,
  /// which is as close to "the JS runtime is starting" as native code can observe.
  private let jsStart = Date().timeIntervalSince1970 * 1000

  func definition() -> ModuleDefinition {
    Name("KPBridge")
    Events("externalChange", "nativeWrite")

    OnCreate {
      if KPLaunch.didFinishLaunching == nil { KPLaunch.didFinishLaunching = Date().timeIntervalSince1970 * 1000 }
      // Activation completes asynchronously and its callback reads SQLite; keep even that out of
      // the window in which expo-sqlite opens and migrates the same file (see WatchBridge).
      DispatchQueue.main.asyncAfter(deadline: .now() + 1) { WatchBridge.shared.activate() }
      self.observer = NotificationCenter.default.addObserver(forName: KP.externalChange, object: nil, queue: .main) { [weak self] _ in
        self?.sendEvent("externalChange", [:])
      }
    }
    OnDestroy {
      if let o = self.observer { NotificationCenter.default.removeObserver(o) }
      KPWrites.release()
    }

    /// JS calls this before opening the database: from now on native writes are forwarded to JS
    /// as "nativeWrite" events (two SQLite copies in one process must not write the same file — see KPWrites).
    Function("claimDatabase") { [weak self] in
      KPWrites.claim { m in self?.sendEvent("nativeWrite", m) }
    }
    /// Outcome of a forwarded write (src/lib/nativeWrites.ts).
    Function("finishNativeWrite") { (request: String, ok: Bool, error: String?, reply: [String: Any]) in
      KPWrites.finish(request: request, ok: ok, error: error, reply: reply)
    }

    /// Boot-trace marks, ms since epoch: kernel process start, "native ready" (this module's
    /// OnCreate), and "JS start" (this module's own creation). Sync — the timestamps already
    /// happened, there's nothing to await.
    Function("launchTimestamps") { [weak self] () -> [String: Double] in
      ["processStart": KPLaunch.processStart(), "didFinishLaunching": KPLaunch.didFinishLaunching ?? self?.jsStart ?? 0, "jsStart": self?.jsStart ?? 0]
    }

    /// The app's language (src/i18n). Stored in the App Group for every Swift surface (KPLocale);
    /// widgets redraw now, and the watch hears it with the next state push.
    Function("setLanguage") { (code: String) in
      guard KPL.store(code) else { return }
      WidgetCenter.shared.reloadAllTimelines()
    }

    Function("reloadWidgets") { WidgetCenter.shared.reloadAllTimelines() }
    AsyncFunction("updateWatch") { () -> String in WatchBridge.shared.pushState() }
    Function("isWatchPaired") { () -> Bool in WatchBridge.shared.isPaired }
    /// Read a receipt photo (file URI from the camera); returns what was understood, saves nothing.
    AsyncFunction("scanReceipt") { (uri: String) async throws -> [String: Any] in
      guard let url = URL(string: uri), let image = UIImage(contentsOfFile: url.path) else { throw KPReceipt.Failure.noImage }
      return KPReceipt.dictionary(try await KPReceipt.analyze(image: image))
    }

    /// The home-screen icon for a colour theme: "AppIcon-<id>" (an alternate set plugins/withAppIcons.js
    /// put into the asset catalogue), or nil for the primary icon. iOS shows its own "You have changed
    /// the icon" alert on success; there is no public way to suppress it. Asking for the icon already
    /// showing resolves without a call, so no alert appears for nothing.
    AsyncFunction("setAppIcon") { (id: String?, promise: Promise) in
      let name = id.flatMap { $0.isEmpty ? nil : "AppIcon-\($0)" }
      DispatchQueue.main.async {
        let app = UIApplication.shared
        guard app.supportsAlternateIcons else {
          promise.reject("ERR_APP_ICON_UNSUPPORTED", "This device does not support alternate app icons")
          return
        }
        guard app.alternateIconName != name else { promise.resolve(); return }
        app.setAlternateIconName(name) { error in
          if let error { promise.reject("ERR_APP_ICON", error.localizedDescription) } else { promise.resolve() }
        }
      }
    }

    /// Freeze the screen as it is: a snapshot of the key window laid over it, which the theme switch
    /// happens underneath (src/lib/theme.ts). Resolves once the snapshot is up; false when there is
    /// no window to cover, and the switch then simply happens in plain sight.
    AsyncFunction("beginThemeTransition") { (promise: Promise) in
      DispatchQueue.main.async { promise.resolve(KPThemeTransition.begin()) }
    }
    /// Fade the snapshot out over `duration` seconds, uncovering the app in its new colours. Resolves
    /// when the fade is over (or at once, with nothing to fade).
    AsyncFunction("endThemeTransition") { (duration: Double, promise: Promise) in
      DispatchQueue.main.async { KPThemeTransition.end(duration: duration) { promise.resolve() } }
    }
    /// The theme's background on the window and the root view, as a colour that follows light/dark:
    /// what shows behind a sheet as it slides, and wherever React has not drawn yet.
    Function("setWindowBackground") { (light: String, dark: String) in
      DispatchQueue.main.async { KPThemeTransition.setBackground(light: light, dark: dark) }
    }

    // Device odds and ends (native/KPDevice.swift; JS side: src/lib/device.ts).
    Function("copyToClipboard") { (text: String) in KPDevice.copy(text) }
    Function("readClipboard") { () -> String in KPDevice.paste() }
    /// The languages and region iOS is set to — where the app language and the onboarding currency start.
    Function("locales") { () -> [String: Any] in KPDevice.locales() }
    /// Apple Maps place search (MKLocalSearch): free, keyless, and no third party sees the query.
    AsyncFunction("searchPlaces") { (query: String, lat: Double?, lon: Double?, limit: Int) async throws -> [[String: Any]] in
      try await KPDevice.searchPlaces(query: query, lat: lat, lon: lon, limit: limit)
    }
  }
}

/// The theme switch's cover and the window's background (JS side: src/lib/theme.ts). Everything here
/// runs on the main thread; the module hops there before calling in.
///
/// The app's colours are DynamicColorIOS values baked into style sheets, so a switch is a re-mount of
/// the whole tree rather than colours animating in place. What makes it look animated is this: a
/// snapshot of the old screen goes over the window first, the tree re-mounts and finds its way back
/// underneath it, and then the snapshot fades away.
enum KPThemeTransition {
  nonisolated(unsafe) private static var cover: UIView?
  /// Bumped by every `begin`, so a safety timer only ever removes the snapshot it was set for.
  nonisolated(unsafe) private static var generation = 0
  /// If JS never says the new tree is up (an exception mid-switch), the cover still goes.
  private static let safety: TimeInterval = 2
  private static let safetyFade: TimeInterval = 0.35

  static func keyWindow() -> UIWindow? {
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    let scene = scenes.first { $0.activationState == .foregroundActive } ?? scenes.first
    return scene?.windows.first { $0.isKeyWindow } ?? scene?.windows.first
  }

  /// Lay a snapshot of the key window over it. A second call replaces the first snapshot.
  static func begin() -> Bool {
    guard let window = keyWindow(), let snapshot = window.snapshotView(afterScreenUpdates: false) else { return false }
    cover?.removeFromSuperview()
    snapshot.frame = window.bounds
    snapshot.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    // Taps land on the picture, not on the tree being rebuilt underneath it.
    snapshot.isUserInteractionEnabled = true
    snapshot.accessibilityElementsHidden = true
    window.addSubview(snapshot)
    cover = snapshot
    generation += 1
    let mine = generation
    DispatchQueue.main.asyncAfter(deadline: .now() + safety) {
      if mine == generation { end(duration: safetyFade) {} }
    }
    return true
  }

  /// Fade the snapshot out and remove it; `done` runs when it is gone (at once if there is none).
  static func end(duration: Double, done: @escaping () -> Void) {
    guard let snapshot = cover else { done(); return }
    cover = nil
    generation += 1
    UIView.animate(withDuration: max(0, duration), delay: 0, options: [.curveEaseInOut, .beginFromCurrentState], animations: {
      snapshot.alpha = 0
    }, completion: { _ in
      snapshot.removeFromSuperview()
      done()
    })
  }

  /// The theme's background, light and dark, on every window of the app's scenes and their root views.
  static func setBackground(light: String, dark: String) {
    guard let l = color(hex: light), let d = color(hex: dark) else { return }
    let dynamic = UIColor { $0.userInterfaceStyle == .dark ? d : l }
    for case let scene as UIWindowScene in UIApplication.shared.connectedScenes {
      for window in scene.windows {
        window.backgroundColor = dynamic
        window.rootViewController?.view.backgroundColor = dynamic
      }
    }
  }

  /// "#RGB", "#RRGGBB" or "#RRGGBBAA".
  static func color(hex: String) -> UIColor? {
    var s = hex.trimmingCharacters(in: .whitespaces)
    if s.hasPrefix("#") { s.removeFirst() }
    if s.count == 3 { s = s.map { "\($0)\($0)" }.joined() }
    guard s.count == 6 || s.count == 8, let v = UInt64(s, radix: 16) else { return nil }
    let rgba = s.count == 6 ? (v << 8) | 0xFF : v
    return UIColor(red: CGFloat((rgba >> 24) & 0xFF) / 255, green: CGFloat((rgba >> 16) & 0xFF) / 255,
                   blue: CGFloat((rgba >> 8) & 0xFF) / 255, alpha: CGFloat(rgba & 0xFF) / 255)
  }
}
