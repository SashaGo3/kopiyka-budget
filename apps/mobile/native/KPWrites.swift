import Foundation

/// App-process half of `KPWrites` (the lock and `withDirectAccess` are in KPShared.swift, which every
/// target compiles): forwarding to the JS runtime while it owns the database.
///
/// expo-sqlite bundles its own SQLite; the system SQLite this Swift code links (`import SQLite3`)
/// is a second copy. Two copies of SQLite in one process cannot see each other's POSIX locks, so a
/// native write made while JS has the file open interleaves with JS writes and corrupts the WAL
/// (seen 2026-09-08: watch entries vanished after the next phone write, `integrity_check` reported
/// broken indexes). Therefore: while the JS runtime has the database open ("claimed"), every native
/// write is forwarded to JS (`nativeWrite` event → core repo → `finishNativeWrite`); only when JS is
/// not up (background launch by WatchConnectivity or an App Intent before the bundle ran) does Swift
/// write through `KPStore` itself.
///
/// Reads obey the same rule (2026-09-09): a *read-only* system-SQLite connection is not safe either.
/// Opening one on a WAL database makes the system copy take the DMS lock, believe it is the first
/// connection and TRUNCATE `kopiyka.db-shm` — which expo-sqlite has mmapped → SIGBUS. So while JS owns
/// the file native code never opens it at all; `KPStore` serves its readers from the JSON state file
/// JS writes (`KP.stateName`), and the one query too big for that file (`suggestCategoryNear`) is
/// forwarded over this same channel as op "suggest".
extension KPWrites {
  struct Result {
    let ok: Bool
    let error: String?
    /// Extra data from the JS side.
    let reply: [String: Any]
    static let ok = Result(ok: true, error: nil, reply: [:])
    static func fail(_ e: String?) -> Result { Result(ok: false, error: e, reply: [:]) }
  }

  nonisolated(unsafe) private static var forward: (([String: Any]) -> Void)?
  nonisolated(unsafe) private static var pending: [String: CheckedContinuation<Result, Never>] = [:]
  /// The timeout `Task` running alongside each pending continuation, so `finish` can cancel it once
  /// the real answer arrives instead of leaving it asleep for the rest of its timeout for nothing.
  nonisolated(unsafe) private static var pendingTimeouts: [String: Task<Void, Never>] = [:]

  /// JS calls this synchronously right before it opens the file. Blocks until any direct native
  /// access (a write, or a read holding an open connection) has closed its handle.
  static func claim(forward f: @escaping ([String: Any]) -> Void) {
    lock.lock(); claimed = true; forward = f; lock.unlock()
  }

  /// The JS runtime is going away (reload): answer whatever is still waiting and write directly again.
  static func release() {
    lock.lock()
    claimed = false; forward = nil
    let waiting = pending; pending = [:]
    let timeouts = pendingTimeouts; pendingTimeouts = [:]
    lock.unlock()
    for t in timeouts.values { t.cancel() }
    for c in waiting.values { c.resume(returning: .fail("The app reloaded")) }
  }

  /// JS reports the outcome of a forwarded write.
  static func finish(request: String, ok: Bool, error: String?, reply: [String: Any]) {
    lock.lock()
    let c = pending.removeValue(forKey: request)
    let t = pendingTimeouts.removeValue(forKey: request)
    lock.unlock()
    t?.cancel()
    c?.resume(returning: Result(ok: ok, error: error, reply: reply))
  }

  /// Run `direct` (system SQLite) when JS does not own the database, else send `op` to JS and wait for its answer.
  static func perform(_ op: [String: Any], timeout: TimeInterval = 8, direct: () -> Result) async -> Result {
    lock.lock()
    guard claimed, let fwd = forward else {
      // Hold the lock through the write so `claim()` (JS opening the file) waits for it to finish.
      let r = direct(); lock.unlock(); return r
    }
    lock.unlock()
    let request = UUID().uuidString
    var m = op; m["request"] = request
    return await withCheckedContinuation { (c: CheckedContinuation<Result, Never>) in
      // The timeout task is registered before `fwd(m)` runs, so even a reply that comes back
      // immediately can never race past `finish` cancelling it.
      let timeoutTask = Task {
        try? await Task.sleep(for: .seconds(timeout))
        // If `finish` already answered this request, cancellation made the sleep above throw and
        // `try?` swallowed it — calling `finish` again here is a harmless no-op (nothing pending).
        finish(request: request, ok: false, error: "The app did not answer", reply: [:])
      }
      lock.lock(); pending[request] = c; pendingTimeouts[request] = timeoutTask; lock.unlock()
      fwd(m)
    }
  }

  /// A *read* forwarded to JS over the same channel (only JS may touch the file while it is claimed).
  /// Fails fast when JS is not up — the caller then has a SQLite path of its own.
  static func query(_ op: [String: Any], timeout: TimeInterval = 3) async -> Result {
    await perform(op, timeout: timeout) { .fail("The app is not running") }
  }

  // MARK: Writes

  static func addTransaction(id: String? = nil, accountId: String, amountMinor: Int, categoryId: String?, tagIds: [String] = [], note: String?, payee: String? = nil,
                             lat: Double? = nil, lon: Double? = nil, place: String? = nil, pending: Bool = false, date: String? = nil, source: String? = nil,
                             enteredMinor: Int? = nil, enteredCurrency: String? = nil, rate: Double? = nil,
                             timeout: TimeInterval = 8) async -> Result {
    let id = id?.isEmpty == false ? id! : UUID().uuidString.lowercased()
    var op: [String: Any] = ["op": "addTransaction", "id": id, "account_id": accountId, "amount_minor": amountMinor, "tag_ids": tagIds, "pending": pending]
    if let c = categoryId, !c.isEmpty { op["category_id"] = c }
    if let n = note, !n.isEmpty { op["note"] = n }
    if let p = payee, !p.isEmpty { op["payee"] = p }
    if let p = place, !p.isEmpty { op["place"] = p }
    if let lat, let lon { op["lat"] = lat; op["lon"] = lon }
    if let d = date { op["date"] = d }
    if let s = source, !s.isEmpty { op["source"] = s }
    if let e = enteredMinor, let c = enteredCurrency, !c.isEmpty { op["entered_amount_minor"] = e; op["entered_currency"] = c }
    if let r = rate, r > 0 { op["exchange_rate"] = r }
    return await perform(op, timeout: timeout) {
      KPStore.addTransaction(id: id, accountId: accountId, amountMinor: amountMinor, categoryId: categoryId, tagIds: tagIds, note: note, payee: payee,
                             lat: lat, lon: lon, place: place, pending: pending, date: date, source: source,
                             enteredMinor: enteredMinor, enteredCurrency: enteredCurrency, rate: rate) ? .ok : .fail(KPStore.lastError)
    }
  }

  static func deleteTransaction(id: String) async -> Result {
    await perform(["op": "delete", "id": id]) { KPStore.deleteTransaction(id: id) ? .ok : .fail("Not found") }
  }

  static func updatePlace(id: String, place: String) async -> Result {
    await perform(["op": "updatePlace", "id": id, "place": place]) { KPStore.updatePlace(id: id, place: place) ? .ok : .fail(nil) }
  }
}

// MARK: - The one read that cannot come from the state file

extension KPStore {
  /// The category most used near a point. The location history behind it is far too big to ship in
  /// `watch-state.json`, so while JS owns the database the question is forwarded to it (op "suggest").
  /// `timeout` is the wait for that forwarded answer; a notification automation (`LogPaymentIntent`)
  /// has seconds for everything it does and shortens it, rather than spend the default on a nicety.
  static func suggestCategoryNear(lat: Double, lon: Double, place: String? = nil, radiusM: Double = nearRadiusM, timeout: TimeInterval = 3) async -> String? {
    if let id = localSuggestCategoryNear(lat: lat, lon: lon, place: place, radiusM: radiusM) { return id }
    guard KPWrites.isClaimed else { return nil }
    var op: [String: Any] = ["op": "suggest", "lat": lat, "lon": lon]
    // Free for a notification automation: Shortcuts hands over a placemark, so the better question
    // ("have I filed anything at this shop before?") costs nothing it was not already given.
    if let place, !place.isEmpty { op["place"] = place }
    return await KPWrites.query(op, timeout: timeout).reply["category_id"] as? String
  }

  private static func history(_ reply: [String: Any]) -> PayeeHistory {
    PayeeHistory(categoryId: reply["category_id"] as? String, tagIds: reply["tag_ids"] as? [String] ?? [],
                 place: reply["place"] as? String, lat: reply["lat"] as? Double, lon: reply["lon"] as? Double,
                 variants: reply["variants"] as? Int ?? 0, match: reply["match"] as? String)
  }

  /// What history knows about a shop or a note: the category and tags it was filed under last time and
  /// where it was. Not in the state file (no payees, no notes), so while JS owns the database this goes
  /// over the write channel (op "payee").
  static func payeeHistory(payee: String?, note: String?, timeout: TimeInterval = 3) async -> PayeeHistory {
    if let local = localPayeeHistory(payee: payee, note: note) { return local }
    guard KPWrites.isClaimed else { return .none }
    return history(await KPWrites.query(["op": "payee", "payee": payee ?? "", "note": note ?? ""], timeout: timeout).reply)
  }

  /// The same, plus the entry that may already be this charge (op "payment").
  /// One minute: Wallet and the bank app report the same tap seconds apart, and iOS re-delivers a
  /// notification just as quickly. Anything slower than that is a second purchase, not a second notice.
  static func paymentContext(accountId: String, amountMinor: Int, payee: String?, note: String? = nil, withinMinutes: Int = 1, timeout: TimeInterval = 3) async -> PaymentContext {
    if let local = localPaymentContext(accountId: accountId, amountMinor: amountMinor, payee: payee, note: note, withinMinutes: withinMinutes) { return local }
    guard KPWrites.isClaimed else { return PaymentContext() }
    let reply = await KPWrites.query(["op": "payment", "payee": payee ?? "", "note": note ?? "", "account_id": accountId,
                                      "amount_minor": amountMinor, "within_minutes": withinMinutes], timeout: timeout).reply
    let twin = (reply["twin"] as? [String: Any]).flatMap { t -> PaymentContext.Twin? in
      (t["id"] as? String).map { .init(id: $0, payee: t["payee"] as? String, place: t["place"] as? String,
                                       categoryId: t["category_id"] as? String, pending: (t["pending"] as? Int ?? 1) == 1) }
    }
    return PaymentContext(history: history(reply), twin: twin)
  }
}

extension KPWrites {
  /// Fill the empty fields of a pending entry another notification already created (op "fillIn").
  /// With `confirm`, one that ends up with a category also leaves the pending queue.
  static func fillIn(id: String, payee: String?, place: String?, categoryId: String?, tagIds: [String] = [],
                     lat: Double? = nil, lon: Double? = nil, confirm: Bool = false, timeout: TimeInterval = 8) async -> Result {
    var op: [String: Any] = ["op": "fillIn", "id": id, "confirm": confirm]
    if let p = payee, !p.isEmpty { op["payee"] = p }
    if let p = place, !p.isEmpty { op["place"] = p }
    if let c = categoryId, !c.isEmpty { op["category_id"] = c }
    if !tagIds.isEmpty { op["tag_ids"] = tagIds }
    if let lat, let lon { op["lat"] = lat; op["lon"] = lon }
    return await perform(op, timeout: timeout) {
      KPStore.fillIn(id: id, payee: payee, place: place, categoryId: categoryId, tagIds: tagIds, lat: lat, lon: lon, confirm: confirm) ? .ok : .fail("Nothing to fill in")
    }
  }
}
