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

    Function("reloadWidgets") { WidgetCenter.shared.reloadAllTimelines() }
    AsyncFunction("updateWatch") { () -> String in WatchBridge.shared.pushState() }
    Function("isWatchPaired") { () -> Bool in WatchBridge.shared.isPaired }
    /// Read a receipt photo (file URI from the camera); returns what was understood, saves nothing.
    AsyncFunction("scanReceipt") { (uri: String) async throws -> [String: Any] in
      guard let url = URL(string: uri), let image = UIImage(contentsOfFile: url.path) else { throw KPReceipt.Failure.noImage }
      return KPReceipt.dictionary(try await KPReceipt.analyze(image: image))
    }
  }
}
