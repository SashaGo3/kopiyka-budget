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
      switch self { case .noImage: return L10n.Receipt.noImage; case .noText: return L10n.Receipt.noText }
    }
  }

  // MARK: - Pipeline

  static func analyze(image: UIImage) async throws -> Parse {
    let lines = try await readText(image: image)
    guard !lines.isEmpty else { throw Failure.noText }
    return await analyze(lines: lines)
  }

  /// Vision only: the photo's text as rows, top to bottom. The fast half of `analyze`, which the photo
  /// viewer shows (and lets you copy) before the slower understanding below has finished.
  static func readText(image: UIImage) async throws -> [String] {
    guard let cg = normalized(image) else { throw Failure.noImage }
    return try await recognize(cg)
  }

  /// The second half of `analyze`, from text already read.
  static func analyze(lines: [String]) async -> Parse {
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
    // The parser (KPReceiptParse.swift, also built on its own by scripts/receipt-parse) names a shop
    // it could not read "Receipt"; the name is saved as the payee, so it is put in the app's language here.
    if parse.merchant == "Receipt" { parse.merchant = L10n.Receipt.untitled }
    parse.summary = summary(parse)
    parse.text = lines.joined(separator: "\n")
    return parse
  }

  /// Upright, and no larger than ~12 MP or 4096 px on the long side. The limit used to be 2000 px on the
  /// long side, which left a long, narrow receipt a few hundred pixels wide — too small for its print,
  /// and the cause of most misread words. Area is what costs Vision time, so that is what is capped.
  static func normalized(_ image: UIImage) -> CGImage? {
    let w = image.size.width * image.scale, h = image.size.height * image.scale
    // In points with a renderer scale of 1, so `size` below is the output in pixels.
    let scale = min(1, 4096 / max(w, h), (12_000_000 / max(w * h, 1)).squareRoot()) * image.scale
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

  #if canImport(FoundationModels)
  @available(iOS 26.0, *)
  @Generable
  struct ModelItemCategory {
    @Guide(description: "The item's number from the list") var item: Int
    @Guide(description: "Exactly one category name copied from the categories list") var category: String
  }
  @available(iOS 26.0, *)
  @Generable
  struct ModelItemCategories { @Guide(description: "One entry per purchased item", .maximumCount(40)) var items: [ModelItemCategory] }
  #endif

  /// One category per item, in the items' order (nil where nothing fits), for sorting a mixed receipt —
  /// dinner and a lamp — into the parts of a split. The on-device model when there is one; otherwise
  /// only the items whose own words name a category are answered. Saves nothing.
  static func categorize(items: [Item], merchant: String) async -> [String?] {
    let cats = KPStore.categoryRefs()
    guard !items.isEmpty, !cats.isEmpty else { return items.map { _ in nil } }
    var out: [String?] = items.map { keywordCategory(text: $0.name, categories: cats)?.id }
    #if canImport(FoundationModels)
    if #available(iOS 26.0, *), case .available = SystemLanguageModel.default.availability {
      let list = cats.map { c in c.description.map { "\(c.path) — \($0)" } ?? c.path }.joined(separator: "\n")
      let numbered = items.prefix(40).enumerated().map { "\($0.offset + 1). \($0.element.name)" }.joined(separator: "\n")
      let session = LanguageModelSession(instructions: """
        You sort the lines of one shop receipt into the user's spending categories. Item names come from OCR, \
        may be abbreviated and may be in Polish, Ukrainian, English or German. Food from a supermarket is groceries, \
        not eating out. Answer every item, copying a category name exactly as listed.
        """)
      if let r = try? await session.respond(to: "Categories:\n\(list)\n\nShop: \(merchant)\nItems:\n\(numbered)", generating: ModelItemCategories.self).content {
        for a in r.items where a.item >= 1 && a.item <= out.count {
          if let c = matchCategory(name: a.category, in: cats) { out[a.item - 1] = c.id }
        }
      }
    }
    #endif
    return out
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

  /// The note a scanned receipt is saved with, in the app's language:
  /// "Żabka · 2 items: Kanapka … 10.99, … · total 22.98 PLN · paid 23.48". `KPReceiptText.summary` is
  /// the same in English, kept for the parse harness, which builds without the String Catalog.
  static func summary(_ p: Parse) -> String {
    let cur = p.currency ?? ""
    // The language's decimal mark, like `KPFormat.money` ("10.99" / "10,99"); no grouping, as printed.
    let fmt: (Double) -> String = { String(format: "%.2f", locale: KPL.numberLocale, $0) }
    var parts: [String] = [p.merchant]
    if !p.items.isEmpty {
      let shown = p.items.prefix(8).map { "\($0.name) \(fmt($0.price))" }.joined(separator: ", ")
      parts.append("\(L10n.Receipt.items(count: p.items.count)): \(shown)\(p.items.count > 8 ? " …" : "")")
    }
    parts.append(L10n.Receipt.total(amount: cur.isEmpty ? fmt(p.total) : "\(fmt(p.total)) \(cur)"))
    if let paid = p.paid { parts.append(L10n.Receipt.paid(amount: fmt(paid))) }
    return parts.joined(separator: " · ")
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
    if let rc = p.currency, rc != account.currency, !converted { note = L10n.Receipt.noRate(note: note, currency: rc) }
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
