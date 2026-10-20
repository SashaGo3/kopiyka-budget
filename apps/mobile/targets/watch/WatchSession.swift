import Foundation
import SwiftUI
import WatchConnectivity
import WidgetKit
import CoreLocation
import MapKit

/// Watch side of the phone bridge. Holds the last `KPWatchState` the phone sent
/// (cached in the watch's App Group so it survives relaunches and feeds the
/// complications) and queues writes while the phone is out of reach.
///
/// Fast path: the phone is reachable → `sendMessage` returns the fresh state in the reply.
/// Slow path: `transferUserInfo` is queued by the system and delivered when the phone
/// is back; the phone then pushes a new application context, which clears the queue.
@MainActor
final class WatchSession: NSObject, ObservableObject {
  static let shared = WatchSession()

  struct Fix: Equatable { let lat: Double; let lon: Double; var place: String? }

  @Published var state: KPWatchState = KPWatchState.load() ?? .empty { didSet { rebuildHistory() } }
  /// Transactions saved on the watch that the phone has not confirmed yet.
  @Published var queued: [KPWatchState.Tx] = WatchSession.loadQueued() { didSet { rebuildHistory() } }
  /// History grouped by day with every label already formatted, so list rows are plain values
  /// (no lookups, no formatters, no session observation) — rebuilt only when the data changes.
  @Published private(set) var historyDays: [HistoryDay] = []
  @Published var reachable = false
  @Published var loading = false
  /// Only problems are shown ("iPhone could not save"); successes are announced to VoiceOver and land in History.
  @Published var problem: String?
  /// Coarse location for the next entry (same rule as the app: only when "Remember location" is on).
  @Published var fix: Fix?
  /// Category the phone suggests for this spot (core `suggestCategoryNear`, 150 m).
  @Published var suggestedCategoryId: String?
  struct SyncInfo { let at: Date; let text: String; let ok: Bool }
  /// Result of the last watch entry or deletion (Status page): "Saved on iPhone", "Waiting for iPhone", or why it failed.
  @Published var lastWrite: SyncInfo?

  private static let defaults = UserDefaults(suiteName: KP.appGroup) ?? .standard
  private var problemTask: Task<Void, Never>?
  /// The last state applied, without its timestamp: a reply that says nothing new is not applied again.
  private var appliedKey: String?
  /// When the phone was last asked. Launch alone asks twice (the scene turning active, the session
  /// activating); within a few seconds the second ask would only fetch the same state again.
  private var askedAt: Date?
  private let location = WatchLocation()

  var hasData: Bool { !state.accounts.isEmpty }
  /// History with queued rows on top, newest first.
  var history: [KPWatchState.Tx] { queued.reversed() + state.history }

  override init() {
    super.init()
    location.onFix = { [weak self] loc in Task { @MainActor in self?.gotFix(loc) } }
    rebuildHistory()
  }

  // MARK: History rows (precomputed)

  struct HistoryItem: Identifiable, Equatable {
    let id: String
    let transfer: Bool
    let icon: String            // SF Symbol
    let color: String?          // "#RRGGBB" or nil (gray)
    let title: String
    let amount: String
    let income: Bool
    let time: String
    let path: String            // "Folder › Category", "Transfer", "Uncategorized"
    let tags: [TagChip]
    let queued: Bool
    let pending: Bool
    // Only the entry's page shows these.
    let account: String
    let original: String?
    let note: String?
    let bankNote: String?
    let place: String?
    let lat: Double?
    let lon: Double?
    var accessibility: String {
      [title, amount, queued ? L10n.Watch.History.a11yWaiting : path, pending ? L10n.Watch.History.a11yPending : nil,
       tags.isEmpty ? nil : L10n.Watch.History.a11yTags(list: tags.map(\.name).joined(separator: ", ")),
       time.isEmpty ? nil : L10n.Watch.History.a11yAt(time: time)].compactMap { $0 }.joined(separator: ", ")
    }
  }
  struct TagChip: Identifiable, Equatable { let id: String; let name: String; let color: String? }
  struct HistoryDay: Identifiable, Equatable { let id: String; let label: String; var rows: [HistoryItem] }

  /// History shows only today and yesterday (plus anything still waiting for the iPhone); the phone keeps the rest.
  private static func recentDays() -> Set<String> {
    let now = Date()
    return Set([now, Calendar.current.date(byAdding: .day, value: -1, to: now) ?? now].map { KPFormat.dayParser.string(from: $0) })
  }

  /// Also called when the app comes to the front, so the day filter follows midnight even without new data.
  func rebuildHistory() {
    let cats = Dictionary(state.categories.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
    let tagsById = Dictionary(state.tags.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
    let accounts = Dictionary(state.accounts.map { ($0.id, $0.name) }, uniquingKeysWith: { a, _ in a })
    let queuedIds = Set(queued.map(\.id))
    let recent = Self.recentDays()
    var days: [HistoryDay] = []
    for t in queued.reversed() + state.history {
      let isQueued = queuedIds.contains(t.id)
      guard isQueued || recent.contains(t.day) else { continue }
      let c = t.category_id.flatMap { cats[$0] }
      let path = t.transfer ? L10n.Common.transfer : c.map { c in c.parent_name.map { "\($0) › \(c.name)" } ?? c.name } ?? L10n.Common.uncategorized
      let item = HistoryItem(
        id: t.id, transfer: t.transfer, icon: c?.icon ?? "tag.fill", color: c?.color, title: t.title,
        amount: KPFormat.money(t.amount, t.currency), income: t.amount > 0, time: t.time,
        path: isQueued ? L10n.Watch.History.waiting : path,
        tags: t.tag_ids.compactMap { tagsById[$0] }.map { TagChip(id: $0.id, name: $0.name, color: $0.color) }, queued: isQueued, pending: t.pending,
        account: accounts[t.account_id] ?? "", original: t.entered_amount.flatMap { a in t.entered_currency.map { KPFormat.money(a, $0) } },
        note: t.note, bankNote: t.bank_note, place: t.place, lat: t.lat, lon: t.lon)
      if days.last?.id == t.day { days[days.count - 1].rows.append(item) }
      else { days.append(HistoryDay(id: t.day, label: KPFormat.dayLabel(t.day), rows: [item])) }
    }
    if days != historyDays { historyDays = days }
  }

  func activate() {
    guard WCSession.isSupported() else { return }
    WCSession.default.delegate = self
    WCSession.default.activate()
  }

  /// Ask the phone for the latest state (no-op when it is not reachable; the application context covers that).
  /// `force` is a person asking (pull to refresh, the Refresh button); anything else skips a repeat ask.
  func refresh(force: Bool = false) {
    rebuildHistory()
    prepareLocation()
    guard WCSession.default.activationState == .activated, WCSession.default.isReachable else { return }
    if !force, loading || askedAt.map({ Date().timeIntervalSince($0) < 5 }) == true { return }
    askedAt = Date()
    loading = true
    send(["type": "state"]) { [weak self] reply in
      self?.loading = false
      if let json = reply["state"] as? String { self?.apply(json: json) }
    } failure: { [weak self] in self?.loading = false }
  }

  // MARK: Location (attached automatically, like the app's entry sheet)

  func prepareLocation() {
    guard state.location_enabled == true else { fix = nil; suggestedCategoryId = nil; return }
    location.request()
  }

  private func gotFix(_ loc: CLLocation) {
    let f = Fix(lat: loc.coordinate.latitude, lon: loc.coordinate.longitude, place: fix?.place)
    if fix?.lat != f.lat || fix?.lon != f.lon { fix = f; suggestedCategoryId = nil }
    if fix?.place == nil { reverseGeocode(loc) }
    if suggestedCategoryId == nil, WCSession.default.isReachable {
      send(["type": "suggest", "lat": f.lat, "lon": f.lon]) { [weak self] reply in self?.suggestedCategoryId = reply["category_id"] as? String } failure: {}
    }
  }

  /// Same naming rule as the app's `placeName`: the place's own name, else street and number, else
  /// the city. MapKit's request (watchOS 26) gives no district, so a street-less spot reads as its city.
  private func reverseGeocode(_ loc: CLLocation) {
    guard let request = MKReverseGeocodingRequest(location: loc) else { return }
    Task { @MainActor [weak self] in
      guard let item = try? await request.mapItems.first else { return }
      let street = item.address?.shortAddress?.split(separator: ",").first.map { $0.trimmingCharacters(in: .whitespaces) }
      let name = item.name.flatMap { $0.isEmpty || $0 == street ? nil : $0 }
      if let place = name ?? street ?? item.addressRepresentations?.cityName, self?.fix != nil { self?.fix?.place = place }
    }
  }

  // MARK: Writes

  /// Save a transaction. Amount in minor units (negative for expenses). Returns the optimistic row.
  @discardableResult
  func add(amountMinor: Int, account: KPWatchState.Account, category: KPWatchState.Category?, tagIds: [String], note: String? = nil) -> KPWatchState.Tx {
    let id = UUID().uuidString.lowercased()
    var m: [String: Any] = ["type": "addTransaction", "id": id, "account_id": account.id, "amount_minor": amountMinor, "tag_ids": tagIds]
    if let c = category { m["category_id"] = c.id }
    if let n = note, !n.isEmpty { m["note"] = n }
    if state.location_enabled == true, let f = fix { m["lat"] = f.lat; m["lon"] = f.lon; if let p = f.place { m["place"] = p } }
    let catLabel = category.map { c in c.parent_name.map { "\($0) › \(c.name)" } ?? c.name }
    let row = KPWatchState.Tx(id: id, date: KPStore.isoNow(), title: note?.isEmpty == false ? note! : (category?.name ?? L10n.Common.uncategorized),
                              sub: [account.name, catLabel].compactMap { $0 }.joined(separator: " · "),
                              amount: KPFormat.major(amountMinor, account.currency), currency: account.currency, account_id: account.id,
                              category_id: category?.id, tag_ids: tagIds, pending: false, transfer: false)
    queued.append(row); saveQueued()
    let money = KPFormat.money(abs(KPFormat.major(amountMinor, account.currency)), account.currency)
    deliver(m, savedText: category.map { L10n.Watch.Write.addedFor(amount: money, category: $0.name) } ?? L10n.Watch.Write.added(amount: money),
            queuedText: category.map { L10n.Watch.Write.queuedFor(amount: money, category: $0.name) } ?? L10n.Watch.Write.queued(amount: money))
    return row
  }

  /// Take a pending entry out of the Pending queue, filed under `category` first when one is chosen.
  /// The row reads as approved at once; the phone's reply (or its next state) has the final word.
  func approve(_ id: String, category: KPWatchState.Category? = nil) {
    // This row at once; the other leg of a transfer comes back approved with the phone's reply.
    state.history = state.history.map { r in
      guard r.id == id else { return r }
      return KPWatchState.Tx(id: r.id, date: r.date, title: r.title, sub: r.sub, amount: r.amount, currency: r.currency, account_id: r.account_id,
                             category_id: r.transfer ? r.category_id : category?.id ?? r.category_id, tag_ids: r.tag_ids, pending: false, transfer: r.transfer,
                             note: r.note, bank_note: r.bank_note, place: r.place, lat: r.lat, lon: r.lon, entered_amount: r.entered_amount, entered_currency: r.entered_currency)
    }
    var m: [String: Any] = ["type": "approve", "id": id]
    if let c = category { m["category_id"] = c.id }
    deliver(m, savedText: L10n.Watch.Write.approved, queuedText: L10n.Watch.Write.approveQueued)
  }

  /// sendMessage when the phone is reachable (instant, reply carries the new state), else a queued transfer.
  private func deliver(_ m: [String: Any], savedText: String, queuedText: String) {
    guard WCSession.default.activationState == .activated else { lastWrite = .init(at: .now, text: L10n.Watch.Write.notPaired, ok: false); showProblem(L10n.Watch.Write.notPaired); return }
    if WCSession.default.isReachable {
      send(m) { [weak self] reply in
        guard let self else { return }
        if let json = reply["state"] as? String { self.apply(json: json) }
        if reply["ok"] as? Bool == true {
          self.lastWrite = .init(at: .now, text: savedText, ok: true)
          self.announce(savedText)
        } else {
          let failed = (reply["error"] as? String).map { L10n.Watch.Write.failedWhy(reason: $0) } ?? L10n.Watch.Write.failed
          self.lastWrite = .init(at: .now, text: failed, ok: false)
          self.showProblem(L10n.Watch.Write.failed)
        }
      } failure: { [weak self] in
        WCSession.default.transferUserInfo(m)
        self?.lastWrite = .init(at: .now, text: queuedText, ok: true)
        self?.announce(queuedText)
      }
    } else {
      WCSession.default.transferUserInfo(m)
      lastWrite = .init(at: .now, text: queuedText, ok: true)
      announce(queuedText)
    }
  }

  private func send(_ m: [String: Any], reply: @escaping ([String: Any]) -> Void, failure: @escaping () -> Void) {
    WCSession.default.sendMessage(m, replyHandler: { r in Task { @MainActor in reply(r) } }, errorHandler: { _ in Task { @MainActor in failure() } })
  }

  private func announce(_ text: String) { AccessibilityNotification.Announcement(text).post() }

  private func showProblem(_ text: String) {
    problem = text
    announce(text)
    problemTask?.cancel()
    problemTask = Task { try? await Task.sleep(for: .seconds(4)); if !Task.isCancelled { problem = nil } }
  }

  private func apply(json: String) {
    guard let s = KPWatchState.from(json: json) else { return }
    // The same state again (most replies to an ask): only the time it was checked moves. Nothing to
    // write to disk, no history to rebuild.
    var probe = s; probe.generated_at = ""
    let key = probe.json()
    if appliedKey == nil { var mine = state; mine.generated_at = ""; appliedKey = mine.json() }
    if key == appliedKey { state.generated_at = s.generated_at; return }
    appliedKey = key
    let wasEnabled = state.location_enabled == true
    // The app's language rides along with the state. Stored before `state` is set, so the rebuilt
    // history rows ("Today", "Transfer") are already in it. The complication draws only the app's
    // mark and one word, so it is reloaded for the language and for nothing else.
    let languageChanged = s.language != nil && s.language != state.language
    if let language = s.language { KPL.store(language) }
    state = s
    s.save()
    let known = Set(s.history.map(\.id))
    if queued.contains(where: { known.contains($0.id) }) { queued.removeAll { known.contains($0.id) }; saveQueued() }
    if languageChanged { WidgetCenter.shared.reloadAllTimelines() }
    if (s.location_enabled == true) != wasEnabled { prepareLocation() }
  }

  private static func loadQueued() -> [KPWatchState.Tx] {
    guard let d = defaults.data(forKey: "queued"), let q = try? JSONDecoder().decode([KPWatchState.Tx].self, from: d) else { return [] }
    return q
  }
  private func saveQueued() { Self.defaults.set(try? JSONEncoder().encode(queued), forKey: "queued") }
}

extension WatchSession: WCSessionDelegate {
  nonisolated func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
    Task { @MainActor in
      self.reachable = session.isReachable
      if let json = session.receivedApplicationContext["state"] as? String, self.state.accounts.isEmpty { self.apply(json: json) }
      self.refresh()
    }
  }
  nonisolated func sessionReachabilityDidChange(_ session: WCSession) {
    Task { @MainActor in
      if self.reachable != session.isReachable { self.reachable = session.isReachable }
      if session.isReachable { self.refresh() }
    }
  }
  nonisolated func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
    if let json = applicationContext["state"] as? String { Task { @MainActor in self.apply(json: json) } }
  }
}

/// One-shot coarse fix; the watch shares the iPhone app's location authorization.
final class WatchLocation: NSObject, CLLocationManagerDelegate {
  var onFix: ((CLLocation) -> Void)?
  private let mgr = CLLocationManager()
  private var last: CLLocation?

  override init() { super.init(); mgr.delegate = self; mgr.desiredAccuracy = kCLLocationAccuracyHundredMeters }

  func request() {
    if let l = last, Date().timeIntervalSince(l.timestamp) < 300 { onFix?(l); return }
    switch mgr.authorizationStatus {
    case .notDetermined: mgr.requestWhenInUseAuthorization()
    case .denied, .restricted: return
    default: mgr.requestLocation()
    }
  }
  func locationManagerDidChangeAuthorization(_ m: CLLocationManager) {
    if m.authorizationStatus == .authorizedWhenInUse || m.authorizationStatus == .authorizedAlways { m.requestLocation() }
  }
  func locationManager(_ m: CLLocationManager, didUpdateLocations locs: [CLLocation]) { if let l = locs.last { last = l; onFix?(l) } }
  func locationManager(_ m: CLLocationManager, didFailWithError error: Error) {}
}
