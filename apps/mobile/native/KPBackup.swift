internal import ExpoModulesCore
import Foundation

/// Expo inline module "KPBackup" (JS side: src/lib/backup.ts). File storage for the phone's own
/// backups in the app's iCloud container (`iCloud.dev.kopiyka`, shown in Files as iCloud Drive →
/// Kopiyka → Backups), falling back to the app's Documents folder when iCloud is off.
/// The JS side decides *when* to back up and what to keep; this only reads and writes files.
final class KPBackup: Module {
  func definition() -> ModuleDefinition {
    Name("KPBackup")
    /// Where backups go. `available` = the phone is signed in to iCloud and the container exists.
    AsyncFunction("location") { () -> [String: Any] in KPBackupStore.location() }
    AsyncFunction("list") { () -> [[String: Any]] in KPBackupStore.list() }
    AsyncFunction("write") { (day: String, name: String, contents: String) throws -> String in try KPBackupStore.write(day: day, name: name, contents: contents) }
    AsyncFunction("read") { (day: String, name: String) async throws -> String in try await KPBackupStore.read(day: day, name: name) }
    AsyncFunction("remove") { (day: String, name: String) throws in try KPBackupStore.remove(day: day, name: name) }
    /// Photo mirror (see `photosRoot`): names already kept, and copies in or out by file path.
    AsyncFunction("photos") { () -> [String] in KPBackupStore.photoNames() }
    AsyncFunction("putPhoto") { (name: String, path: String) throws in try KPBackupStore.putPhoto(name: name, from: path) }
    AsyncFunction("getPhoto") { (name: String, path: String) async throws in try await KPBackupStore.getPhoto(name: name, to: path) }
  }
}

enum KPBackupStore {
  static let containerId = "iCloud.dev.kopiyka"
  private static let dayPattern = try! NSRegularExpression(pattern: "^\\d{4}-\\d{2}-\\d{2}$")
  private static var cachedRoot: (url: URL, icloud: Bool)?

  enum Failure: LocalizedError {
    case notDownloaded(String)
    case badName
    var errorDescription: String? {
      switch self {
      case .notDownloaded(let n): return "\(n) is still downloading from iCloud. Try again in a moment."
      case .badName: return "Invalid backup name"
      }
    }
  }

  /// Ubiquity container lookup can block on first use; callers run on Expo's background queue.
  static func root() -> (url: URL, icloud: Bool) {
    if let c = cachedRoot { return c }
    let fm = FileManager.default
    if fm.ubiquityIdentityToken != nil, let u = fm.url(forUbiquityContainerIdentifier: containerId) {
      let r = (u.appendingPathComponent("Documents/Backups", isDirectory: true), true)
      cachedRoot = r
      return r
    }
    let docs = fm.urls(for: .documentDirectory, in: .userDomainMask)[0]
    let r = (docs.appendingPathComponent("Backups", isDirectory: true), false)
    cachedRoot = r
    return r
  }

  static func location() -> [String: Any] {
    let (url, icloud) = root()
    return ["dir": url.path, "icloud": icloud, "available": FileManager.default.ubiquityIdentityToken != nil]
  }

  private static func url(day: String, name: String) throws -> URL {
    guard !day.contains("/"), !name.contains("/"), !name.hasPrefix("."), name.hasSuffix(".json") else { throw Failure.badName }
    return root().url.appendingPathComponent(day, isDirectory: true).appendingPathComponent(name)
  }

  /// Every backup, including ones only in iCloud (placeholder `.name.icloud` files, `downloaded: false`).
  static func list() -> [[String: Any]] {
    let fm = FileManager.default
    let (dir, _) = root()
    guard let days = try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.isDirectoryKey]) else { return [] }
    var out: [[String: Any]] = []
    for dayURL in days {
      let day = dayURL.lastPathComponent
      guard dayPattern.firstMatch(in: day, range: NSRange(day.startIndex..., in: day)) != nil,
            (try? dayURL.resourceValues(forKeys: [.isDirectoryKey]))?.isDirectory == true,
            let files = try? fm.contentsOfDirectory(at: dayURL, includingPropertiesForKeys: [.fileSizeKey]) else { continue }
      for f in files {
        var name = f.lastPathComponent
        var downloaded = true
        if name.hasPrefix("."), name.hasSuffix(".icloud") {
          name = String(name.dropFirst().dropLast(".icloud".count))
          downloaded = false
        }
        guard name.hasPrefix("kopiyka-"), name.hasSuffix(".json") else { continue }
        let size = downloaded ? ((try? f.resourceValues(forKeys: [.fileSizeKey]))?.fileSize ?? 0) : 0
        out.append(["name": name, "day": day, "size": size, "downloaded": downloaded])
      }
    }
    return out
  }

  /// Atomic, coordinated write so iCloud never uploads a half-written file.
  static func write(day: String, name: String, contents: String) throws -> String {
    let target = try url(day: day, name: name)
    try FileManager.default.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
    var coordError: NSError?
    var writeError: Error?
    NSFileCoordinator().coordinate(writingItemAt: target, options: .forReplacing, error: &coordError) { u in
      do { try Data(contents.utf8).write(to: u, options: .atomic) } catch { writeError = error }
    }
    if let e = coordError ?? writeError { throw e }
    return target.path
  }

  /// Reads a backup, fetching it from iCloud first when only the placeholder is here (waits up to a minute).
  static func read(day: String, name: String) async throws -> String {
    let target = try url(day: day, name: name)
    let fm = FileManager.default
    if !fm.fileExists(atPath: target.path) {
      try fm.startDownloadingUbiquitousItem(at: target)
      for _ in 0..<120 {
        if fm.fileExists(atPath: target.path) { break }
        try await Task.sleep(nanoseconds: 500_000_000)
      }
      guard fm.fileExists(atPath: target.path) else { throw Failure.notDownloaded(name) }
    }
    var coordError: NSError?
    var readError: Error?
    var text: String?
    NSFileCoordinator().coordinate(readingItemAt: target, options: [], error: &coordError) { u in
      do { text = try String(contentsOf: u, encoding: .utf8) } catch { readError = error }
    }
    if let e = coordError ?? readError { throw e }
    return text ?? ""
  }

  // MARK: - Photos

  /// Photos sit beside the backups (iCloud Drive → Kopiyka → **Photos**), not inside them.
  ///
  /// A photo file is written once under a name nobody reuses and never modified afterwards
  /// (src/lib/photos.ts), so one copy in the container serves every backup that mentions it. Putting
  /// the image in the JSON instead would re-upload every photo in every backup — several a day — and
  /// turn a file that is meant to stay small into tens of megabytes of base64. Here each photo costs
  /// its own size, once, and iCloud uploads only the ones that are new.
  static func photosRoot() -> URL {
    root().url.deletingLastPathComponent().appendingPathComponent("Photos", isDirectory: true)
  }

  private static func photoURL(_ name: String) throws -> URL {
    guard !name.contains("/"), !name.hasPrefix("."), name.hasSuffix(".jpg") else { throw Failure.badName }
    return photosRoot().appendingPathComponent(name)
  }

  /// Names already in the container, including ones iCloud has not downloaded to this device
  /// (a `.name.icloud` placeholder still means "we have it").
  static func photoNames() -> [String] {
    guard let files = try? FileManager.default.contentsOfDirectory(at: photosRoot(), includingPropertiesForKeys: nil) else { return [] }
    return files.compactMap { f in
      var n = f.lastPathComponent
      if n.hasPrefix("."), n.hasSuffix(".icloud") { n = String(n.dropFirst().dropLast(".icloud".count)) }
      return n.hasSuffix(".jpg") ? n : nil
    }
  }

  /// Copy a local photo in. Already there means already done — the file never changes, so this is
  /// what makes the mirror cheap to run after every backup.
  static func putPhoto(name: String, from path: String) throws {
    let target = try photoURL(name)
    let fm = FileManager.default
    guard !fm.fileExists(atPath: target.path) else { return }
    try fm.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
    let source = URL(fileURLWithPath: path)
    var coordError: NSError?
    var copyError: Error?
    NSFileCoordinator().coordinate(writingItemAt: target, options: .forReplacing, error: &coordError) { u in
      do { try fm.copyItem(at: source, to: u) } catch { copyError = error }
    }
    if let e = coordError ?? copyError { throw e }
  }

  /// Copy one back out to the device, fetching it from iCloud first when only the placeholder is here.
  static func getPhoto(name: String, to path: String) async throws {
    let source = try photoURL(name)
    let fm = FileManager.default
    if !fm.fileExists(atPath: source.path) {
      try fm.startDownloadingUbiquitousItem(at: source)
      for _ in 0..<120 {
        if fm.fileExists(atPath: source.path) { break }
        try await Task.sleep(nanoseconds: 500_000_000)
      }
      guard fm.fileExists(atPath: source.path) else { throw Failure.notDownloaded(name) }
    }
    let target = URL(fileURLWithPath: path)
    guard !fm.fileExists(atPath: target.path) else { return }
    try fm.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
    var coordError: NSError?
    var copyError: Error?
    NSFileCoordinator().coordinate(readingItemAt: source, options: [], error: &coordError) { u in
      do { try fm.copyItem(at: u, to: target) } catch { copyError = error }
    }
    if let e = coordError ?? copyError { throw e }
  }

  static func remove(day: String, name: String) throws {
    let target = try url(day: day, name: name)
    let fm = FileManager.default
    let placeholder = target.deletingLastPathComponent().appendingPathComponent(".\(name).icloud")
    let victim = fm.fileExists(atPath: target.path) ? target : placeholder
    guard fm.fileExists(atPath: victim.path) else { return }
    var coordError: NSError?
    var removeError: Error?
    NSFileCoordinator().coordinate(writingItemAt: victim, options: .forDeleting, error: &coordError) { u in
      do { try fm.removeItem(at: u) } catch { removeError = error }
    }
    if let e = coordError ?? removeError { throw e }
    let dayDir = target.deletingLastPathComponent()
    if let left = try? fm.contentsOfDirectory(atPath: dayDir.path), left.isEmpty { try? fm.removeItem(at: dayDir) }
  }
}
