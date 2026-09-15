import Foundation
import SQLite3

/// Shared constants and helpers for every Swift target. The phone app writes the
/// SQLite database and a JSON snapshot into the App Group container; extensions
/// read them directly, so widgets and intents work with the app closed.
///
/// This file is the single source of truth: `targets/*/KPShared.swift` are symlinks to it.
enum KP {
  static let appGroup = "group.dev.kopiyka"
  static let dbName = "kopiyka.db"
  static let snapshotName = "widget-snapshot.json"
  static let stateName = "watch-state.json"
  static let scheme = "kopiyka"

  static var container: URL? {
    FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)
  }
  static var dbURL: URL? { container?.appendingPathComponent(dbName) }
  static var snapshotURL: URL? { container?.appendingPathComponent(snapshotName) }
  static var stateURL: URL? { container?.appendingPathComponent(stateName) }

  static func url(_ path: String) -> URL { URL(string: "\(scheme)://\(path)")! }

  /// Posted in the phone process after an intent or the watch wrote to the database,
  /// so the JS store refreshes.
  static let externalChange = Notification.Name("KPExternalChange")
}

// MARK: - Snapshot (written by the app after every change)

struct KPSnapshot: Codable {
  struct Account: Codable, Identifiable { let id: String; let name: String; let currency: String; let balance: Double }
  struct NetWorth: Codable { let currency: String; let amount: Double }
  struct Budget: Codable, Identifiable {
    let category_id: String?; let name: String; let currency: String; let limit: Double; let spent: Double
    var id: String { (category_id ?? "all") + currency }
    var remaining: Double { limit - spent }
    var ratio: Double { limit > 0 ? min(1, spent / limit) : 0 }
  }
  struct Icon: Codable { let icon: String; let color: String }
  /// Travel mode: the running trip (a one-off budget for a tag). Absent in older snapshots or when off.
  struct Trip: Codable {
    let budget_id: String; let tag_id: String; let name: String; let currency: String; let limit: Double; let spent: Double
    let day: Int; let days: Int; let days_left: Int; let allowance: Double?
    var remaining: Double { limit - spent }
    var ratio: Double { limit > 0 ? min(1, spent / limit) : 0 }
    var dayLabel: String { days_left > 0 ? "Day \(day) of \(days)" : "Day \(day)" }
    /// The trip drawn like a budget row (widgets and complications reuse the budget views).
    var asBudget: Budget { .init(category_id: "trip:" + budget_id, name: name, currency: currency, limit: limit, spent: spent) }
  }
  let generated_at: String
  let accounts: [Account]
  let net_worth: [NetWorth]
  let budgets: [Budget]
  let month: String
  /// category id → SF Symbol + hex colour, resolved by the app's `iconFor` (may be absent in older snapshots).
  var category_icons: [String: Icon]?
  var trip: Trip?
  /// What a one-line budget surface should show: the trip while travelling, else the first budget.
  var featured: Budget? { trip?.asBudget ?? budgets.first }

  static let placeholder = KPSnapshot(
    generated_at: "", accounts: [.init(id: "a", name: "Account", currency: "PLN", balance: 3295.77), .init(id: "b", name: "Euro", currency: "EUR", balance: 2000)],
    net_worth: [.init(currency: "PLN", amount: 3295.77), .init(currency: "EUR", amount: 2000)],
    budgets: [.init(category_id: "1", name: "Food", currency: "PLN", limit: 2500, spent: 1610), .init(category_id: "2", name: "Fun", currency: "PLN", limit: 800, spent: 720)],
    month: "September 2026", category_icons: nil, trip: nil)

  static func load() -> KPSnapshot? {
    guard let url = KP.snapshotURL, let data = try? Data(contentsOf: url) else { return nil }
    return try? JSONDecoder().decode(KPSnapshot.self, from: data)
  }
}

// MARK: - Watch state (phone → watch, one JSON blob; also what intents read)

/// Everything the watch needs to log and browse offline. Built on the phone from
/// SQLite (`KPStore.buildState`), sent through WatchConnectivity as the application
/// context (last value wins) and cached in the watch's App Group.
struct KPWatchState: Codable {
  struct Account: Codable, Identifiable, Hashable { let id: String; let name: String; let currency: String; let balance: Double }
  struct Category: Codable, Identifiable, Hashable {
    let id: String; let name: String; let parent_id: String?; let parent_name: String?; let kind: String; let icon: String?; let color: String?
    /// Transactions in the last 180 days, the app's picker ordering key.
    let uses: Int
    /// The user's own hint ("groceries, bakery"), what the receipt reader matches merchants against.
    var description: String? = nil
  }
  /// The home the app knows (meta `home_lat`/`home_lon`); no category is suggested near it.
  struct Home: Codable, Hashable { let lat: Double; let lon: Double }
  struct Tag: Codable, Identifiable, Hashable { let id: String; let name: String; let color: String?; let category_ids: [String]; let uses: Int }
  struct Tx: Codable, Identifiable, Hashable {
    let id: String; let date: String; let title: String; let sub: String; let amount: Double; let currency: String
    let account_id: String; let category_id: String?; let tag_ids: [String]; let pending: Bool; let transfer: Bool
    var day: String { String(date.prefix(10)) }
    var time: String { date.count >= 16 ? String(date[date.index(date.startIndex, offsetBy: 11)..<date.index(date.startIndex, offsetBy: 16)]) : "" }
  }
  var generated_at: String
  var current_account: String
  var accounts: [Account]
  var categories: [Category]
  var tags: [Tag]
  /// category_id → tag_id → number of transactions in that exact category carrying the tag.
  var together: [String: [String: Int]]
  var history: [Tx]
  var snapshot: KPSnapshot?
  /// The app's "Remember location" setting (meta `location_enabled`); the watch attaches a fix only when on.
  var location_enabled: Bool?
  /// Everything below is written by JS from wave 2 on and absent in older files — hence optional.
  var home: Home? = nil
  /// Newest cached exchange rate per "BASE>QUOTE" pair; the inverse is derived when only one side is stored.
  var rates: [String: Double]? = nil
  /// Settings → Automate with Shortcut → "Tell me when it logs something" (meta `shortcut_notify`).
  /// Absent — an older file, or no answer at all — means on.
  var shortcut_notify: Bool? = nil

  static let empty = KPWatchState(generated_at: "", current_account: "", accounts: [], categories: [], tags: [], together: [:], history: [], snapshot: nil, location_enabled: false)

  static func load() -> KPWatchState? {
    guard let url = KP.stateURL, let data = try? Data(contentsOf: url) else { return nil }
    return try? JSONDecoder().decode(KPWatchState.self, from: data)
  }
  func save() {
    guard let url = KP.stateURL, let data = try? JSONEncoder().encode(self) else { return }
    try? data.write(to: url, options: .atomic)
    if let s = snapshot, let su = KP.snapshotURL, let sd = try? JSONEncoder().encode(s) { try? sd.write(to: su, options: .atomic) }
  }
  func json() -> String { (try? JSONEncoder().encode(self)).flatMap { String(data: $0, encoding: .utf8) } ?? "{}" }
  static func from(json: String) -> KPWatchState? { json.data(using: .utf8).flatMap { try? JSONDecoder().decode(KPWatchState.self, from: $0) } }

  var defaultAccount: Account? { accounts.first { $0.id == current_account } ?? accounts.first }
  func category(_ id: String?) -> Category? { id.flatMap { i in categories.first { $0.id == i } } }
}

/// A tag's colour when it has none of its own: one stable hue per name, so a row of tags is not a
/// row of identical chips. Mirrors core `tagColor` (packages/core/src/icons.ts) exactly — same FNV
/// hash over the UTF-16 of the trimmed, lower-cased, NFC name and the same palette — because the
/// same tag has to look the same on the watch as it does on the phone.
enum KPTagColor {
  static let palette = ["#0A84FF", "#34C759", "#FF9F0A", "#FF375F", "#BF5AF2", "#64D2FF", "#FFD60A", "#5E5CE6", "#FF2D55", "#30D158", "#FF9500", "#AF52DE"]

  static func hex(_ name: String, _ explicit: String?) -> String {
    if let e = explicit, !e.isEmpty { return e }
    let key = name.precomposedStringWithCanonicalMapping.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    guard !key.isEmpty else { return palette[0] }
    var h: UInt32 = 2166136261
    for u in key.utf16 { h ^= UInt32(u); h = h &* 16777619 }
    h ^= h >> 15; h = h &* 2246822507; h ^= h >> 13
    return palette[Int(h % UInt32(palette.count))]
  }
}

// MARK: - Ranking (mirrors apps/mobile/src/app/pick/category.tsx and pick/tags.tsx)

enum KPRank {
  /// Categories of one kind, most used first, then by name. Same as the app's picker — folders
  /// included, which is to say: not offered at all. A folder is how the list is divided, never a
  /// place to file money (core `folderIds`), and an intent that offered one would file transactions
  /// where the app itself cannot. A top-level category with nothing inside it is not a folder.
  static func categories(_ all: [KPWatchState.Category], kind: String) -> [KPWatchState.Category] {
    let wanted = kind == "income" ? "income" : "expense"
    let byId = Dictionary(uniqueKeysWithValues: all.map { ($0.id, $0) })
    let folders = Set(all.compactMap(\.parent_id))
    return all
      .filter { c in !folders.contains(c.id) && (c.kind == wanted || (c.parent_id.flatMap { byId[$0] }?.kind == wanted)) }
      .sorted { a, b in a.uses != b.uses ? a.uses > b.uses : a.name.localizedCompare(b.name) == .orderedAscending }
  }

  struct RankedTag: Identifiable, Hashable { let tag: KPWatchState.Tag; let rank: Int; let together: Int; var id: String { tag.id } }

  /// Tags for a category: assigned or used-together tags first (rank 0), unscoped tags next (rank 1);
  /// tags meant for other categories are hidden unless already selected.
  static func tags(_ all: [KPWatchState.Tag], category: KPWatchState.Category?, categories: [KPWatchState.Category], together: [String: [String: Int]], selected: Set<String> = []) -> [RankedTag] {
    let scope: Set<String> = [category?.id ?? "", category?.parent_id ?? ""]
    // Transactions of this category, its folder and its siblings (the app's query joins on the parent).
    var withCat: [String: Int] = [:]
    if let c = category {
      var ids: [String] = [c.id]
      if let p = c.parent_id { ids.append(p); ids += categories.filter { $0.parent_id == p }.map(\.id) }
      for id in Set(ids) { for (t, n) in together[id] ?? [:] { withCat[t, default: 0] += n } }
    }
    func rank(_ t: KPWatchState.Tag) -> Int {
      let ids = t.category_ids
      if !ids.isEmpty && !ids.contains(where: { scope.contains($0) }) { return 2 }
      return (!ids.isEmpty || withCat[t.id] != nil) ? 0 : 1
    }
    return all.map { RankedTag(tag: $0, rank: rank($0), together: withCat[$0.id] ?? 0) }
      .filter { $0.rank < 2 || selected.contains($0.tag.id) }
      .sorted { a, b in
        if a.rank != b.rank { return a.rank < b.rank }
        if a.together != b.together { return a.together > b.together }
        if a.tag.uses != b.tag.uses { return a.tag.uses > b.tag.uses }
        return a.tag.name.localizedCompare(b.tag.name) == .orderedAscending
      }
  }
}

// MARK: - Money formatting

enum KPFormat {
  static func decimals(_ currency: String) -> Int {
    switch currency.uppercased() { case "JPY", "KRW": return 0; case "BHD", "KWD": return 3; default: return 2 }
  }
  /// One formatter per fraction-digit count, built once: a `NumberFormatter` costs more to
  /// create than to use, and the watch's history list formats every row on every render.
  private static let moneyFormatters: [NumberFormatter] = (0...3).map { d in
    let f = NumberFormatter()
    f.numberStyle = .decimal
    f.minimumFractionDigits = d
    f.maximumFractionDigits = d
    f.groupingSeparator = " "
    return f
  }
  static func money(_ amount: Double, _ currency: String, decimals: Int? = nil) -> String {
    let d = max(0, min(3, decimals ?? Self.decimals(currency)))
    let body = moneyFormatters[d].string(from: NSNumber(value: amount)) ?? "\(amount)"
    return "\(body) \(currency)"
  }
  static func compact(_ amount: Double) -> String {
    let a = abs(amount)
    let s: String
    if a >= 1_000_000 { s = String(format: "%.1fM", a / 1_000_000) }
    else if a >= 10_000 { s = String(format: "%.0fk", a / 1_000) }
    else if a >= 1_000 { s = String(format: "%.1fk", a / 1_000) }
    else { s = String(format: "%.0f", a) }
    return amount < 0 ? "−" + s : s
  }
  static func minor(_ amount: Double, _ currency: String) -> Int { Int((amount * pow(10, Double(decimals(currency)))).rounded()) }
  static func major(_ minor: Int, _ currency: String) -> Double { Double(minor) / pow(10, Double(decimals(currency))) }

  /// "Today", "Yesterday", else "Mon 7 Sep" for a yyyy-MM-dd day.
  static let dayParser: DateFormatter = { let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "yyyy-MM-dd"; return f }()
  private static let dayPrinter: DateFormatter = { let o = DateFormatter(); o.setLocalizedDateFormatFromTemplate("EEE d MMM"); return o }()
  static let timePrinter: DateFormatter = { let f = DateFormatter(); f.dateStyle = .none; f.timeStyle = .short; return f }()
  static let iso8601 = ISO8601DateFormatter()
  /// JS writes `generated_at` with milliseconds (`Date.toISOString()`), Swift without; ISO8601DateFormatter is strict about the difference.
  private static let iso8601Fractional: ISO8601DateFormatter = { let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f }()
  static func parseIso(_ s: String) -> Date? { iso8601.date(from: s) ?? iso8601Fractional.date(from: s) }
  static func dayLabel(_ day: String) -> String {
    guard let d = dayParser.date(from: day) else { return day }
    if Calendar.current.isDateInToday(d) { return "Today" }
    if Calendar.current.isDateInYesterday(d) { return "Yesterday" }
    return dayPrinter.string(from: d)
  }
}

/// Category with folder name, description and usage: what the receipt reader chooses from.
struct KPCategoryRef {
  let id: String; let name: String; let parent: String?; let description: String?; let uses: Int
  var path: String { parent.map { "\($0) › \(name)" } ?? name }
}

// MARK: - Who owns the database right now

/// The lock that decides whether Swift may open `kopiyka.db`.
///
/// It lives here because `KPStore` needs it and this file is compiled into every target; the other
/// half — forwarding writes and reads to the JS runtime — is in `native/KPWrites.swift`, which only
/// the app target has. In an extension process nothing ever claims the file (extensions are separate
/// processes, where POSIX locks work normally), so `isClaimed` stays false and reads go to SQLite.
enum KPWrites {
  /// Recursive: `perform` holds it across its `direct` closure, which re-enters through `withDirectAccess`.
  static let lock = NSRecursiveLock()
  /// True while the JS runtime owns the database (set by `claim`/`release` in the app process).
  nonisolated(unsafe) static var claimed = false

  static var isClaimed: Bool { lock.lock(); defer { lock.unlock() }; return claimed }

  /// The only way into the database: runs `body` with the lock held — so `claim()` waits for it —
  /// and refuses (nil, without running) while JS owns the file.
  static func withDirectAccess<T>(_ body: () -> T?) -> T? {
    lock.lock(); defer { lock.unlock() }
    guard !claimed else { return nil }
    return body()
  }
}

// MARK: - Direct SQLite access (intents and the watch bridge; the app may be closed)

/// Mirrors `createTransaction` + `sync_outbox` from the core package.
/// Keep column lists in sync with packages/core/src/schema.ts and repo.ts.
enum KPStore {
  struct AccountRef { let id: String; let name: String; let currency: String }
  struct CategoryRef { let id: String; let name: String; let parentName: String? }

  /// The single door to SQLite from Swift. Opens a connection, runs `body`, closes it — all with the
  /// KPWrites lock held, so `claim()` (JS about to open the file) waits for it — and returns nil
  /// *without opening anything* while JS owns the database.
  ///
  /// There is deliberately no read-only variant. Two SQLite copies live in this process (expo-sqlite's
  /// and the system one this file links) and cannot see each other's locks; a read-only handle opening
  /// a WAL database takes the DMS lock, believes it is the first connection and TRUNCATES the -shm file
  /// JS has mmapped → SIGBUS (crash 2026-09-09). Readers therefore fall back to `fileState()` instead.
  static func withDatabase<T>(_ body: (OpaquePointer) -> T?) -> T? {
    KPWrites.withDirectAccess {
      guard let url = KP.dbURL, FileManager.default.fileExists(atPath: url.path) else { return nil }
      var handle: OpaquePointer?
      guard sqlite3_open_v2(url.path, &handle, SQLITE_OPEN_READWRITE, nil) == SQLITE_OK, let db = handle else {
        if handle != nil { sqlite3_close(handle) }
        return nil
      }
      defer { sqlite3_close(db) }
      sqlite3_busy_timeout(db, 3000)
      return body(db)
    }
  }

  /// What every reader falls back to: the JSON state file the app writes after each batch of changes.
  /// Decoded once per file version — the intents and the quick-log sheet ask for it several times in a row.
  private static let stateLock = NSLock()
  nonisolated(unsafe) private static var stateCache: (stamp: Date, size: Int, state: KPWatchState)?
  static func fileState() -> KPWatchState? {
    guard let url = KP.stateURL,
          let v = try? url.resourceValues(forKeys: [.contentModificationDateKey, .fileSizeKey]),
          let stamp = v.contentModificationDate else { return nil }
    let size = v.fileSize ?? 0
    stateLock.lock(); defer { stateLock.unlock() }
    if let c = stateCache, c.stamp == stamp, c.size == size { return c.state }
    guard let s = KPWatchState.load() else { return nil }
    stateCache = (stamp, size, s)
    return s
  }

  private static let T = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

  /// A settings row. While JS owns the database only the keys the state file carries can be answered.
  static func meta(_ key: String) -> String? {
    withDatabase { meta($0, key) } ?? fileMeta(key)
  }

  private static func meta(_ db: OpaquePointer, _ key: String) -> String? {
    var stmt: OpaquePointer?
    guard sqlite3_prepare_v2(db, "SELECT value FROM meta WHERE key=?", -1, &stmt, nil) == SQLITE_OK else { return nil }
    defer { sqlite3_finalize(stmt) }
    sqlite3_bind_text(stmt, 1, key, -1, T)
    return sqlite3_step(stmt) == SQLITE_ROW ? str(stmt, 0) : nil
  }

  private static func fileMeta(_ key: String) -> String? {
    guard let s = fileState() else { return nil }
    switch key {
    case "current_account": return s.current_account
    case "location_enabled": return (s.location_enabled ?? false) ? "1" : "0"
    case "shortcut_notify": return (s.shortcut_notify ?? true) ? "1" : "0"
    case "home_lat": return s.home.map { String($0.lat) }
    case "home_lon": return s.home.map { String($0.lon) }
    default: return nil
    }
  }

  static func currentAccountId() -> String { meta("current_account") ?? "" }

  /// Travel mode (core `activeTripTagId`): the tag every new expense gets while a trip runs.
  static func activeTripTagId(_ db: OpaquePointer) -> String? {
    var stmt: OpaquePointer?
    guard sqlite3_prepare_v2(db, "SELECT tag_id FROM budgets WHERE deleted=0 AND period='once' AND tag_id IS NOT NULL AND ended IS NULL ORDER BY starts DESC, rowid DESC LIMIT 1", -1, &stmt, nil) == SQLITE_OK else { return nil }
    defer { sqlite3_finalize(stmt) }
    guard sqlite3_step(stmt) == SQLITE_ROW else { return nil }
    let t = str(stmt, 0)
    return t.isEmpty ? nil : t
  }

  static func accounts() -> [AccountRef] {
    withDatabase { accounts($0) } ?? fileState()?.accounts.map { .init(id: $0.id, name: $0.name, currency: $0.currency) } ?? []
  }

  private static func accounts(_ db: OpaquePointer) -> [AccountRef] {
    var stmt: OpaquePointer?
    guard sqlite3_prepare_v2(db, "SELECT id, name, currency FROM accounts WHERE deleted=0 AND archived=0 ORDER BY sort, name", -1, &stmt, nil) == SQLITE_OK else { return [] }
    defer { sqlite3_finalize(stmt) }
    var out: [AccountRef] = []
    while sqlite3_step(stmt) == SQLITE_ROW { out.append(.init(id: str(stmt, 0), name: str(stmt, 1), currency: str(stmt, 2))) }
    return out
  }

  /// Just the accounts and which one is current — what an intent needs before it can write. `buildState()`
  /// also scans every transaction for tags, categories and history, which a card-payment automation
  /// throws away and cannot afford: Shortcuts gives it seconds, not tens of seconds.
  static func accountList() -> (accounts: [KPWatchState.Account], current: String) {
    if let r = withDatabase({ db -> (accounts: [KPWatchState.Account], current: String) in
      // Balance is not needed here — an intent never shows one — so 0 avoids joining the snapshot in.
      let list = accounts(db).map { KPWatchState.Account(id: $0.id, name: $0.name, currency: $0.currency, balance: 0) }
      return (list, meta(db, "current_account") ?? "")
    }) { return r }
    if let s = fileState() { return (s.accounts, s.current_account) }
    return ([], "")
  }

  /// The account an intent should default to when none was picked: mirrors `KPWatchState.defaultAccount`.
  static func defaultAccount(_ accounts: [KPWatchState.Account], current: String) -> KPWatchState.Account? {
    accounts.first { $0.id == current } ?? accounts.first
  }

  /// Categories with folder name, description and usage, for the receipt reader. Folders are left
  /// out: the reader chooses what to file a receipt under, and a folder is not one of the answers.
  static func categoryRefs() -> [KPCategoryRef] {
    if let r = withDatabase({ categoryRefs($0) }) { return r }
    let cats = fileState()?.categories ?? []
    let folders = Set(cats.compactMap(\.parent_id))
    return cats.filter { $0.kind == "expense" && !folders.contains($0.id) }
      .map { .init(id: $0.id, name: $0.name, parent: $0.parent_name, description: $0.description, uses: $0.uses) }
  }

  /// Works before the `description` column exists (older database): falls back to a query without it.
  private static func categoryRefs(_ db: OpaquePointer) -> [KPCategoryRef] {
    func run(_ sql: String, described: Bool) -> [KPCategoryRef]? {
      var stmt: OpaquePointer?
      guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return nil }
      defer { sqlite3_finalize(stmt) }
      sqlite3_bind_text(stmt, 1, sinceDay(), -1, T)
      var out: [KPCategoryRef] = []
      while sqlite3_step(stmt) == SQLITE_ROW {
        out.append(.init(id: str(stmt, 0), name: str(stmt, 1), parent: opt(stmt, 2), description: described ? opt(stmt, 3) : nil, uses: Int(sqlite3_column_int(stmt, 4))))
      }
      return out
    }
    let uses = "(SELECT COUNT(*) FROM transactions t WHERE t.deleted=0 AND t.category_id=c.id AND t.date>=?) AS uses"
    // "Has nothing inside it" is what makes a row pickable, the same rule as core's `folderIds`.
    let leaf = "NOT EXISTS (SELECT 1 FROM categories k WHERE k.deleted=0 AND k.parent_id=c.id)"
    return run("SELECT c.id, c.name, p.name, c.description, \(uses) FROM categories c LEFT JOIN categories p ON p.id=c.parent_id WHERE c.deleted=0 AND c.kind='expense' AND \(leaf) ORDER BY c.sort, c.name", described: true)
      ?? run("SELECT c.id, c.name, p.name, NULL, \(uses) FROM categories c LEFT JOIN categories p ON p.id=c.parent_id WHERE c.deleted=0 AND c.kind='expense' AND \(leaf) ORDER BY c.sort, c.name", described: false)
      ?? []
  }

  /// Newest cached exchange rate (core `latestCachedRate`): quote units per 1 base, either direction.
  static func cachedRate(from: String, to: String) -> Double? {
    if from == to { return 1 }
    if let r = withDatabase({ cachedRate($0, from: from, to: to) }) { return r }
    guard let rates = fileState()?.rates else { return nil }
    if let r = rates["\(from)>\(to)"] { return r }
    if let r = rates["\(to)>\(from)"], r > 0 { return 1 / r }
    return nil
  }

  private static func cachedRate(_ db: OpaquePointer, from: String, to: String) -> Double? {
    func look(_ b: String, _ q: String) -> Double? {
      var stmt: OpaquePointer?
      guard sqlite3_prepare_v2(db, "SELECT rate FROM exchange_rates WHERE base=? AND quote=? ORDER BY day DESC LIMIT 1", -1, &stmt, nil) == SQLITE_OK else { return nil }
      defer { sqlite3_finalize(stmt) }
      sqlite3_bind_text(stmt, 1, b, -1, T); sqlite3_bind_text(stmt, 2, q, -1, T)
      return sqlite3_step(stmt) == SQLITE_ROW ? sqlite3_column_double(stmt, 0) : nil
    }
    if let r = look(from, to) { return r }
    if let r = look(to, from), r > 0 { return 1 / r }
    return nil
  }

  /// Every live category with its folder and the last-180-day usage count.
  static func categories() -> [KPWatchState.Category] {
    withDatabase { categories($0) } ?? fileState()?.categories ?? []
  }

  /// `c.description` arrived in a later migration, so an older database falls back to a NULL column.
  private static func categories(_ db: OpaquePointer) -> [KPWatchState.Category] {
    func run(_ described: String) -> [KPWatchState.Category]? {
      var stmt: OpaquePointer?
      let sql = """
        SELECT c.id, c.name, c.parent_id, p.name, c.kind, c.icon, c.color,
          (SELECT COUNT(*) FROM transactions t WHERE t.deleted=0 AND t.category_id=c.id AND t.date>=?) AS uses, \(described)
        FROM categories c LEFT JOIN categories p ON p.id=c.parent_id WHERE c.deleted=0 ORDER BY c.sort, c.name
        """
      guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return nil }
      defer { sqlite3_finalize(stmt) }
      sqlite3_bind_text(stmt, 1, sinceDay(), -1, T)
      var out: [KPWatchState.Category] = []
      while sqlite3_step(stmt) == SQLITE_ROW {
        out.append(.init(id: str(stmt, 0), name: str(stmt, 1), parent_id: opt(stmt, 2), parent_name: opt(stmt, 3), kind: str(stmt, 4),
                         icon: opt(stmt, 5), color: opt(stmt, 6), uses: Int(sqlite3_column_int64(stmt, 7)), description: opt(stmt, 8)))
      }
      return out
    }
    return run("c.description") ?? run("NULL") ?? []
  }

  /// Tags with recent usage, plus the category → tag co-occurrence counts the app's tag picker ranks by.
  static func tags() -> (tags: [KPWatchState.Tag], together: [String: [String: Int]]) {
    if let r = withDatabase({ tags($0) }) { return r }
    guard let s = fileState() else { return ([], [:]) }
    return (s.tags, s.together)
  }

  private static func tags(_ db: OpaquePointer) -> (tags: [KPWatchState.Tag], together: [String: [String: Int]]) {
    var usage: [String: Int] = [:]
    var together: [String: [String: Int]] = [:]
    var stmt: OpaquePointer?
    if sqlite3_prepare_v2(db, "SELECT category_id, tag_ids, date>=? FROM transactions WHERE deleted=0 AND tag_ids<>'[]'", -1, &stmt, nil) == SQLITE_OK {
      sqlite3_bind_text(stmt, 1, sinceDay(), -1, T)
      while sqlite3_step(stmt) == SQLITE_ROW {
        let cat = opt(stmt, 0)
        let ids = jsonIds(str(stmt, 1))
        let recent = sqlite3_column_int(stmt, 2) == 1
        for id in ids {
          if recent { usage[id, default: 0] += 1 }
          if let c = cat { together[c, default: [:]][id, default: 0] += 1 }
        }
      }
      sqlite3_finalize(stmt)
    }
    var out: [KPWatchState.Tag] = []
    if sqlite3_prepare_v2(db, "SELECT id, name, color, category_ids FROM tags WHERE deleted=0 ORDER BY name", -1, &stmt, nil) == SQLITE_OK {
      while sqlite3_step(stmt) == SQLITE_ROW {
        let id = str(stmt, 0)
        out.append(.init(id: id, name: str(stmt, 1), color: opt(stmt, 2), category_ids: jsonIds(str(stmt, 3)), uses: usage[id] ?? 0))
      }
      sqlite3_finalize(stmt)
    }
    return (out, together)
  }

  /// Latest transactions, newest first, titled the way the app's list shows them.
  static func history(limit: Int = 50) -> [KPWatchState.Tx] {
    if let r = withDatabase({ history($0, limit: limit) }) { return r }
    return Array((fileState()?.history ?? []).prefix(limit))
  }

  private static func history(_ db: OpaquePointer, limit: Int) -> [KPWatchState.Tx] {
    var stmt: OpaquePointer?
    let sql = """
      SELECT t.id, t.date, t.amount_minor, a.currency, a.name, t.account_id, t.category_id, c.name, p.name, t.notes, t.payee, t.tag_ids, t.pending, t.transfer_id
      FROM transactions t JOIN accounts a ON a.id=t.account_id
      LEFT JOIN categories c ON c.id=t.category_id LEFT JOIN categories p ON p.id=c.parent_id
      WHERE t.deleted=0 ORDER BY t.date DESC, t.updated_at DESC LIMIT ?
      """
    guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return [] }
    defer { sqlite3_finalize(stmt) }
    sqlite3_bind_int(stmt, 1, Int32(limit))
    var out: [KPWatchState.Tx] = []
    while sqlite3_step(stmt) == SQLITE_ROW {
      let currency = str(stmt, 3)
      let cat = opt(stmt, 7), parent = opt(stmt, 8), notes = opt(stmt, 9), payee = opt(stmt, 10)
      let transfer = opt(stmt, 13) != nil
      let note = notes?.split(separator: "\n").first.map(String.init) ?? ""
      let title = transfer ? "Transfer" : (!note.isEmpty ? note : (payee ?? cat ?? parent ?? "Uncategorized"))
      let catLabel: String? = transfer ? nil : (cat != nil ? (parent != nil ? "\(parent!) › \(cat!)" : cat) : parent)
      let sub = [str(stmt, 4), catLabel].compactMap { $0 }.joined(separator: " · ")
      out.append(.init(id: str(stmt, 0), date: str(stmt, 1), title: title, sub: sub, amount: KPFormat.major(Int(sqlite3_column_int64(stmt, 2)), currency), currency: currency,
                       account_id: str(stmt, 5), category_id: opt(stmt, 6), tag_ids: jsonIds(str(stmt, 11)), pending: sqlite3_column_int(stmt, 12) == 1, transfer: transfer))
    }
    return out
  }

  /// One bundle for the watch, built from a single connection. Balances and budgets come from the
  /// JS-written snapshot. While JS owns the database this *is* the file JS just wrote.
  static func buildState() -> KPWatchState {
    let snap = KPSnapshot.load()
    let built: KPWatchState? = withDatabase { db in
      let balances = Dictionary(uniqueKeysWithValues: (snap?.accounts ?? []).map { ($0.id, $0.balance) })
      let (tags, together) = tags(db)
      let icons = snap?.category_icons ?? [:]
      let cats = categories(db).map { c -> KPWatchState.Category in
        guard let i = icons[c.id] else { return c }
        return .init(id: c.id, name: c.name, parent_id: c.parent_id, parent_name: c.parent_name, kind: c.kind, icon: i.icon, color: i.color, uses: c.uses, description: c.description)
      }
      let f = ISO8601DateFormatter()
      return KPWatchState(
        generated_at: f.string(from: Date()), current_account: meta(db, "current_account") ?? "",
        accounts: accounts(db).map { .init(id: $0.id, name: $0.name, currency: $0.currency, balance: balances[$0.id] ?? 0) },
        categories: cats, tags: tags, together: together, history: history(db, limit: 50), snapshot: snap,
        location_enabled: meta(db, "location_enabled") == "1",
        home: home(db), shortcut_notify: meta(db, "shortcut_notify") != "0")
    }
    if let built { return built }
    // JS owns the database. It writes the state file before every `updateWatch`, so this is current.
    guard var s = fileState() else { return .empty }
    if s.snapshot == nil { s.snapshot = snap }
    return s
  }

  private static func home(_ db: OpaquePointer) -> KPWatchState.Home? {
    guard let lat = meta(db, "home_lat").flatMap(Double.init), let lon = meta(db, "home_lon").flatMap(Double.init) else { return nil }
    return .init(lat: lat, lon: lon)
  }

  /// No category is suggested this close to home (core `HOME_RADIUS_M`).
  static let homeRadiusM: Double = 50
  /// Port of core `suggestCategoryNear`: the category used most within `radiusM` of a point.
  /// SQLite half only — nil while JS owns the database; the app target's `suggestCategoryNear`
  /// (native/KPWrites.swift) then asks JS instead, because the location history is far too big
  /// for the state file.
  static func localSuggestCategoryNear(lat: Double, lon: Double, radiusM: Double = 150) -> String? {
    withDatabase { suggestCategoryNear($0, lat: lat, lon: lon, radiusM: radiusM) }
  }

  private static func suggestCategoryNear(_ db: OpaquePointer, lat: Double, lon: Double, radiusM: Double) -> String? {
    // At home anything gets bought, so no category is suggested there (meta `home_lat`/`home_lon`, set in Settings).
    if let h = home(db), distanceMeters(lat, lon, h.lat, h.lon) <= homeRadiusM { return nil }
    let dLat = radiusM / 111_000, dLon = radiusM / (111_000 * max(0.2, cos(lat * .pi / 180)))
    var stmt: OpaquePointer?
    let sql = """
      SELECT category_id, lat, lon FROM transactions WHERE deleted=0 AND transfer_id IS NULL AND category_id IS NOT NULL
      AND lat BETWEEN ? AND ? AND lon BETWEEN ? AND ? ORDER BY date DESC LIMIT 200
      """
    guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return nil }
    defer { sqlite3_finalize(stmt) }
    sqlite3_bind_double(stmt, 1, lat - dLat); sqlite3_bind_double(stmt, 2, lat + dLat)
    sqlite3_bind_double(stmt, 3, lon - dLon); sqlite3_bind_double(stmt, 4, lon + dLon)
    var counts: [String: Int] = [:]
    var order: [String] = []
    while sqlite3_step(stmt) == SQLITE_ROW {
      let rlat = sqlite3_column_double(stmt, 1), rlon = sqlite3_column_double(stmt, 2)
      if distanceMeters(lat, lon, rlat, rlon) > radiusM { continue }
      let id = str(stmt, 0)
      if counts[id] == nil { order.append(id) }
      counts[id, default: 0] += 1
    }
    return order.max { counts[$0]! < counts[$1]! }
  }

  /// What history knows about a name before an entry for it is written: the category and tags it was
  /// filed under last time, and where it was seen. Mirrors core `payeeHistory` (packages/core/src/payee.ts).
  struct PayeeHistory {
    /// From one single past row, together with `tagIds`: they describe the same past decision.
    var categoryId: String?
    var tagIds: [String] = []
    /// Where the name was last seen — the newest past entry for it that recorded a location.
    var place: String?
    var lat: Double?
    var lon: Double?
    /// How many different (category, tags) pairs this name was ever filed under (core `payeeOptions`).
    var variants: Int = 0
    /// History filed this name under a category before, so a new entry for it is already understood
    /// and needs no trip through the pending queue (core `isFiledBefore`).
    var filedBefore: Bool { categoryId != nil }
    /// The same shop, filed more than one way — fuel one week, a hot dog the next. History can only
    /// repeat the last of them, so nothing here is a decision: the entry has to be asked about.
    var ambiguous: Bool { variants > 1 }
    static let none = PayeeHistory()
  }

  /// SQLite half only — nil while JS owns the database; the app target's `payeeHistory`
  /// (native/KPWrites.swift) then asks JS instead. The answer is not in the state file: it carries
  /// neither payees nor notes.
  static func localPayeeHistory(payee: String?, note: String?) -> PayeeHistory? {
    withDatabase { payeeHistory($0, payee: payee, note: note) }
  }

  private static func payeeHistory(_ db: OpaquePointer, payee: String?, note: String?) -> PayeeHistory {
    var out = PayeeHistory()
    let shop = payee?.trimmingCharacters(in: .whitespacesAndNewlines)
    // The whole note, not its first line: an automation writes one line, and an exact match is the
    // only rule that cannot file an entry under the wrong thing.
    let title = note?.trimmingCharacters(in: .whitespacesAndNewlines)
    // The shop's exact name first, then the note's, then the shop's first word, so different branches
    // of one chain ("ZABKA ZE212 K.5" / "ZABKA NANO 3087") still find each other. A name matches
    // whether it was filed as a payee or as a note: a Shortcut with only a note writes it into `notes`.
    let byName = "(payee = ? COLLATE NOCASE OR notes = ? COLLATE NOCASE)"
    var tries: [(clause: String, binds: [String])] = []
    if let s = shop, !s.isEmpty { tries.append((byName, [s, s])) }
    if let t = title, !t.isEmpty, t.lowercased() != shop?.lowercased() { tries.append((byName, [t, t])) }
    if let s = shop, let head = s.split(separator: " ").first.map(String.init), head.count >= 3, head != s {
      tries.append(("payee LIKE ? COLLATE NOCASE", [head + "%"]))
    }
    guard !tries.isEmpty else { return out }

    /// The newest past entry matching any of the names above, in that order, that also satisfies `has`.
    /// Returns a stepped statement the caller reads and finalizes.
    func newest(_ cols: String, _ has: String) -> OpaquePointer? {
      for t in tries {
        var stmt: OpaquePointer?
        let sql = "SELECT \(cols) FROM transactions WHERE deleted=0 AND transfer_id IS NULL AND \(has) AND \(t.clause) ORDER BY date DESC LIMIT 1"
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { continue }
        for (i, b) in t.binds.enumerated() { sqlite3_bind_text(stmt, Int32(i + 1), b, -1, T) }
        if sqlite3_step(stmt) == SQLITE_ROW { return stmt }
        sqlite3_finalize(stmt)
      }
      return nil
    }
    // Category and tags come from whichever single row matches, so they always describe one past
    // decision; a row with tags but no category still counts.
    if let stmt = newest("category_id, tag_ids", "(category_id IS NOT NULL OR tag_ids <> '[]')") {
      out.categoryId = opt(stmt, 0)
      out.tagIds = jsonIds(str(stmt, 1))
      sqlite3_finalize(stmt)
    }
    // How many ways this name was filed, so a caller can tell a decision from a coin toss. Counted
    // over the same name that answered above, since `newest` takes the first one that matches at all.
    for t in tries {
      var stmt: OpaquePointer?
      let sql = "SELECT COUNT(*) FROM (SELECT DISTINCT category_id, tag_ids FROM transactions WHERE deleted=0 AND transfer_id IS NULL AND (category_id IS NOT NULL OR tag_ids <> '[]') AND \(t.clause) LIMIT 200)"
      guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { continue }
      for (i, b) in t.binds.enumerated() { sqlite3_bind_text(stmt, Int32(i + 1), b, -1, T) }
      let n = sqlite3_step(stmt) == SQLITE_ROW ? Int(sqlite3_column_int(stmt, 0)) : 0
      sqlite3_finalize(stmt)
      if n > 0 { out.variants = n; break }
    }
    // Where the shop is, though, is a fact of its own — the newest entry that recorded a location,
    // whether or not that is the entry the category came from.
    if let stmt = newest("place, lat, lon", "((place IS NOT NULL AND place <> '') OR lat IS NOT NULL)") {
      out.place = opt(stmt, 0)
      if sqlite3_column_type(stmt, 1) != SQLITE_NULL { out.lat = sqlite3_column_double(stmt, 1) }
      if sqlite3_column_type(stmt, 2) != SQLITE_NULL { out.lon = sqlite3_column_double(stmt, 2) }
      sqlite3_finalize(stmt)
    }
    return out
  }

  /// What history knows about a card payment before it is written: what this shop was filed under
  /// before, and the entry that may already be this very charge.
  struct PaymentContext {
    var history: PayeeHistory = .none
    var twin: Twin?
    /// An entry for the same account and the same amount, made minutes ago — almost certainly the
    /// other notification for one tap, or iOS re-delivering the first one. Pending **or not**: a
    /// recognised shop now leaves the queue by itself, and the second notification must still find it.
    /// Its own fields come back so the caller can fill the gaps of one that is still pending.
    struct Twin { let id: String; let payee: String?; let place: String?; let categoryId: String?; let pending: Bool }
  }

  /// SQLite half only — nil while JS owns the database; the app target's `paymentContext`
  /// (native/KPWrites.swift) then asks JS instead. Neither answer fits in the state file: it carries
  /// no payees and no pending rows.
  static func localPaymentContext(accountId: String, amountMinor: Int, payee: String?, note: String?, withinMinutes: Int) -> PaymentContext? {
    withDatabase { paymentContext($0, accountId: accountId, amountMinor: amountMinor, payee: payee, note: note, withinMinutes: withinMinutes) }
  }

  private static func paymentContext(_ db: OpaquePointer, accountId: String, amountMinor: Int, payee: String?, note: String?, withinMinutes: Int) -> PaymentContext {
    var out = PaymentContext(history: payeeHistory(db, payee: payee, note: note))
    let since = isoFormatter.string(from: Date(timeIntervalSinceNow: -Double(withinMinutes) * 60))
    var stmt: OpaquePointer?
    let sql = "SELECT id, payee, place, category_id, pending FROM transactions WHERE deleted=0 AND account_id=? AND amount_minor=? AND date>=? ORDER BY date DESC LIMIT 1"
    guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return out }
    sqlite3_bind_text(stmt, 1, accountId, -1, T); sqlite3_bind_int(stmt, 2, Int32(amountMinor)); sqlite3_bind_text(stmt, 3, since, -1, T)
    if sqlite3_step(stmt) == SQLITE_ROW {
      out.twin = .init(id: str(stmt, 0), payee: opt(stmt, 1), place: opt(stmt, 2), categoryId: opt(stmt, 3), pending: sqlite3_column_int(stmt, 4) == 1)
    }
    sqlite3_finalize(stmt)
    return out
  }

  /// Fill the empty fields of an existing *pending* entry (never overwrite): the second notification
  /// for one payment usually knows something the first did not — Wallet has the tidy shop name, the
  /// bank app the city. With `confirm`, an entry that ends up with a category also leaves the pending
  /// queue, because history has already filed this shop. Returns false when there was nothing to do.
  @discardableResult
  static func fillIn(id: String, payee: String?, place: String?, categoryId: String?, tagIds: [String] = [],
                     lat: Double? = nil, lon: Double? = nil, confirm: Bool = false) -> Bool {
    withDatabase { fillIn($0, id: id, payee: payee, place: place, categoryId: categoryId, tagIds: tagIds, lat: lat, lon: lon, confirm: confirm) } ?? false
  }

  private static func fillIn(_ db: OpaquePointer, id: String, payee: String?, place: String?, categoryId: String?, tagIds: [String],
                             lat: Double?, lon: Double?, confirm: Bool) -> Bool {
    // (column, value to write, that column's own "nothing here yet" value) — tags are empty as '[]', not ''.
    var sets: [(col: String, value: String, blank: String)] = [("payee", payee ?? "", ""), ("place", place ?? "", ""), ("category_id", categoryId ?? "", "")]
      .filter { !$0.value.isEmpty }
    if !tagIds.isEmpty { sets.append(("tag_ids", "[" + tagIds.map { "\"\($0)\"" }.joined(separator: ",") + "]", "[]")) }
    // A location the row has not got: both halves or neither, so a half-filled point can never happen.
    var coords: [(col: String, value: Double)] = []
    if let lat, let lon { coords = [("lat", lat), ("lon", lon)] }
    // "Understood now" is exactly "it has a category once this fill-in is done".
    let clears = confirm && (categoryId?.isEmpty == false)
    guard !sets.isEmpty || !coords.isEmpty || clears else { return false }
    // COALESCE over NULLIF keeps this a fill-in: a column that already holds something is left alone.
    var assignments = sets.map { "\($0.col)=COALESCE(NULLIF(\($0.col), '\($0.blank)'), ?)" } + coords.map { "\($0.col)=COALESCE(\($0.col), ?)" }
    // Unlike the fill-ins above this one does overwrite, and it may only ever turn pending off.
    if clears { assignments.append("pending=0") }
    let sql = "UPDATE transactions SET updated_at=?, \(assignments.joined(separator: ", ")) WHERE id=? AND deleted=0 AND pending=1"
    sqlite3_exec(db, "BEGIN", nil, nil, nil)
    var stmt: OpaquePointer?
    guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { sqlite3_exec(db, "ROLLBACK", nil, nil, nil); return false }
    sqlite3_bind_int64(stmt, 1, sqlite3_int64(Int(Date().timeIntervalSince1970 * 1000)))
    for (i, s) in sets.enumerated() { sqlite3_bind_text(stmt, Int32(i + 2), s.value, -1, T) }
    for (i, c) in coords.enumerated() { sqlite3_bind_double(stmt, Int32(sets.count + i + 2), c.value) }
    sqlite3_bind_text(stmt, Int32(sets.count + coords.count + 2), id, -1, T)
    let ok = sqlite3_step(stmt) == SQLITE_DONE && sqlite3_changes(db) > 0
    sqlite3_finalize(stmt)
    let ok2 = ok && queueOutbox(db, table: "transactions", id: id)
    sqlite3_exec(db, ok && ok2 ? "COMMIT" : "ROLLBACK", nil, nil, nil)
    return ok && ok2
  }

  private static func distanceMeters(_ lat1: Double, _ lon1: Double, _ lat2: Double, _ lon2: Double) -> Double {
    let r = 6_371_000.0, dLat = (lat2 - lat1) * .pi / 180, dLon = (lon2 - lon1) * .pi / 180
    let a = sin(dLat / 2) * sin(dLat / 2) + cos(lat1 * .pi / 180) * cos(lat2 * .pi / 180) * sin(dLon / 2) * sin(dLon / 2)
    return 2 * r * atan2(sqrt(a), sqrt(1 - a))
  }

  /// Insert an expense (negative) or income (positive) in minor units and record it as changed.
  /// Why the last write failed (SQLite message or "no database"); shown on the watch's Sync page.
  nonisolated(unsafe) static var lastError: String?

  @discardableResult
  static func addTransaction(id: String? = nil, accountId: String, amountMinor: Int, categoryId: String?, tagIds: [String] = [], note: String?, payee: String? = nil,
                             lat: Double? = nil, lon: Double? = nil, place: String? = nil, pending: Bool = false, date: String? = nil, source: String? = nil,
                             enteredMinor: Int? = nil, enteredCurrency: String? = nil, rate: Double? = nil) -> Bool {
    lastError = nil
    guard let ok = withDatabase({ db -> Bool in
      addTransaction(db, id: id, accountId: accountId, amountMinor: amountMinor, categoryId: categoryId, tagIds: tagIds, note: note, payee: payee,
                     lat: lat, lon: lon, place: place, pending: pending, date: date, source: source,
                     enteredMinor: enteredMinor, enteredCurrency: enteredCurrency, rate: rate)
    }) else { lastError = "No database on the iPhone yet"; return false }
    return ok
  }

  /// `enteredMinor`/`enteredCurrency`/`rate` are the cross-currency columns: what the bank actually
  /// charged, in the currency it printed, and the rate used to express it in the account's. They are
  /// what lets a converted row be checked — and corrected — instead of being taken on trust.
  private static func addTransaction(_ db: OpaquePointer, id: String?, accountId: String, amountMinor: Int, categoryId: String?, tagIds: [String], note: String?, payee: String?,
                                     lat: Double?, lon: Double?, place: String?, pending: Bool, date: String?, source: String? = nil,
                                     enteredMinor: Int? = nil, enteredCurrency: String? = nil, rate: Double? = nil) -> Bool {
    let id = (id?.isEmpty == false ? id! : UUID().uuidString.lowercased())
    let now = Int(Date().timeIntervalSince1970 * 1000)
    let iso = date ?? isoNow()
    // Travel mode: the trip tag rides along on everything logged from the watch or a Shortcut too.
    var allTags = tagIds
    if let trip = activeTripTagId(db), !allTags.contains(trip) { allTags.append(trip) }
    let tags = "[" + allTags.map { "\"\($0)\"" }.joined(separator: ",") + "]"
    sqlite3_exec(db, "BEGIN", nil, nil, nil)
    var stmt: OpaquePointer?
    let sql = """
      INSERT INTO transactions (id, updated_at, deleted, account_id, date, amount_minor, category_id, payee, notes, tag_ids, pending, transfer_id,
        entered_amount_minor, entered_currency, exchange_rate, recurring_id, lat, lon, place, source)
      VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, NULL, ?, ?, ?, ?)
      """
    guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { lastError = String(cString: sqlite3_errmsg(db)); sqlite3_exec(db, "ROLLBACK", nil, nil, nil); return false }
    sqlite3_bind_text(stmt, 1, id, -1, T)
    sqlite3_bind_int64(stmt, 2, sqlite3_int64(now))
    sqlite3_bind_text(stmt, 3, accountId, -1, T)
    sqlite3_bind_text(stmt, 4, iso, -1, T)
    sqlite3_bind_int64(stmt, 5, sqlite3_int64(amountMinor))
    if let c = categoryId, !c.isEmpty { sqlite3_bind_text(stmt, 6, c, -1, T) } else { sqlite3_bind_null(stmt, 6) }
    if let p = payee, !p.isEmpty { sqlite3_bind_text(stmt, 7, p, -1, T) } else { sqlite3_bind_null(stmt, 7) }
    if let n = note, !n.isEmpty { sqlite3_bind_text(stmt, 8, n, -1, T) } else { sqlite3_bind_null(stmt, 8) }
    sqlite3_bind_text(stmt, 9, tags, -1, T)
    sqlite3_bind_int(stmt, 10, pending ? 1 : 0)
    // Both halves or neither: an entered amount without its currency says nothing.
    if let e = enteredMinor, let c = enteredCurrency, !c.isEmpty {
      sqlite3_bind_int64(stmt, 11, sqlite3_int64(e)); sqlite3_bind_text(stmt, 12, c, -1, T)
    } else { sqlite3_bind_null(stmt, 11); sqlite3_bind_null(stmt, 12) }
    if let r = rate, r > 0 { sqlite3_bind_double(stmt, 13, r) } else { sqlite3_bind_null(stmt, 13) }
    if let la = lat, let lo = lon { sqlite3_bind_double(stmt, 14, la); sqlite3_bind_double(stmt, 15, lo) } else { sqlite3_bind_null(stmt, 14); sqlite3_bind_null(stmt, 15) }
    if let p = place, !p.isEmpty { sqlite3_bind_text(stmt, 16, p, -1, T) } else { sqlite3_bind_null(stmt, 16) }
    if let s = source, !s.isEmpty { sqlite3_bind_text(stmt, 17, s, -1, T) } else { sqlite3_bind_null(stmt, 17) }
    let ok = sqlite3_step(stmt) == SQLITE_DONE
    if !ok { lastError = String(cString: sqlite3_errmsg(db)) }
    sqlite3_finalize(stmt)
    let ok2 = ok && queueOutbox(db, table: "transactions", id: id)
    if ok && !ok2 { lastError = String(cString: sqlite3_errmsg(db)) }
    sqlite3_exec(db, ok && ok2 ? "COMMIT" : "ROLLBACK", nil, nil, nil)
    return ok && ok2
  }

  /// Tombstone a transaction (the app's `remove`), so the deletion propagates through a backup merge.
  @discardableResult
  static func deleteTransaction(id: String) -> Bool {
    withDatabase { deleteTransaction($0, id: id) } ?? false
  }

  private static func deleteTransaction(_ db: OpaquePointer, id: String) -> Bool {
    sqlite3_exec(db, "BEGIN", nil, nil, nil)
    var stmt: OpaquePointer?
    guard sqlite3_prepare_v2(db, "UPDATE transactions SET deleted=1, updated_at=? WHERE id=?", -1, &stmt, nil) == SQLITE_OK else { sqlite3_exec(db, "ROLLBACK", nil, nil, nil); return false }
    sqlite3_bind_int64(stmt, 1, sqlite3_int64(Int(Date().timeIntervalSince1970 * 1000)))
    sqlite3_bind_text(stmt, 2, id, -1, T)
    let ok = sqlite3_step(stmt) == SQLITE_DONE && sqlite3_changes(db) > 0
    sqlite3_finalize(stmt)
    let ok2 = ok && queueOutbox(db, table: "transactions", id: id)
    sqlite3_exec(db, ok && ok2 ? "COMMIT" : "ROLLBACK", nil, nil, nil)
    return ok && ok2
  }

  /// Fill in the place name later (reverse geocoding finishes after the write).
  @discardableResult
  static func updatePlace(id: String, place: String) -> Bool {
    withDatabase { updatePlace($0, id: id, place: place) } ?? false
  }

  private static func updatePlace(_ db: OpaquePointer, id: String, place: String) -> Bool {
    sqlite3_exec(db, "BEGIN", nil, nil, nil)
    var stmt: OpaquePointer?
    guard sqlite3_prepare_v2(db, "UPDATE transactions SET place=?, updated_at=? WHERE id=? AND deleted=0 AND place IS NULL", -1, &stmt, nil) == SQLITE_OK else { sqlite3_exec(db, "ROLLBACK", nil, nil, nil); return false }
    sqlite3_bind_text(stmt, 1, place, -1, T)
    sqlite3_bind_int64(stmt, 2, sqlite3_int64(Int(Date().timeIntervalSince1970 * 1000)))
    sqlite3_bind_text(stmt, 3, id, -1, T)
    let ok = sqlite3_step(stmt) == SQLITE_DONE && sqlite3_changes(db) > 0
    sqlite3_finalize(stmt)
    let ok2 = ok && queueOutbox(db, table: "transactions", id: id)
    sqlite3_exec(db, ok && ok2 ? "COMMIT" : "ROLLBACK", nil, nil, nil)
    return ok && ok2
  }

  private static func queueOutbox(_ db: OpaquePointer, table: String, id: String) -> Bool {
    var s: OpaquePointer?
    guard sqlite3_prepare_v2(db, "INSERT OR IGNORE INTO sync_outbox(tbl, id) VALUES (?, ?)", -1, &s, nil) == SQLITE_OK else { return false }
    defer { sqlite3_finalize(s) }
    sqlite3_bind_text(s, 1, table, -1, T)
    sqlite3_bind_text(s, 2, id, -1, T)
    return sqlite3_step(s) == SQLITE_DONE
  }

  // MARK: helpers

  static func jsonIds(_ s: String) -> [String] {
    guard let d = s.data(using: .utf8), let arr = try? JSONSerialization.jsonObject(with: d) as? [String] else { return [] }
    return arr
  }
  private static func str(_ stmt: OpaquePointer?, _ i: Int32) -> String {
    guard let c = sqlite3_column_text(stmt, i) else { return "" }
    return String(cString: c)
  }
  private static func opt(_ stmt: OpaquePointer?, _ i: Int32) -> String? {
    sqlite3_column_type(stmt, i) == SQLITE_NULL ? nil : str(stmt, i)
  }
  /// yyyy-MM-dd 180 days ago, the usage window of the app's pickers.
  private static func sinceDay() -> String { KPFormat.dayParser.string(from: Date(timeIntervalSinceNow: -180 * 86_400)) }
  private static let isoFormatter: DateFormatter = {
    let f = DateFormatter()
    f.locale = Locale(identifier: "en_US_POSIX")
    f.dateFormat = "yyyy-MM-dd'T'HH:mm:ssxxx"
    return f
  }()
  /// 2026-09-07T14:32:37+02:00 — same shape the app writes.
  static func isoNow() -> String { isoFormatter.string(from: Date()) }
}
