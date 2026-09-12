import Foundation
import UIKit
import Vision
import SQLite3
#if canImport(FoundationModels)
import FoundationModels
#endif

/// Receipt reading for the "Scan receipt" Shortcut and the in-app camera.
/// 1. Vision reads the text (rows are rebuilt from the boxes so "item … price" stays on one line).
/// 2. The on-device Foundation model (Apple Intelligence, iOS 26) turns it into merchant, total,
///    currency, date, items and one category chosen from the user's list (name + description).
///    Without the model, keywords from the category names and descriptions decide.
/// Nothing here touches the network.
enum KPReceipt {
  typealias Item = KPReceiptText.Item
  typealias Parse = KPReceiptText.Parse
  typealias CategoryRef = KPCategoryRef

  enum Failure: LocalizedError {
    case noImage, noText
    var errorDescription: String? {
      switch self { case .noImage: return "The photo could not be read."; case .noText: return "No text found. Hold the phone flat over the receipt with good light." }
    }
  }

  // MARK: - Pipeline

  static func analyze(image: UIImage) async throws -> Parse {
    guard let cg = normalized(image) else { throw Failure.noImage }
    let lines = try await recognize(cg)
    guard !lines.isEmpty else { throw Failure.noText }
    let cats = KPStore.categoryRefs()
    // Polish fiscal receipts have a fixed layout: parse them deterministically, ask the model only for the category.
    var parse: Parse
    if KPReceiptText.isFiscal(lines), let f = KPReceiptText.fiscal(lines: lines) { parse = f }
    else if let p = await understand(lines: lines, categories: cats) { parse = p }
    else { parse = KPReceiptText.heuristic(lines: lines) }
    if parse.category_id == nil {
      let byModel = await categorize(parse, categories: cats)
      if let c = byModel ?? matchCategory(name: parse.category_name, in: cats) ?? keywordCategory(text: lines.joined(separator: "\n"), categories: cats) {
        parse.category_id = c.id; parse.category_name = c.path
      }
    }
    parse.summary = KPReceiptText.summary(parse)
    parse.text = lines.joined(separator: "\n")
    return parse
  }

  /// Upright, at most ~2000 px on the long side (Vision is faster and just as accurate).
  static func normalized(_ image: UIImage) -> CGImage? {
    let maxSide: CGFloat = 2000
    let scale = min(1, maxSide / max(image.size.width, image.size.height))
    let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
    let fmt = UIGraphicsImageRendererFormat.default(); fmt.scale = 1
    let out = UIGraphicsImageRenderer(size: size, format: fmt).image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
    return out.cgImage
  }

  /// Text lines top to bottom; boxes on the same row are joined left to right with two spaces.
  static func recognize(_ cg: CGImage) async throws -> [String] {
    var req = RecognizeTextRequest()
    req.recognitionLevel = .accurate
    req.usesLanguageCorrection = true
    req.automaticallyDetectsLanguage = true
    let obs = try await req.perform(on: cg)
    struct Box { let text: String; let rect: CGRect }
    let boxes = obs.compactMap { o -> Box? in
      guard let t = o.topCandidates(1).first?.string.trimmingCharacters(in: .whitespaces), !t.isEmpty else { return nil }
      return Box(text: t, rect: o.boundingBox.cgRect)
    }.sorted { $0.rect.midY > $1.rect.midY }   // Vision's origin is bottom-left
    var rows: [[Box]] = []
    for b in boxes {
      if let last = rows.last?.first, abs(last.rect.midY - b.rect.midY) < max(last.rect.height, b.rect.height) * 0.6 { rows[rows.count - 1].append(b) }
      else { rows.append([b]) }
    }
    return rows.map { $0.sorted { $0.rect.minX < $1.rect.minX }.map(\.text).joined(separator: "  ") }
  }

  // MARK: - On-device model

  #if canImport(FoundationModels)
  @available(iOS 26.0, *)
  @Generable
  struct ModelItem { @Guide(description: "Item as printed, shortened") var name: String; @Guide(description: "Line price as a number") var price: Double }

  @available(iOS 26.0, *)
  @Generable
  struct ModelParse {
    @Guide(description: "Store or merchant name as printed at the top") var merchant: String
    @Guide(description: "Grand total actually paid, as a number") var total: Double
    @Guide(description: "ISO 4217 currency code (PLN, EUR, USD, UAH…) if printed or implied, else empty") var currency: String
    @Guide(description: "Purchase date as YYYY-MM-DD if printed, else empty") var date: String
    @Guide(description: "Purchased items with prices; skip tax, subtotal, change and payment lines", .maximumCount(30)) var items: [ModelItem]
    @Guide(description: "Exactly one category name copied from the list") var category: String
  }
  #endif

  static func understand(lines: [String], categories: [CategoryRef]) async -> Parse? {
    #if canImport(FoundationModels)
    guard #available(iOS 26.0, *) else { return nil }
    guard case .available = SystemLanguageModel.default.availability else { return nil }
    let text = String(lines.prefix(80).joined(separator: "\n").prefix(3500))
    let list = categories.map { c in c.description.map { "\(c.path) — \($0)" } ?? c.path }.joined(separator: "\n")
    let session = LanguageModelSession(instructions: """
      You read shop and restaurant receipts. The text comes from OCR and may contain errors and mixed languages (Polish, Ukrainian, English, German). \
      Extract the merchant, the grand total paid, currency, date and the purchased items, and choose the single best matching category from the user's list. \
      On Polish receipts the total is the number after "SUMA PLN" and the items are the lines between "PARAGON FISKALNY" and "SPRZEDAŻ OPODATKOWANA"; \
      "PTU" lines are tax and "KAUCJA" is a bottle deposit. Copy the category name exactly as listed.
      """)
    do {
      let r = try await session.respond(to: "Categories:\n\(list)\n\nReceipt:\n\(text)", generating: ModelParse.self).content
      guard r.total > 0 else { return nil }
      let cat = matchCategory(name: r.category, in: categories)
      return Parse(merchant: r.merchant.trimmingCharacters(in: .whitespacesAndNewlines), total: r.total, currency: r.currency.isEmpty ? nil : r.currency.uppercased(),
                   date: r.date.count == 10 ? r.date : nil, items: r.items.map { Item(name: $0.name, price: $0.price) }, paid: nil,
                   category_id: cat?.id, category_name: cat?.path ?? (r.category.isEmpty ? nil : r.category), summary: "", method: "intelligence", text: "")
    } catch { return nil }
    #else
    return nil
    #endif
  }

  #if canImport(FoundationModels)
  @available(iOS 26.0, *)
  @Generable
  struct ModelCategory { @Guide(description: "Exactly one category name copied from the list") var category: String }
  #endif

  /// Category only, for receipts already parsed by layout: merchant + items → one name from the user's list.
  static func categorize(_ p: Parse, categories: [CategoryRef]) async -> CategoryRef? {
    #if canImport(FoundationModels)
    guard #available(iOS 26.0, *) else { return nil }
    guard case .available = SystemLanguageModel.default.availability else { return nil }
    let list = categories.map { c in c.description.map { "\(c.path) — \($0)" } ?? c.path }.joined(separator: "\n")
    let items = p.items.prefix(20).map(\.name).joined(separator: ", ")
    let session = LanguageModelSession(instructions: "You sort purchases into the user's spending categories. Answer with exactly one category name copied from the list.")
    do {
      let r = try await session.respond(to: "Categories:\n\(list)\n\nShop: \(p.merchant)\nItems: \(items)", generating: ModelCategory.self).content
      return matchCategory(name: r.category, in: categories)
    } catch { return nil }
    #else
    return nil
    #endif
  }

  // MARK: - Keyword fallback

  /// The category whose name/description words appear most in the receipt; most-used category breaks ties, nil when nothing matches.
  static func keywordCategory(text: String, categories: [CategoryRef]) -> CategoryRef? {
    let hay = text.lowercased()
    func words(_ s: String?) -> [String] {
      (s ?? "").lowercased().components(separatedBy: CharacterSet.alphanumerics.inverted).filter { $0.count >= 3 }
    }
    var best: (CategoryRef, Int)? = nil
    for c in categories where c.parent != nil {
      let ws = Set(words(c.name) + words(c.description))
      let score = ws.reduce(0) { $0 + (hay.contains($1) ? 1 : 0) }
      if score > 0, best == nil || score > best!.1 || (score == best!.1 && c.uses > best!.0.uses) { best = (c, score) }
    }
    return best?.0
  }

  static func matchCategory(name: String?, in categories: [CategoryRef]) -> CategoryRef? {
    guard let n = name?.lowercased().trimmingCharacters(in: .whitespacesAndNewlines), !n.isEmpty else { return nil }
    if let c = categories.first(where: { $0.path.lowercased() == n || $0.name.lowercased() == n }) { return c }
    let leaf = n.components(separatedBy: "›").last?.trimmingCharacters(in: .whitespaces) ?? n
    return categories.first { $0.name.lowercased() == leaf } ?? categories.first { $0.parent != nil && ($0.name.lowercased().contains(leaf) || leaf.contains($0.name.lowercased())) }
  }

  // MARK: - Saving (Shortcut path: straight into the database as a pending row)

  struct Saved { let id: String; let amountMinor: Int; let currency: String; let converted: Bool; let parse: Parse }

  /// Save the receipt as a pending expense on the account (converted with a cached rate when the receipt currency differs).
  static func save(_ p: Parse, account: (id: String, currency: String)) async -> Saved? {
    var amount = p.total, converted = false
    if let rc = p.currency, rc != account.currency, let rate = KPStore.cachedRate(from: rc, to: account.currency) { amount = p.total * rate; converted = true }
    let minor = KPFormat.minor(amount, account.currency)
    let id = UUID().uuidString.lowercased()
    let date = p.date.map { "\($0)T12:00:00\(KPStore.isoNow().suffix(6))" }
    var note = p.summary
    if let rc = p.currency, rc != account.currency, !converted { note += " (in \(rc), no exchange rate)" }
    guard await KPWrites.addTransaction(id: id, accountId: account.id, amountMinor: -minor, categoryId: p.category_id, note: note, payee: p.merchant, place: p.merchant, pending: true, date: date, source: "receipt").ok else { return nil }
    return Saved(id: id, amountMinor: minor, currency: account.currency, converted: converted, parse: p)
  }

  static func dictionary(_ p: Parse) -> [String: Any] {
    [
      "merchant": p.merchant, "total": p.total, "currency": p.currency as Any, "date": p.date as Any,
      "items": p.items.map { ["name": $0.name, "price": $0.price] },
      "category_id": p.category_id as Any, "category_name": p.category_name as Any, "summary": p.summary, "method": p.method, "text": p.text,
    ]
  }
}
