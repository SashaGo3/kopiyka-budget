import Foundation

/// Pure text → structure part of the receipt reader (no UIKit / Vision), so it can be unit-tested on a Mac.
/// Polish fiscal receipts ("PARAGON FISKALNY") are parsed by their fixed layout: items sit between the
/// PARAGON header and "SPRZEDAŻ OPODATKOWANA", the total is the number on the "SUMA PLN" line
/// (deposits and "DO ZAPŁATY" are reported separately). Anything else goes through generic heuristics.
enum KPReceiptText {
  struct Item: Codable, Equatable { let name: String; let price: Double }
  struct Parse: Codable {
    var merchant: String
    var total: Double
    var currency: String?
    /// YYYY-MM-DD when printed on the receipt.
    var date: String?
    var items: [Item]
    /// Amount actually paid when it differs from the total (deposits, rounding): "DO ZAPŁATY".
    var paid: Double?
    var category_id: String?
    var category_name: String?
    var summary: String
    /// "fiscal" (Polish receipt layout), "intelligence" (on-device model) or "keywords" (fallback).
    var method: String
    var text: String
  }

  static let price = try! NSRegularExpression(pattern: #"(-?\d{1,6}[.,]\d{2})(?![\d])"#)
  static let totalWords = ["suma pln", "do zapłaty", "do zaplaty", "total", "suma", "razem", "сума", "до сплати", "разом", "summe", "gesamt", "amount due", "to pay", "итого", "всего", "totale", "importe"]
  static let skipWords = ["podatek", "vat", "ptu", "tax", "change", "reszta", "здача", "gotówka", "gotowka", "karta", "card", "cash", "subtotal", "rabat", "discount", "sprzedaż", "sprzedaz", "opodatk", "nip", "paragon", "fiskalny", "kasa", "kasjer", "rozliczenie", "płatno", "platno"]

  static func numbers(_ s: String) -> [Double] {
    price.matches(in: s, range: NSRange(s.startIndex..., in: s)).compactMap { m in Range(m.range(at: 1), in: s).flatMap { Double(s[$0].replacingOccurrences(of: ",", with: ".")) } }
  }
  static func fold(_ s: String) -> String { s.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: nil).lowercased() }

  // MARK: Polish fiscal receipt

  static func isFiscal(_ lines: [String]) -> Bool { lines.contains { fold($0).contains("paragon fiskalny") } }

  static func fiscal(lines: [String]) -> Parse? {
    let low = lines.map(fold)
    guard let head = low.firstIndex(where: { $0.contains("paragon fiskalny") }) else { return nil }
    // Items run until the tax summary begins.
    let endMarkers = ["sprzedaz opodatk", "ptu ", "suma ptu", "suma pln", "rabat", "opakowania", "kaucja", "do zaplaty", "rozliczenie"]
    var end = lines.count
    for i in (head + 1)..<lines.count where endMarkers.contains(where: { low[i].hasPrefix($0) || low[i].contains(" \($0)") }) { end = i; break }
    var items: [Item] = []
    var pendingName: String? = nil
    // OCR often reads "1szt." as "Iszt." or "lszt.".
    let qty = try! NSRegularExpression(pattern: #"\s+[\dIl]+\s*(szt|x|×)|\s+x\s*\d"#, options: [.caseInsensitive])
    for i in (head + 1)..<end {
      let raw = lines[i]
      let nums = numbers(raw)
      if nums.isEmpty { pendingName = raw.trimmingCharacters(in: .whitespaces); continue }
      // Name = text before the quantity block; price = last value on the row (the tax letter A/B/C may trail it).
      var name = raw
      if let m = qty.firstMatch(in: raw, range: NSRange(raw.startIndex..., in: raw)), let r = Range(m.range, in: raw) { name = String(raw[..<r.lowerBound]) }
      else { name = raw.replacingOccurrences(of: #"\s*-?\d{1,6}[.,]\d{2}.*$"#, with: "", options: .regularExpression) }
      // Polish receipts end item names with the VAT class letter ("200g-C", "250ml A").
      name = name.replacingOccurrences(of: #"[\s-][A-G]$"#, with: "", options: .regularExpression).trimmingCharacters(in: .whitespacesAndNewlines)
      if name.rangeOfCharacter(from: .letters) == nil || name.count < 2 { name = pendingName ?? name }
      else if let p = pendingName, name.count < 4 { name = "\(p) \(name)" }
      pendingName = nil
      guard let price = nums.last, price > 0, name.rangeOfCharacter(from: .letters) != nil else { continue }
      items.append(Item(name: prettyName(name), price: price))
    }
    // Total: the "SUMA PLN" row; its number may have been merged into a neighbouring row by OCR.
    func value(near label: String) -> Double? {
      guard let i = low.firstIndex(where: { $0.contains(label) }) else { return nil }
      let own = numbers(lines[i].replacingOccurrences(of: #"(?i)ptu\s*[a-z]\s*\d+%"#, with: "", options: .regularExpression))
      if let v = own.last, v > 0 { return v }
      for j in [i + 1, i - 1] where j >= 0 && j < lines.count { if let v = numbers(lines[j]).last, v > 0, !low[j].contains("ptu") || low[j].contains("suma ptu") { return v } }
      return nil
    }
    var total = value(near: "suma pln")
    let paid = value(near: "do zaplaty") ?? lines.lazy.compactMap { l -> Double? in fold(l).contains("pln") && !fold(l).contains("suma") ? numbers(l).last : nil }.first
    if total == nil { total = paid }
    if total == nil, !items.isEmpty { total = items.reduce(0) { $0 + $1.price } }
    guard let t = total, t > 0 else { return nil }
    return Parse(merchant: merchantName(in: Array(lines.prefix(head))), total: t, currency: "PLN", date: date(in: lines), items: items,
                 paid: paid.flatMap { abs($0 - t) > 0.004 ? $0 : nil }, category_id: nil, category_name: nil, summary: "", method: "fiscal", text: "")
  }

  /// The shop from the header rows: a quoted name or a "Sklep …" segment wins; otherwise the first
  /// row that is neither an address (street, postcode), a tax id, nor a "nr:" line. Rows may hold two
  /// columns joined by a double space, so each segment is judged on its own.
  static func merchantName(in header: [String]) -> String {
    let segments = header.flatMap { $0.components(separatedBy: "  ") }.map { $0.trimmingCharacters(in: .whitespaces) }.filter { $0.rangeOfCharacter(from: .letters) != nil }
    if let quoted = segments.lazy.compactMap({ seg -> String? in
      guard let m = seg.range(of: #"["„“]([^"”“]+)["”“]"#, options: .regularExpression) else { return nil }
      return String(seg[m]).trimmingCharacters(in: CharacterSet(charactersIn: "\"„”“"))
    }).first { return cleanMerchant(quoted) }
    if let shop = segments.first(where: { fold($0).hasPrefix("sklep ") }) { return cleanMerchant(shop) }
    let bad = ["nip", "ul.", "ul ", "nr", ":", "tel", "www", "http", "regon", "kasa", "paragon", "fiskalny"]
    let plain = segments.first { seg in
      let f = fold(seg)
      return !bad.contains(where: { f.contains($0) }) && seg.range(of: #"^\d{2}-\d{3}"#, options: .regularExpression) == nil && numbers(seg).isEmpty
    }
    return cleanMerchant(plain ?? "Receipt")
  }

  /// "KANAPKA TROJ TUNCZYK 200g-C" → "Kanapka Troj Tunczyk 200g-C": shouty receipt text reads better in a note.
  static func prettyName(_ s: String) -> String {
    let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
    let upper = t.unicodeScalars.filter { CharacterSet.uppercaseLetters.contains($0) }.count
    let lower = t.unicodeScalars.filter { CharacterSet.lowercaseLetters.contains($0) }.count
    guard upper >= 3, upper >= lower * 3 else { return t }
    return t.lowercased().split(separator: " ").map { w in w.first.map { String($0).uppercased() + w.dropFirst() } ?? "" }.joined(separator: " ")
  }

  /// `Sklep "ŻABKA" ZE212` → `Żabka`: drop the shop word, quotes and store codes.
  static func cleanMerchant(_ s: String) -> String {
    var t = s.replacingOccurrences(of: "\"", with: "").replacingOccurrences(of: "„", with: "").replacingOccurrences(of: "”", with: "")
    t = t.replacingOccurrences(of: #"(?i)^(sklep|shop|store|market)\s+"#, with: "", options: .regularExpression)
    t = t.split(separator: " ").filter { $0.rangeOfCharacter(from: .decimalDigits) == nil }.joined(separator: " ")
    t = t.trimmingCharacters(in: .whitespacesAndNewlines)
    if t.count > 3, t == t.uppercased() { t = t.capitalized }
    return t.isEmpty ? "Receipt" : t
  }

  // MARK: Generic receipt

  static func heuristic(lines: [String]) -> Parse {
    let lower = lines.map(fold)
    var total: Double = 0
    for (i, l) in lower.enumerated() where totalWords.contains(where: { l.contains($0) }) {
      let candidates = numbers(lines[i]) + (i + 1 < lines.count ? numbers(lines[i + 1]) : [])
      if let m = candidates.max(), m > total { total = m }
    }
    if total == 0 { total = lines.flatMap(numbers).max() ?? 0 }
    var items: [Item] = []
    for (i, l) in lines.enumerated() {
      let low = lower[i]
      if totalWords.contains(where: { low.contains($0) }) || skipWords.contains(where: { low.contains($0) }) { continue }
      guard let p = numbers(l).last, p > 0, p <= total || total == 0 else { continue }
      let name = l.replacingOccurrences(of: #"\s*-?\d{1,6}[.,]\d{2}.*$"#, with: "", options: .regularExpression).trimmingCharacters(in: .whitespacesAndNewlines)
      if name.count >= 3, name.rangeOfCharacter(from: .letters) != nil { items.append(Item(name: name, price: p)) }
    }
    let merchant = lines.first { l in l.count >= 3 && l.rangeOfCharacter(from: .letters) != nil && numbers(l).isEmpty && !skipWords.contains(where: { fold(l).contains($0) }) } ?? "Receipt"
    let all = lower.joined(separator: "\n")
    let currency: String? = all.contains("zł") || all.contains("zl ") || all.contains(" pln") ? "PLN" : all.contains("€") || all.contains(" eur") ? "EUR" : all.contains("₴") || all.contains("грн") || all.contains(" uah") ? "UAH" : all.contains("$") || all.contains(" usd") ? "USD" : all.contains("£") || all.contains(" gbp") ? "GBP" : nil
    return Parse(merchant: cleanMerchant(merchant), total: total, currency: currency, date: date(in: lines), items: Array(items.prefix(30)), paid: nil,
                 category_id: nil, category_name: nil, summary: "", method: "keywords", text: "")
  }

  /// dd.mm.yyyy, dd-mm-yyyy, dd/mm/yyyy or yyyy-mm-dd → YYYY-MM-DD.
  static func date(in lines: [String]) -> String? {
    let dmy = try! NSRegularExpression(pattern: #"(?<!\d)(\d{2})[./-](\d{2})[./-](20\d{2})(?!\d)"#)
    let ymd = try! NSRegularExpression(pattern: #"(?<!\d)(20\d{2})-(\d{2})-(\d{2})(?!\d)"#)
    for l in lines {
      let r = NSRange(l.startIndex..., in: l)
      if let m = ymd.firstMatch(in: l, range: r) { return (1...3).compactMap { Range(m.range(at: $0), in: l).map { String(l[$0]) } }.joined(separator: "-") }
      if let m = dmy.firstMatch(in: l, range: r), let d = Range(m.range(at: 1), in: l), let mo = Range(m.range(at: 2), in: l), let y = Range(m.range(at: 3), in: l), Int(l[mo])! <= 12 {
        return "\(l[y])-\(l[mo])-\(l[d])"
      }
    }
    return nil
  }

  /// "Żabka · 2 items: Kanapka … 10.99, … · total 22.98 PLN · paid 23.48"
  static func summary(_ p: Parse) -> String {
    let cur = p.currency ?? ""
    let fmt: (Double) -> String = { String(format: "%.2f", $0) }
    var parts: [String] = [p.merchant]
    if !p.items.isEmpty {
      let shown = p.items.prefix(8).map { "\($0.name) \(fmt($0.price))" }.joined(separator: ", ")
      parts.append("\(p.items.count) item\(p.items.count == 1 ? "" : "s"): \(shown)\(p.items.count > 8 ? " …" : "")")
    }
    parts.append("total \(fmt(p.total))\(cur.isEmpty ? "" : " \(cur)")")
    if let paid = p.paid { parts.append("paid \(fmt(paid))") }
    return parts.joined(separator: " · ")
  }
}
