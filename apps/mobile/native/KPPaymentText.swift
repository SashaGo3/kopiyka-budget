import Foundation

/// Pure text → payment part of the notification reader (no UIKit, no database), so it can be run on a
/// Mac against real notification text: `scripts/payment-parse`.
///
/// Why text at all: the Shortcuts **Transaction** trigger (the old Apple Pay route) is gone on iOS 26+,
/// so the only automation that still fires on a card payment is **"When I receive a notification"**. It
/// hands the shortcut the notification's Title, Subtitle and Message, and `LogPaymentIntent` asks this
/// parser to turn them into an amount, a shop and a time.
///
/// Ignoring is the normal outcome — almost nothing that arrives is a payment. `parse` returns nil unless
/// it finds a number that really looks like money (a currency beside it, or an "Amount:"-style label),
/// and it refuses texts that announce a declined payment, a balance or a one-time code.
enum KPPaymentText {
  struct Parse: Equatable {
    /// Always positive; `income` carries the direction.
    var amount: Double
    var currency: String?
    var merchant: String?
    /// City or branch, when the bank prints it after the shop ("…, KATOWICE").
    var place: String?
    var card: String?
    /// yyyy-MM-dd, when the notification prints one.
    var date: String?
    /// HH:mm:ss, when the notification prints one.
    var time: String?
    /// A refund or an incoming transfer rather than a purchase.
    var income: Bool
    /// The notification, whitespace-collapsed — kept as the note when there is no shop to name the row.
    var text: String
    /// Who sent the money, when the notification names them ("Sender: PETRENKO ANDRII"). Becomes the
    /// payee of an incoming transfer, which has no shop to be named after.
    var sender: String?
    /// What the payer called it ("Title: ZVROT", "Tytuł: …") — the note of a transfer.
    var reference: String?
    /// What the bank says is left afterwards ("Available balance: +2816,43 PLN"). Never the amount
    /// of the payment; parsed so that it can be told apart from one.
    var balance: Double?
    /// Every sum the text named that could be money, in reading order — `amount` is the one this
    /// reader would pick on its own. Banks often print the purchase twice ("36,00 EUR (154,80 PLN)"),
    /// and the caller, which knows what currency the account is in, can choose better than the text
    /// can: taking the figure the bank already converted beats converting it again from a cached rate.
    var amounts: [Money] = []
  }

  /// What a notification turned out to be. Most are not payments and the automation has to pass over
  /// them without a word; the third case is the one worth interrupting the user for.
  enum Outcome: Equatable {
    case payment(Parse)
    /// No money in the text at all, or money the bank is explicitly not charging: a declined card, a
    /// balance, a one-time code. Nothing to log and nothing to report.
    case ignored
    /// Money is named but no amount could be read out of it — a bank whose wording the reader does
    /// not know yet. Worth saying out loud, because it is the only outcome the user can act on.
    case unreadable
  }

  // MARK: - Entry point

  /// Title + Subtitle + Message from the Shortcuts notification trigger. nil means "not a payment".
  /// Kept for the harness and for shortcuts built before `read`; `Outcome` says *why* there is nothing.
  static func parse(title: String?, subtitle: String?, body: String?) -> Parse? {
    if case .payment(let p) = read(title: title, subtitle: subtitle, body: body) { return p }
    return nil
  }

  /// The whole **Notification** variable, handed over as one block of text.
  ///
  /// Shortcuts' notification automation offers the notification itself as a variable, and it flattens
  /// to its own lines: the app's title first, then the subtitle, then the body. Splitting it back the
  /// same way is what lets a Wallet notification ("PKO Bank Polski" / "Glovo" / "99,26 PLN"), whose
  /// three parts mean something only by their position, be read from one field.
  static func read(notification: String?) -> Outcome {
    guard let whole = clean(notification), !whole.isEmpty else { return .ignored }
    let lines = whole.components(separatedBy: .newlines).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
    guard let title = lines.first else { return .ignored }
    let subtitle = lines.count >= 3 ? lines[1] : nil
    let body = lines.dropFirst(subtitle == nil ? 1 : 2).joined(separator: "\n")
    return read(title: title, subtitle: subtitle, body: body.isEmpty ? nil : body)
  }

  /// Title + Subtitle + Message from the Shortcuts notification trigger.
  static func read(title: String?, subtitle: String?, body: String?) -> Outcome {
    let parts = [title, subtitle, body].compactMap { clean($0) }.filter { !$0.isEmpty }
    guard !parts.isEmpty else { return .ignored }
    let whole = parts.joined(separator: "\n")

    // "Available balance: +2816,43 PLN" is money, and it is never the money that moved. Taking it out
    // first stops it from being mistaken for the payment and, just as important, stops the word
    // "balance" in it from making the whole notification look like a balance report. Only the clause
    // is removed, not the line it sits on: banks crowd several onto one ("Amount: 36,00 PLN.
    // Available balance: 1 200,00 PLN"), and dropping that line would drop the payment with it.
    var balanceValue: Double? = nil
    var kept: [String] = []
    for line in whole.components(separatedBy: .newlines) {
      let (rest, found) = stripBalance(line.trimmingCharacters(in: .whitespaces))
      if balanceValue == nil { balanceValue = found }
      if !rest.isEmpty { kept.append(rest) }
    }
    let text = kept.joined(separator: "\n")

    guard !isIgnored(text) else { return .ignored }
    let candidates = amounts(in: text)
    guard let money = choose(candidates) else { return looksLikeMoney(text) ? .unreadable : .ignored }

    let lines = text.components(separatedBy: .newlines)
    // Wallet has no labels at all — Title is the issuer ("PKO Bank Polski"), Subtitle the shop
    // ("Glovo"), Message the amount ("99,26 PLN") — so each falls back to its position.
    let labelled = merchant(in: lines)
    let fallback = clean(subtitle).flatMap { s in labelled == nil && amount(in: s) == nil && s.rangeOfCharacter(from: .letters) != nil ? s : nil }
    let who = sender(in: lines)
    // A printed "+" is the bank saying the money came in, and nothing else writes one. A "-" is not
    // as safe: the amount labels this reader accepts allow a dash as their separator ("Kwota - 100,00
    // PLN"), so a minus only ever agrees with the default — an expense — and never overrules a word
    // like "zwrot" or "uznanie".
    let income = money.sign > 0 || isIncome(text)
    // An incoming transfer has no shop; the person who sent it is what names the row instead, and a
    // labelled sender beats guessing at the subtitle's position.
    let (shop, city) = splitCity(labelled ?? (income ? who : nil) ?? fallback ?? who)
    let stamp = timestamp(in: text)

    return .payment(Parse(amount: money.value, currency: money.currency, merchant: shop, place: city, card: card(in: lines) ?? issuer(clean(title)),
                 date: stamp?.day, time: stamp?.time, income: income,
                 text: String(text.replacingOccurrences(of: "\n", with: " · ").prefix(300)),
                 sender: who, reference: reference(in: lines), balance: balanceValue, amounts: candidates))
  }

  // MARK: - Amount

  /// `sign` is what the bank printed in front of the number: +1, -1, or 0 when it printed nothing.
  /// `labelled` means a word like "Amount:" introduced it, which is what makes it beat a stray sum.
  struct Money: Equatable { let value: Double; let currency: String?; var sign: Int = 0; var labelled: Bool = false }

  static let symbols: [String: String] = [
    "zł": "PLN", "zl": "PLN", "€": "EUR", "$": "USD", "£": "GBP", "₴": "UAH", "грн": "UAH",
    "¥": "JPY", "₺": "TRY", "₸": "KZT", "kč": "CZK", "kc": "CZK", "лв": "BGN",
    "₹": "INR", "rs": "INR", "฿": "THB", "₩": "KRW", "lei": "RON",
    "euro": "EUR", "euros": "EUR", "dollars": "USD", "złotych": "PLN", "zlotych": "PLN", "гривень": "UAH", "гривні": "UAH",
  ]
  static let codes: Set<String> = [
    "PLN", "EUR", "USD", "GBP", "UAH", "CHF", "CZK", "SEK", "NOK", "DKK", "HUF", "RON", "BGN", "TRY",
    "CAD", "AUD", "NZD", "JPY", "CNY", "KZT", "GEL", "MDL", "RSD", "ISK", "ILS", "AED", "INR", "SGD",
    "HKD", "ZAR", "MXN", "BRL", "THB", "KRW", "PHP", "MYR", "VND", "EGP",
  ]

  /// Digits with optional thousands separators and up to two decimals. Kept loose; `number` decides what it means.
  private static let digits = #"\d[\d  \u00A0\u202F’',.]*\d|\d"#
  private static let symbolAlternation = #"[€$£₴¥₺₹฿₩]|zł|zl|грн|kč|kc|лв|₸|\b(?i:rs)\.?|\b(?i:lei)\b|\b(?i:euros?)\b|\b(?i:dollars)\b|\b(?i:z[łl]otych)\b|\bгривен[ьі]\b"#
  /// Words a bank puts in front of the number. "Amount: 36,00 PLN", "Kwota 36,00", "Сума: 36,00".
  private static let amountLabels = #"amount|kwota|kwoty|suma|sumy|total|value|warto[śs][ćc]|betrag|importe|montant|prezzo|сум[аи]|сумм[аы]|вартість"#

  /// A three-letter code, however tightly the bank packs it against the number ("-27.00UAH"). `\b`
  /// cannot do this: a digit and a letter are both word characters, so there is no boundary between
  /// them. The lookarounds test for *letters* instead, which still keeps "PIN" and "IBAN" out.
  private static let code = #"(?<![A-Za-z])[A-Z]{3}(?![A-Za-z])"#
  private static let currencyFirst = re(#"(\#(symbolAlternation)|\#(code))\s?(\#(digits))"#)
  private static let currencyLast = re(#"(\#(digits))\s?(\#(symbolAlternation)|\#(code))"#)
  private static let symbolChars = Set("€$£₴¥₺₸₹฿₩")
  /// "Amount:" with nothing readable behind it — the bank named money and the reader still has none.
  private static let bareAmountLabel = re(#"(?:\#(amountLabels))\s*[:=]"#, [.caseInsensitive])
  private static let labelledAmount = re(#"(?:\#(amountLabels))\s*(?:[:=\-–]\s*)?(\#(digits))"#)

  /// The amount a payment notification is about, or nil when the text holds no money.
  ///
  /// Only two shapes count: a number with a currency beside it, or a number behind an "Amount:"-style
  /// label. Everything else in a notification that looks numeric — a date, a time, a card's last four,
  /// a reference number — is therefore ignored without needing a rule of its own.
  static func amount(in text: String) -> Money? { choose(amounts(in: text)) }

  /// The one this reader picks when nobody tells it better: a labelled amount over a stray one
  /// ("Amount: 36,00 PLN. Available: 1 200,00 PLN"), ties to the earliest, which in every bank
  /// layout seen is the transaction itself.
  static func choose(_ found: [Money]) -> Money? {
    guard !found.isEmpty else { return nil }
    return found.first(where: \.labelled) ?? found[0]
  }

  /// Every sum in the text that is money — a number with a currency beside it, or one behind an
  /// "Amount:"-style label — in reading order. Everything else that looks numeric (a date, a time,
  /// a card's last four, a reference number) is left out without needing a rule of its own.
  static func amounts(in text: String) -> [Money] {
    struct Candidate { let range: NSRange; let value: Double; var currency: String?; var labelled: Bool; var sign: Int }
    var found: [Candidate] = []
    func add(range: NSRange, raw: String, currency: String?, labelled: Bool, signFrom: Int) {
      guard let v = number(raw), v > 0, v < 1e9 else { return }
      let sign = signBefore(text, signFrom)
      if let i = found.firstIndex(where: { NSEqualRanges($0.range, range) }) {
        if let c = currency { found[i].currency = c }
        found[i].labelled = found[i].labelled || labelled
        if found[i].sign == 0 { found[i].sign = sign }
      } else {
        found.append(Candidate(range: range, value: v, currency: currency, labelled: labelled, sign: sign))
      }
    }
    let whole = NSRange(text.startIndex..., in: text)
    for (rx, numberGroup, currencyGroup) in [(currencyFirst, 2, 1), (currencyLast, 1, 2)] {
      for m in rx.matches(in: text, range: whole) {
        guard let n = substring(text, m.range(at: numberGroup)), let c = substring(text, m.range(at: currencyGroup)), let code = currency(c) else { continue }
        // "+120,00 PLN" signs the number, "PLN +120,00" signs the pair: look in front of whichever comes first.
        add(range: m.range(at: numberGroup), raw: n, currency: code, labelled: false, signFrom: m.range.location)
      }
    }
    for m in labelledAmount.matches(in: text, range: whole) {
      guard let n = substring(text, m.range(at: 1)) else { continue }
      add(range: m.range(at: 1), raw: n, currency: nil, labelled: true, signFrom: m.range(at: 1).location)
    }
    // Three regexes contribute, so put the candidates back into reading order.
    found.sort { $0.range.location < $1.range.location }
    // Without a label a bare number proves nothing — only a currency beside it makes it money.
    // A labelled one with no currency of its own borrows the first the text names.
    let fallbackCurrency = found.compactMap(\.currency).first
    return found.filter { $0.labelled || $0.currency != nil }
      .map { Money(value: $0.value, currency: $0.currency ?? fallbackCurrency, sign: $0.sign, labelled: $0.labelled) }
  }

  /// Whether the text names money at all, however unreadably. It separates the two ways a notification
  /// can yield nothing: one that never mentioned money (almost all of them — pass over it in silence)
  /// from one that did and still could not be read (the bank's wording is new: worth reporting).
  static func looksLikeMoney(_ text: String) -> Bool {
    let whole = NSRange(text.startIndex..., in: text)
    if labelledAmount.firstMatch(in: text, range: whole) != nil { return true }
    if bareAmountLabel.firstMatch(in: text, range: whole) != nil { return true }
    // A currency named on its own, with the number missing or in a shape `number` could not read.
    // Three capitals only as written: lower-cased "try" is an English word before it is a lira.
    for token in text.split(whereSeparator: { !$0.isLetter && !symbolChars.contains($0) }) {
      let t = String(token)
      if symbols[t.lowercased()] != nil { return true }
      if t == t.uppercased(), codes.contains(t) { return true }
    }
    return false
  }

  /// A "+" or "−" printed immediately in front of the money, which is how a bank says which way it
  /// went when no word does ("+120,00 PLN Przelew na telefon"). 0 when nothing is printed there.
  private static func signBefore(_ text: String, _ location: Int) -> Int {
    let ns = text as NSString
    var i = location - 1
    while i >= 0, let u = UnicodeScalar(ns.character(at: i)), CharacterSet.whitespaces.contains(u) { i -= 1 }
    guard i >= 0, let u = UnicodeScalar(ns.character(at: i)) else { return 0 }
    switch Character(u) {
    case "+": return 1
    case "-", "\u{2212}", "\u{2013}": return -1
    default: return 0
    }
  }

  /// "PLN" / "zł" / "€" → an ISO code, or nil when the token is just three capitals ("PIN", "IKO", "SMS").
  static func currency(_ token: String) -> String? {
    // "Rs." brings its full stop along with it; the abbreviation is the currency, the dot is not.
    let t = token.trimmingCharacters(in: CharacterSet(charactersIn: " .")).trimmingCharacters(in: .whitespaces)
    if let mapped = symbols[t.lowercased()] { return mapped }
    let upper = t.uppercased()
    return codes.contains(upper) ? upper : nil
  }

  /// "36,00" → 36.0, "1 234,56" → 1234.56, "1,234.56" → 1234.56, "1.234" → 1234.
  ///
  /// The last separator decides: with both present the later one is the decimal point, with one present
  /// three trailing digits mean thousands (Polish and German notifications both write "1.234,56").
  static func number(_ raw: String) -> Double? {
    var s = raw
    for junk in [" ", "\u{00A0}", "\u{202F}", "\u{2009}", "'", "’"] { s = s.replacingOccurrences(of: junk, with: "") }
    guard !s.isEmpty else { return nil }
    let comma = s.lastIndex(of: ","), dot = s.lastIndex(of: ".")
    var decimal: Character? = nil
    if let c = comma, let d = dot { decimal = c > d ? "," : "." }   // "1.234,56" / "1,234.56": the later one splits the pennies
    else if let one = comma ?? dot {
      let sep = s[one]
      let tail = s.distance(from: s.index(after: one), to: s.endIndex)
      let before = s.distance(from: s.startIndex, to: one)
      // One separator, three digits behind it and at most three in front: a thousands group ("1.234").
      // One or two digits behind it: the pennies ("36,00"). Repeated: grouping throughout ("1.234.567").
      let grouping = s.filter { $0 == sep }.count > 1 || (tail == 3 && before <= 3) || (tail != 1 && tail != 2)
      decimal = grouping ? nil : sep
    }
    guard let d = decimal, let split = s.lastIndex(of: d) else { return Double(s.filter(\.isNumber)) }
    let whole = s[s.startIndex..<split].filter(\.isNumber)
    let pennies = s[s.index(after: split)...].filter(\.isNumber)
    return Double("\(whole.isEmpty ? "0" : whole).\(pennies)")
  }

  // MARK: - Shop, card, time

  private static let merchantLabels = #"place|miejsce|sprzedawca|merchant|shop|sklep|punkt|lokalizacja|terminal|odbiorca|м[іи]сце|магазин|продавець|получатель"#
  private static let cardLabels = #"card|karta|kart[ay]|карт[аи]|konto|account|rachunek"#
  /// Banks put one label per line, but some crowd several onto one ("Amount: … . Place: … ."), so the
  /// label is looked for anywhere and its value runs to the end of the line — trimmed back by `cutAtLabel`
  /// when the next label follows on the same line. Stopping at the first full stop would not do: shop
  /// names contain them ("ZABKA ZE212 K.5").
  private static let merchantLine = re(#"(?:\#(merchantLabels))\s*[:=–-]\s*(.+?)\s*$"#, [.caseInsensitive])
  private static let merchantInline = re(#"(?:\bat\b|\bw\b|\bu\b|\bin\b|\bod\b)\s+([\p{L}][\p{L}\p{N} .,&'’\-]{2,60}?)[.;]?\s*$"#, [.caseInsensitive])
  private static let cardLine = re(#"(?:\#(cardLabels))\s*[:=–-]\s*(.+?)\s*$"#, [.caseInsensitive])
  private static let cardMasked = re(#"(?:[•*·x×]{2,6}|\.{3,6})\s?(\d{4})\b"#, [.caseInsensitive])
  private static let senderLabels = #"sender|nadawca|nadawcy|p[łl]atnik|payer|from account holder|відправник|платник|отправитель"#
  private static let senderWords = ["sender", "nadawca", "nadawcy", "platnik", "payer", "vidpravnik", "vidpravnyk", "platnyk", "otpravitel"]
  private static let referenceLabels = #"title|tytu[łl]|tytu[łl]em|nazwa|reference|opis|description|призначення|назва|коментар|наименование"#
  private static let balanceLabels = #"available balance|avail\.? bal|av[lb]l?\.? bal|balance|bal\.|saldo|stan konta|stan rachunku|dost[ęe]pne [śs]rodki|available funds|available limit|dost[ęe]pny limit|outstanding|dostupno|залишок|доступно|баланс|остаток"#
  private static let senderLine = re(#"(?:\#(senderLabels))\s*[:=–-]\s*(.+?)\s*$"#, [.caseInsensitive])
  private static let referenceLine = re(#"(?:\#(referenceLabels))\s*[:=–-]\s*(.+?)\s*$"#, [.caseInsensitive])
  private static let balanceLine = re(#"(?:\#(balanceLabels))\s*[:=]?\s*[+-]?\s*(\#(digits))\s*(?:\#(symbolAlternation)|\b[A-Z]{3}\b)?\s*[.]?\s*$"#, [.caseInsensitive])
  /// "On account no. 27..1946", "Na rachunek nr 12..3456" — an account named without a colon after it.
  private static let accountNumber = re(#"(?:account|rachunek|rachunku|konto|konta|рахунок|рахунку|счет)\s*(?:no\.?|nr\.?|number|№)?\s*[:=]?\s*((?:\d|[•*·]|\.){4,34}\d{2,4})"#, [.caseInsensitive])
  private static let nextLabel = re(#"\s(?:\#(merchantLabels)|\#(cardLabels)|\#(amountLabels)|\#(senderLabels)|\#(referenceLabels)|\#(balanceLabels)|date|data|дата|time|godzina|час)\s*[:=]"#, [.caseInsensitive])

  static func merchant(in lines: [String]) -> String? {
    for l in lines { if let m = first(merchantLine, l) { return tidy(cutAtLabel(m)) } }
    for l in lines { if let m = first(merchantInline, l), amount(in: m) == nil { return tidy(m) } }
    return nil
  }

  /// The card or account the money moved on.
  ///
  /// A transfer notification names two accounts — the other party's and yours — so any line that
  /// introduces the sender is skipped first: "Sender Account: 52..0007" is not the card to file this
  /// under, "On account no. 27..1946" is.
  static func card(in lines: [String]) -> String? {
    let mine = lines.filter { !mentionsSender($0) }
    for l in mine { if let m = first(cardLine, l) { return tidy(cutAtLabel(m)) } }
    for l in mine { if let m = first(accountNumber, l) { return masked(m) } }
    for l in mine { if let m = first(cardMasked, l) { return "••\(m)" } }
    return nil
  }

  /// Who sent the money. Only the labelled form counts: a bare name in a notification is as likely
  /// to be the bank's own.
  static func sender(in lines: [String]) -> String? {
    for l in lines { if let m = first(senderLine, l) { return tidy(cutAtLabel(m)) } }
    return nil
  }

  /// What the payer called the transfer — "Title: ZVROT" — which is the only description it has.
  static func reference(in lines: [String]) -> String? {
    for l in lines { if let m = first(referenceLine, l) { return tidy(cutAtLabel(m)) } }
    return nil
  }

  /// Splits a line into what it says about the payment and what it says about the money left over:
  /// `stripBalance("Amount: 36,00 PLN. Available balance: 1 200,00 PLN")` keeps the first half and
  /// answers 1200. A line that was only ever about the balance comes back empty.
  static func stripBalance(_ line: String) -> (rest: String, balance: Double?) {
    guard let m = balanceLine.firstMatch(in: line, range: NSRange(line.startIndex..., in: line)),
          let value = substring(line, m.range(at: 1)).flatMap(number) else { return (line, nil) }
    let rest = (line as NSString).replacingCharacters(in: m.range, with: " ").trimmingCharacters(in: .whitespaces)
    return (rest, value)
  }

  /// "27..1946" → "••1946": whatever the bank masks an account with, what is usable is the last four.
  private static func masked(_ s: String) -> String? {
    let digits = s.filter(\.isNumber)
    return digits.count >= 4 ? "••\(digits.suffix(4))" : tidy(s)
  }

  private static func mentionsSender(_ line: String) -> Bool {
    let f = fold(line)
    return senderWords.contains { f.contains($0) }
  }

  /// "AUTO KOMIS, POZNAN. Date: 2026-09-09" → "AUTO KOMIS, POZNAN." — the next label on a crowded line.
  private static func cutAtLabel(_ s: String) -> String {
    guard let m = nextLabel.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)), let r = Range(m.range, in: s) else { return s }
    return String(s[s.startIndex..<r.lowerBound])
  }

  /// Words that mean the title is describing the notification, not naming the card.
  private static let notACard = ["authorization", "authorisation", "autoryzacja", "transaction", "transakcja", "payment", "platnosc", "purchase", "zakup", "operacja", "operation", "alert", "powiadomienie"]

  /// Wallet's Title is the card issuer ("PKO Bank Polski"), which is the only account hint that
  /// notification carries; a bank app's own Title describes the event instead ("Payment card
  /// authorization") and must not be mistaken for one. Never stored — only matched against account names.
  static func issuer(_ title: String?) -> String? {
    guard let t = title?.trimmingCharacters(in: .whitespacesAndNewlines), !t.isEmpty else { return nil }
    let f = fold(t)
    guard t.split(separator: " ").count <= 5, !notACard.contains(where: { f.contains($0) }), amount(in: t) == nil, t.rangeOfCharacter(from: .letters) != nil else { return nil }
    return t
  }

  /// Whether two shop names can be the same place, for pairing a Wallet notification with the bank's
  /// own one: Wallet prints "Glovo", the bank "GLOVO*ORDER, WARSZAWA". A missing name matches anything
  /// (Wallet gives none for some cards); otherwise one normalised name has to start with the other.
  static func sameMerchant(_ a: String?, _ b: String?) -> Bool {
    func key(_ s: String?) -> String? {
      let k = fold(s ?? "").filter { $0.isLetter || $0.isNumber }
      return k.count >= 3 ? String(k.prefix(12)) : nil
    }
    guard let x = key(a), let y = key(b) else { return true }
    return x.hasPrefix(y) || y.hasPrefix(x)
  }

  /// "El Gato Coffeee Roaste, GDANSK" → ("El Gato Coffeee Roaste", "GDANSK"). Banks append the city in
  /// capitals; splitting it keeps the payee stable across branches so the category memory can match it.
  static func splitCity(_ merchant: String?) -> (String?, String?) {
    guard let m = merchant, let comma = m.lastIndex(of: ",") else { return (merchant, nil) }
    let head = String(m[m.startIndex..<comma]).trimmingCharacters(in: .whitespaces)
    let tail = String(m[m.index(after: comma)...]).trimmingCharacters(in: .whitespaces)
    let words = tail.split(separator: " ")
    guard !head.isEmpty, !tail.isEmpty, words.count <= 3, tail == tail.uppercased(), tail.rangeOfCharacter(from: .letters) != nil else { return (m, nil) }
    return (head, tail)
  }

  private static let stamp = re(#"(20\d{2})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?"#)
  private static let stampDMY = re(#"(?<!\d)(\d{2})[./](\d{2})[./](20\d{2})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?"#)

  /// The moment the bank printed, so a notification that arrives late still lands on the right day.
  static func timestamp(in text: String) -> (day: String, time: String?)? {
    let whole = NSRange(text.startIndex..., in: text)
    func time(_ m: NSTextCheckingResult, _ h: Int) -> String? {
      guard let hh = substring(text, m.range(at: h)), let mm = substring(text, m.range(at: h + 1)) else { return nil }
      return "\(hh):\(mm):\(substring(text, m.range(at: h + 2)) ?? "00")"
    }
    if let m = stamp.firstMatch(in: text, range: whole), let y = substring(text, m.range(at: 1)), let mo = substring(text, m.range(at: 2)), let d = substring(text, m.range(at: 3)) {
      return ("\(y)-\(mo)-\(d)", time(m, 4))
    }
    if let m = stampDMY.firstMatch(in: text, range: whole), let d = substring(text, m.range(at: 1)), let mo = substring(text, m.range(at: 2)), let y = substring(text, m.range(at: 3)), (Int(mo) ?? 13) <= 12 {
      return ("\(y)-\(mo)-\(d)", time(m, 4))
    }
    return nil
  }

  /// Whether the day a notification printed is one a payment could actually have happened on.
  ///
  /// Banks also notify things that have not happened yet — a standing order due on the 1st, a card
  /// expiring — and a date lifted out of that text would file the entry in the future, where it is
  /// invisible until the day arrives. So the bank's own day is used only when it is today or in the
  /// recent past; anything else falls back to the moment the notification arrived.
  /// A day string as a `Date`, so a test can pin "now" instead of depending on the clock.
  static func dayValue(_ day: String) -> Date { dayParser.date(from: day) ?? Date() }

  static func isPlausibleDay(_ day: String, now: Date = Date()) -> Bool {
    guard let d = dayParser.date(from: day) else { return false }
    let delta = d.timeIntervalSince(now)
    return delta < 86_400 && delta > -30 * 86_400
  }

  // MARK: - Direction and rejection

  private static let incomeWords = ["refund", "refunded", "zwrot", "wpływ", "wplyw", "wpłat", "wplat", "uznanie", "przelew przychodz", "credited", "credit to", "received", "deposit",
                                    "salary", "wynagrodzenie", "odsetki", "interest paid",
                                    "повернення", "зарахування", "поповнення", "надходження", "зарплат", "возврат"]
  /// Notifications that carry an amount but are not a payment: a rejected card, a balance, a reminder.
  ///
  /// Every word here can silently swallow a real payment, so they stay narrow — phrases rather than
  /// words wherever a word has an innocent meaning ("kurs walut" and not "kurs", which is also a
  /// language course you might pay for; "one-time" and not "otp", which hides inside other words).
  private static let ignoreWords = ["declined", "rejected", "odrzucon", "nieudan", "nie udalo sie", "nie udało się", "failed", "insufficient",
                                    "vidmova", "відмова", "недостатньо", "nedostatno", "brak środk", "brak srodk", "anulowan", "cancelled", "canceled", "reversal", "відхилен", "скасован",
                                    "saldo", "balance", "available funds", "dostępne środki", "dostepne srodki", "залишок", "баланс",
                                    "kod blik", "blik code", "one-time code", "one-time password", "verification code", "security code", "kod weryfikacyjny", "jednorazowy kod", "haslo jednorazowe", "kod autoryzacyjn", "kod sms",
                                    "одноразов", "код підтвердж", "код подтвержд",
                                    // Rates and offers quote money they are not charging you.
                                    "kurs walut", "kursy walut", "exchange rate", "fx rate", "currency rate", "notowania",
                                    // The card itself, not a payment made with it.
                                    "card is ready", "karta jest gotowa", "card activated", "karta aktywowana", "your new card", "nowa karta", "zmiana pin", "pin changed",
                                    // Somebody signing in is not somebody spending.
                                    "zalogowano", "logowanie", "new sign-in", "new login",
                                    // Money that has not moved yet: a reminder about what is coming is not a payment.
                                    "zostanie pobran", "zostanie obciążon", "zostanie obciazon", "will be charged", "will be debited", "will be taken",
                                    "upcoming payment", "nadchodząc", "nadchodzac", "przypomnienie", "reminder",
                                    // A hold being released is the undoing of a charge, not another one.
                                    "zwrot blokady", "zwolnienie blokady", "blokada zwolniona", "hold released", "authorisation released", "authorization released",
                                    "due", "termin spłaty", "termin splaty", "statement", "wyciąg", "wyciag"]

  /// Words for money going out. They exist only to argue with `incomeWords`: a bank can name both
  /// directions in one message ("Acct XX123 debited with Rs 10 ... & Acct XX456 credited"), and
  /// without a debit list the stray "credited" would turn a payment into income.
  private static let debitWords = ["debited", "withdrawn", "withdrawal", "spent", "deducted", "charged", "purchase", "paid",
                                   "obciążen", "obciazen", "wypłat", "wyplat", "płatność", "platnosc", "zapłat", "zaplat",
                                   "списання", "оплата", "сплата", "покупка"]

  /// Which way the money went, by wording alone: whichever kind of word the bank reached for *first*.
  ///
  /// Banks lead with what happened and mention the other side afterwards, so the earlier word is the
  /// one the message is about. Reading it this way is what stops a second account's "credited" at the
  /// end of a sentence from overturning the "debited" at the front of it.
  static func direction(_ text: String) -> Int {
    let f = fold(text)
    let credit = incomeWords.compactMap { f.range(of: fold($0))?.lowerBound }.min()
    let debit = debitWords.compactMap { f.range(of: fold($0))?.lowerBound }.min()
    switch (credit, debit) {
    case (nil, _): return debit == nil ? 0 : -1
    case (_, nil): return 1
    case (let c?, let d?): return c < d ? 1 : -1
    }
  }

  // Both sides are folded: the text loses its accents, so a needle that keeps them ("wpływ") could
  // never match it. The lists still spell some words both ways, which is harmless once folded.
  static func isIncome(_ text: String) -> Bool { direction(text) > 0 }
  static func isIgnored(_ text: String) -> Bool { let f = fold(text); return ignoreWords.contains { f.contains(fold($0)) } }

  // MARK: - Small helpers

  /// This file stays free of the database layer so the harness can compile it on its own, so it
  /// keeps its own parser rather than borrowing `KPFormat`'s.
  private static let dayParser: DateFormatter = {
    let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = TimeZone.current; f.dateFormat = "yyyy-MM-dd"; return f
  }()

  /// Lower-cased, accent-free and **compatibility-normalised**: the last of those turns styled
  /// Unicode ("𝗌𝗉𝖾𝗇𝗍", "Ｒｓ") back into plain letters. Messages written that way are common enough in
  /// the wild — it is how spam dodges keyword filters — and without the mapping every word list here
  /// would look straight past them.
  static func fold(_ s: String) -> String {
    s.decomposedStringWithCompatibilityMapping.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: nil).lowercased()
  }

  private static func re(_ pattern: String, _ options: NSRegularExpression.Options = []) -> NSRegularExpression {
    try! NSRegularExpression(pattern: pattern, options: options)
  }
  private static func substring(_ s: String, _ r: NSRange) -> String? { Range(r, in: s).map { String(s[$0]) } }
  private static func first(_ rx: NSRegularExpression, _ s: String) -> String? {
    rx.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)).flatMap { substring(s, $0.range(at: 1)) }
  }
  /// Collapses the runs of spaces and newlines a notification body arrives with.
  private static func clean(_ s: String?) -> String? {
    guard let s else { return nil }
    let t = s.replacingOccurrences(of: #"[ \t\u{00A0}]+"#, with: " ", options: .regularExpression)
      .replacingOccurrences(of: #"\n{2,}"#, with: "\n", options: .regularExpression)
      .trimmingCharacters(in: .whitespacesAndNewlines)
    return t.isEmpty ? nil : t
  }
  private static func tidy(_ s: String) -> String? {
    let t = s.trimmingCharacters(in: CharacterSet(charactersIn: " .,;:-–\t")).trimmingCharacters(in: .whitespacesAndNewlines)
    return t.count >= 2 && t.rangeOfCharacter(from: .letters) != nil ? String(t.prefix(80)) : nil
  }
}
