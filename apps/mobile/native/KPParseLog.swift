import Foundation

/**
 * The notifications the automation could **not** turn into a transaction, kept so a bank whose
 * wording the reader does not know yet can be fixed instead of silently losing purchases.
 *
 * Only the failures: a log that also recorded every payment it got right would be mostly noise, and
 * a transaction that exists is its own record of having been read.
 *
 * A file, not a table: the intent runs with the app closed and must never open the database while JS
 * owns it, and a diagnostic log has no business travelling in a backup or syncing to the watch. It
 * lives beside `watch-state.json` in the app group, one JSON object per line, newest last, and keeps
 * only the most recent `maxEntries` so it can never grow without bound.
 *
 * It holds whole notification texts — the bank's own words, account tails and amounts — so it stays
 * on the phone, is shown only in Settings, is exported only when the user asks, and is cleared from
 * the same screen.
 */
enum KPParseLog {
  static let fileName = "parse-log.jsonl"
  static var url: URL? { KP.container?.appendingPathComponent(fileName) }
  /// Enough to cover a few weeks of card use; a few hundred short lines, well under a megabyte.
  static let maxEntries = 300

  /// Why nothing was written. Anything that *did* write a row is not recorded here at all.
  enum Outcome: String, Codable {
    /// Money is named and no amount could be read out of it: the one worth working on.
    case unreadable
    /// No money in it at all, or money the bank is not charging (a balance, a code, a declined card).
    case ignored
    /// Understood, but the write did not happen (no accounts yet, or the app refused it).
    case failed
  }

  struct Entry: Codable {
    let at: String
    let outcome: String
    /// The notification as it arrived, whitespace collapsed. The whole point of the log.
    let text: String
    let amount: Double?
    let currency: String?
    let merchant: String?
    let card: String?
    let account: String?
    /// Why, when the outcome does not speak for itself.
    let note: String?
  }

  private static let lock = NSLock()
  private static let stamp: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime]; return f
  }()

  static func record(_ outcome: Outcome, text: String?, parse: KPPaymentText.Parse? = nil,
                     account: String? = nil, note: String? = nil) {
    guard let url else { return }
    let entry = Entry(at: stamp.string(from: Date()), outcome: outcome.rawValue,
                      text: String((text ?? parse?.text ?? "").prefix(600)),
                      amount: parse?.amount, currency: parse?.currency, merchant: parse?.merchant,
                      card: parse?.card, account: account, note: note)
    guard let line = try? JSONEncoder().encode(entry), let json = String(data: line, encoding: .utf8) else { return }
    lock.lock(); defer { lock.unlock() }
    var lines = (try? String(contentsOf: url, encoding: .utf8))?.split(separator: "\n").map(String.init) ?? []
    lines.append(json)
    if lines.count > maxEntries { lines.removeFirst(lines.count - maxEntries) }
    try? (lines.joined(separator: "\n") + "\n").write(to: url, atomically: true, encoding: .utf8)
  }
}
