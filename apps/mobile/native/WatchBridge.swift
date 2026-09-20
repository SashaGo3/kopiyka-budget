import Foundation
import WatchConnectivity
import WidgetKit
import CoreLocation

/// Phone side of the Apple Watch bridge. Runs inside the app process (also when
/// the system launches the app in the background to deliver a watch message).
///
/// Watch → phone messages (`type`):
///  - "state"          → reply { state: <KPWatchState JSON> }
///  - "addTransaction" → write into SQLite, reply { ok, state }
///  - "delete"         → tombstone a transaction, reply { ok, state }
///  - "suggest"        → { lat, lon, place? } → reply { category_id? } (core `suggestCategoryAt`).
///                       The watch sends no place name — it has no geocoder — so it gets the coordinate search.
/// Phone → watch: the full state as the application context (last value wins).
final class WatchBridge: NSObject, WCSessionDelegate {
  static let shared = WatchBridge()
  private var activated = false

  func activate() {
    guard WCSession.isSupported(), !activated else { return }
    activated = true
    WCSession.default.delegate = self
    WCSession.default.activate()
  }

  var isPaired: Bool { WCSession.isSupported() && WCSession.default.isPaired }

  /// Hand the current state to the watch. While JS owns the database this is simply the JSON file JS
  /// wrote just before calling `updateWatch`; otherwise it is built from SQLite (a few small queries).
  @discardableResult
  func pushState() -> String {
    let json = KPStore.buildState().json()
    if WCSession.isSupported(), WCSession.default.activationState == .activated, WCSession.default.isPaired, WCSession.default.isWatchAppInstalled {
      try? WCSession.default.updateApplicationContext(["state": json, "at": Date().timeIntervalSince1970])
    }
    return json
  }

  /// After a native write: widgets and the JS store (which backs up and refreshes).
  static func didWrite() {
    WidgetCenter.shared.reloadAllTimelines()
    NotificationCenter.default.post(name: KP.externalChange, object: nil)
  }

  /// Same naming rule as the app's `placeName`; runs after the reply so saving never waits for the network.
  private func geocode(id: String, lat: Double, lon: Double) {
    CLGeocoder().reverseGeocodeLocation(CLLocation(latitude: lat, longitude: lon)) { [weak self] marks, _ in
      guard let p = marks?.first, let place = p.kpPlaceName else { return }
      Task { if await KPWrites.updatePlace(id: id, place: place).ok { Self.didWrite(); self?.pushState() } }
    }
  }

  // MARK: WCSessionDelegate
  /// Activation finishes on a background WatchConnectivity thread a fraction of a second into
  /// launch — exactly while the JS runtime opens and migrates the same SQLite file with its own
  /// copy of SQLite. Reading here killed the app on cold start (TestFlight, 2026-09-08), so once
  /// JS owns the database we stay out of it: JS pushes the state itself right after it boots
  /// (`writeWidgetSnapshot` → `KPBridge.updateWatch`), and nothing is lost.
  func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
    guard activationState == .activated, !KPWrites.isClaimed else { return }
    pushInBackground()
  }
  func sessionDidBecomeInactive(_ session: WCSession) {}
  func sessionDidDeactivate(_ session: WCSession) { session.activate() }
  func sessionWatchStateDidChange(_ session: WCSession) { if session.isWatchAppInstalled { pushInBackground() } }

  /// Off the calling thread: `pushState` may read SQLite, and WatchConnectivity calls these
  /// delegate methods during app start-up.
  private func pushInBackground() {
    DispatchQueue.global(qos: .utility).async { [weak self] in _ = self?.pushState() }
  }

  func session(_ session: WCSession, didReceiveMessage message: [String: Any], replyHandler: @escaping ([String: Any]) -> Void) {
    Task { replyHandler(await handle(message)) }
  }
  func session(_ session: WCSession, didReceiveMessage message: [String: Any]) { Task { _ = await handle(message) } }
  func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) { Task { _ = await handle(userInfo) } }

  private func handle(_ m: [String: Any]) async -> [String: Any] {
    guard let type = m["type"] as? String else { return ["ok": false] }
    switch type {
    case "addTransaction":
      guard let account = m["account_id"] as? String, let minor = m["amount_minor"] as? Int else { return ["ok": false] }
      let id = (m["id"] as? String)?.isEmpty == false ? m["id"] as! String : UUID().uuidString.lowercased()
      let r = await KPWrites.addTransaction(id: id, accountId: account, amountMinor: minor, categoryId: m["category_id"] as? String,
                                            tagIds: m["tag_ids"] as? [String] ?? [], note: m["note"] as? String,
                                            lat: m["lat"] as? Double, lon: m["lon"] as? Double, place: m["place"] as? String, source: "watch")
      if r.ok {
        Self.didWrite()
        if let lat = m["lat"] as? Double, let lon = m["lon"] as? Double, (m["place"] as? String)?.isEmpty != false { geocode(id: id, lat: lat, lon: lon) }
      }
      var reply: [String: Any] = ["ok": r.ok, "state": pushState()]
      if !r.ok, let e = r.error { reply["error"] = e }
      return reply
    case "delete":
      guard let id = m["id"] as? String else { return ["ok": false] }
      let r = await KPWrites.deleteTransaction(id: id)
      if r.ok { Self.didWrite() }
      return ["ok": r.ok, "state": pushState()]
    case "suggest":
      guard let lat = m["lat"] as? Double, let lon = m["lon"] as? Double else { return ["ok": false] }
      var r: [String: Any] = ["ok": true]
      if let c = await KPStore.suggestCategoryNear(lat: lat, lon: lon) { r["category_id"] = c }
      return r
    case "state", "requestSnapshot", "lists":
      return ["ok": true, "state": pushState()]
    default:
      return ["ok": false]
    }
  }
}
