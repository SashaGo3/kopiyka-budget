import Foundation

/// Runs `native/KPPaymentText.swift` on notification text without a device build. See README.md.

func describe(_ o: KPPaymentText.Outcome) -> String {
  switch o {
  case .ignored: return "IGNORED"
  case .unreadable: return "UNREADABLE (money named, no amount read)"
  case .payment(let p):
    var bits = [String(format: "%.2f", p.amount)]
    bits.append("cur=\(p.currency ?? "-")")
    bits.append("shop=\(p.merchant ?? "-")")
    if let c = p.place { bits.append("place=\(c)") }
    if let c = p.card { bits.append("card=\(c)") }
    if let c = p.ownAccount { bits.append("own=\(c)") }
    if let c = p.otherAccount { bits.append("other=\(c)") }
    if let c = p.sender { bits.append("sender=\(c)") }
    if let c = p.reference { bits.append("ref=\(c)") }
    if let b = p.balance { bits.append(String(format: "left=%.2f", b)) }
    if let d = p.date { bits.append("date=\(d)\(p.time.map { " \($0)" } ?? "")") }
    if p.income { bits.append("INCOME") }
    if p.hold { bits.append("HOLD") }
    return bits.joined(separator: " ")
  }
}

func show(_ label: String, _ o: KPPaymentText.Outcome) { print("· \(label)\n    \(describe(o))") }

/// What a sample is expected to come back as.
enum Want { case payment, ignored, unreadable }
func matches(_ o: KPPaymentText.Outcome, _ w: Want) -> Bool {
  switch (o, w) { case (.payment, .payment), (.ignored, .ignored), (.unreadable, .unreadable): return true; default: return false }
}

/// (label, title, subtitle, body, expected) — the shapes the parser is expected to handle.
let samples: [(String, String?, String?, String?, Want)] = [
  ("IKO card authorization", "Payment card authorization", nil,
   "Amount: 36,00 PLN.\nPlace: El Gato Coffeee Roaste, GDANSK.\nDate: 2026-09-09 10:39:09.", .payment),
  ("IKO Żabka", "Payment card authorization", nil,
   "Amount: 25,98 PLN.\nPlace: ZABKA ZE212 K.5, KATOWICE.\nDate: 2026-09-09 09:33:42.", .payment),
  ("IKO Polish", "Autoryzacja karty płatniczej", nil,
   "Kwota: 1 234,56 PLN.\nMiejsce: BIEDRONKA 4021, WARSZAWA.\nData: 09.09.2026 18:02:11.", .payment),
  ("Wallet · PKO", "PKO Bank Polski", "Glovo", "99,26 PLN", .payment),
  ("Wallet", "Apple Pay", "Starbucks", "$12.34", .payment),
  ("Wallet euro", "Visa ••4321", "Rossmann", "€8,90", .payment),
  ("Revolut", "Revolut", nil, "You spent £4.20 at Pret A Manger", .payment),
  ("Mono UAH", "Монобанк", nil, "Сума: 350,00 UAH\nМісце: SILPO, KYIV", .payment),
  ("Refund", "Payment card authorization", nil, "Amount: 36,00 PLN.\nPlace: ZWROT ZABKA, POZNAN.", .payment),
  ("Grouped thousands", "Bank", nil, "Amount: 1.234,56 PLN at IKEA", .payment),
  // An incoming transfer: the sender names the row, the balance line must not be mistaken for the
  // amount and must not make the whole notification look like a balance report.
  ("PKO transfer in", "Account credit", "+120,00 PLN Przelew na telefon - odebrany",
   "Sender Account: 52..0007\nSender: PETRENKO ANDRII\nTitle: ZVROT\nOn account no. 27..1946\nAvailable balance:+3184,20 PLN", .payment),
  ("Outgoing with a minus", "Bank", nil, "Amount: -36,00 PLN\nPlace: ZABKA, LODZ\nAvailable balance: 1 950,10 PLN", .payment),
  // The payment and the balance crowded onto one line: taking the balance out must not take the payment.
  ("Balance on the same line", "Bank", nil, "Amount: 36,00 PLN. Available balance: 1 200,00 PLN", .payment),
  // A dash is one of the separators an amount label may use, so it must not be read as a minus that
  // outranks the wording: this is a credit and has to stay one.
  ("Dash as the label separator", "Bank", nil, "Kwota - 100,00 PLN\nUznanie rachunku", .payment),
  // A bank that prints the purchase twice: the caller picks whichever matches the account (see `amounts`).
  ("Foreign purchase, both currencies", "Bank", nil, "Amount: 36,00 EUR (154,80 PLN)\nPlace: AMAZON", .payment),
  ("ATM withdrawal", "Bank", nil, "Wypłata z bankomatu 200,00 PLN\nMiejsce: BANKOMAT PKO, GDYNIA", .payment),
  // An online BLIK purchase: the bank names the method and then the shop. The shop is the shop.
  ("BLIK online", "Blocked balance", nil,
   "Amount: 1957,52 PLN.\nAccount no.:  27..5837\nLocation: BLIK INTERNET: FLYSTORE.PL\nAvailable balance: +8986,75 PLN", .payment),
  ("Cash paid in", "Bank", nil, "Wpłata 500,00 PLN na rachunek", .payment),
  ("Salary in", "Bank", nil, "Wynagrodzenie 8 000,00 PLN", .payment),
  ("Swiss apostrophe thousands", "Bank", nil, "CHF 1'234.56 at MIGROS", .payment),
  ("Rupees", "Bank", nil, "Rs. 1,234.56 debited at BIGBAZAAR", .payment),
  // Real notification text gathered from bank apps and open-source parser fixtures (2026-09-12).
  ("PKO/IKO, real wording", "PKO Bank Polski", nil,
   "Autoryzacja trans. karta 8215 Konto 10..6602 Kwota 500,00 PLN Stan konta +13984,70 PLN", .payment),
  ("Millennium ATM, masked PAN", "Bank Millennium", nil,
   "Debit Card Cash Withdrawal: Amount: -800,00 PLN Card: 402917******0638 Available balance: 8.204,55 PLN", .payment),
  ("Santander, incoming transfer", "Alerty24", nil, "wplyw na konto ...298650117 * 9 200,00 PLN od NORTHGATE", .payment),
  ("Sense Bank, transliterated", "Sense", nil, "Kartka 6210***0947 uspishna operaciya -27.00UAH Dostupno:19045.80UAH", .payment),
  ("ING Italia, currency spelled out", "ING", nil, "Operazione autorizzata: 98.25 euro, PAYPAL *PAG", .payment),
  ("US bank, negative balance after", "Huntington", nil, "A withdrawal: $20.00 at BC *UBER CASH. Acct CK0000 has a -$15.01 bal", .payment),
  ("Two accounts, two directions", "ICICI", nil, "Acct XX123 debited with Rs 10 on 12-Sep & Acct XX456 credited", .payment),
  ("Styled unicode", "SBI", nil, "Rs.90.00 𝗌𝗉𝖾𝗇𝗍 𝗈𝗇 𝗒𝗈𝗎𝗋 𝖲𝖡𝖨 𝖢𝗋𝖾𝖽𝗂𝗍 𝖢𝖺𝗋𝖽", .payment),
  // Spanish banks (invented names and numbers, the shapes of BBVA, Santander, CaixaBank, Sabadell, ING
  // and Revolut notifications).
  ("ES · BBVA card purchase", "BBVA", nil, "Compra con tarjeta ****1234 en MERCADONA por 23,45 €", .payment),
  ("ES · Santander card payment", "Santander", nil, "Pago con tarjeta terminada en 5678 de 12,34 EUR en ZARA ESPAÑA", .payment),
  ("ES · CaixaBank labelled", "CaixaBank", nil, "Compra: 45,90 EUR\nComercio: EL CORTE INGLES, MADRID\nTarjeta: ...9012", .payment),
  ("ES · Bizum received", "Bizum", nil, "Has recibido un Bizum de 20,00 € de MARIA LOPEZ. Concepto: Cena", .payment),
  ("ES · Bizum sent", "Bizum", nil, "Bizum enviado a JUAN PEREZ por 15,00 €", .payment),
  ("ES · transfer received", "Sabadell", nil, "Has recibido una transferencia de ANA GARCIA por 1.250,00 €. Saldo disponible: 3.410,22 €", .payment),
  ("ES · transfer sent", "ING", nil, "Transferencia emitida a favor de CARLOS RUIZ por 300,00 €\nCuenta destino: ES12 3456 7890 1234 5678 4321", .payment),
  ("ES · direct debit", "BBVA", nil, "Cargo en tu cuenta ...4455: 54,30 € RECIBO ENDESA ENERGIA", .payment),
  ("ES · salary", "Santander", nil, "Abono de nómina: 2.100,00 € en tu cuenta ****7788", .payment),
  ("ES · refund", "Revolut", nil, "Devolución de 18,99 € de AMAZON EU", .payment),
  ("ES · ATM", "CaixaBank", nil, "Reintegro en cajero 100,00 € con tarjeta ****3344", .payment),
  ("ES · Revolut spent", "Revolut", nil, "Has pagado 4,50 € en STARBUCKS", .payment),
  ("ES · declined", "BBVA", nil, "Operación denegada por saldo insuficiente. Importe: 60,00 €", .ignored),
  ("ES · balance only", "BBVA", nil, "Tu saldo disponible es de 1.234,56 €", .ignored),
  ("ES · upcoming bill", "Santander", nil, "Mañana se cargará el recibo de 39,99 € de VODAFONE", .ignored),
  ("ES · verification code", "CaixaBank", nil, "Tu código de verificación es 482913 para la compra de 80,00 €", .ignored),
  // Everything below must be passed over.
  ("PKO declined, real wording", "PKO", nil, "Nie udało się wykonać transakcji kartą *7391 Masz za mało środków. Kwota 120,00 PLN", .ignored),
  ("Monobank, insufficient funds", "Монобанк", nil, "Ашан На вашій картці недостатньо коштів 🚫 143.47₴", .ignored),
  ("PrivatBank refusal", "ПриватБанк", nil, "ВІДМОВА. Недостатньо коштів. Сплата 73.62UAH Бал. 9.63UAH", .ignored),
  ("Exchange rate advert", "Bank", nil, "Kurs walut EUR/PLN 4,25 — sprawdź w aplikacji", .ignored),
  ("New card is ready", "Bank", nil, "Twoja nowa karta jest gotowa. Limit 10 000,00 PLN", .ignored),
  ("One-time password", "Bank", nil, "Jednorazowy kod: 123456. Kwota 250,00 PLN", .ignored),
  ("Sign-in alert", "Bank", nil, "Zalogowano do serwisu o 12:03", .ignored),
  ("Instalment reminder", "Bank", nil, "Rata kredytu 500,00 PLN zostanie pobrana 15.09.2026", .ignored),
  ("Hold released", "Bank", nil, "Zwrot blokady 36,00 PLN, ZABKA", .ignored),
  // A standing order that has actually gone out is a payment, however scheduled it was.
  ("Standing order executed", "Bank", nil, "Zlecenie stałe zrealizowane: 1 200,00 PLN\nOdbiorca: WSPOLNOTA MIESZKANIOWA", .payment),
  ("Declined", "Payment card authorization", nil, "Amount: 36,00 PLN. Payment declined.", .ignored),
  ("Balance", "Your balance", nil, "Available balance: 1 200,00 PLN", .ignored),
  ("BLIK code", "IKO", nil, "Kod BLIK: 123456", .ignored),
  ("No number", "Wallet", "Starbucks", "Your card was added", .ignored),
  ("Bare number", "Delivery", nil, "Your order 483920 is on the way", .ignored),
  ("Date only", "Reminder", nil, "Meeting on 2026-09-09 at 10:39", .ignored),
  ("Empty", nil, nil, nil, .ignored),
  // Money is named but unreadable: the one case the automation reports back.
  ("Money without a number", "Bank", nil, "A payment in PLN was made on your card", .unreadable),
]

/// The whole Notification variable as one block of text — what the automation hands over now.
let blobs: [(String, String, Want)] = [
  ("Notification variable · transfer in", """
   Account credit
   +120,00 PLN Przelew na telefon - odebrany

   Sender Account: 52..0007
   Sender: PETRENKO ANDRII
   Title: ZVROT
   On account no. 27..1946
   Available balance:+3184,20 PLN
   """, .payment),
  ("Notification variable · Wallet", "PKO Bank Polski\nGlovo\n99,26 PLN", .payment),
  ("Notification variable · two lines", "Payment card authorization\nAmount: 36,00 PLN. Place: ZABKA, KRAKOW.", .payment),
  ("Notification variable · not a payment", "Instagram\nsomeone liked your photo", .ignored),
  // A hold: real money, not yet taken. Names a balance twice over — in its own title — and must
  // still be read as the purchase it is.
  ("Notification variable · blocked balance (hold)", """
   Blocked balance
   Amount: 1222,23 PLN.

   Account no.:  27..5837

   Location: BLIK INTERNET: WWW.SMYK.COM

   Available balance: +13109,11 PLN
   """, .payment),
  ("Notification variable · hold released is not a purchase", "Zwolnienie blokady\nKwota: 1222,23 PLN", .ignored),
  // One transfer between two of the user's own PKO accounts, told twice (names changed): the debit on
  // the USD account and the credit on the PLN one. The account numbers are what pairs them.
  ("Notification variable · own transfer, debit", """
   Obciążenie konta
   -500,00 USD Przelew z konta

   Konto odbiorcy: 27..5837

   Odbiorca: JAN KOWALSKI

   Tytuł: PRZELEW IKO NA NUMER RACHUNKU

   Na koncie: 84..3203

   Stan konta po transakcji:+3000,00 USD
   """, .payment),
  ("Notification variable · own transfer, credit", """
   Uznanie konta
   +1882,75 PLN Przelew na konto

   Konto nadawcy: 84..3203

   Nadawca: JAN KOWALSKI
   UL. PRZYKLADOWA 1 M.2 00-001
   WARSZAWA

   Tytuł: PRZELEW IKO NA NUMER RACHUNKU

   Na koncie: 27..5837

   Stan konta po transakcji: +2063,91 PLN
   """, .payment),
]

let args = Array(CommandLine.arguments.dropFirst())
if args.isEmpty || args[0] == "--samples" {
  var failures = 0
  for (label, t, s, b, expected) in samples {
    let got = KPPaymentText.read(title: t, subtitle: s, body: b)
    if !matches(got, expected) { failures += 1; print("FAIL (expected \(expected))") }
    show(label, got)
  }
  for (label, blob, expected) in blobs {
    let got = KPPaymentText.read(notification: blob)
    if !matches(got, expected) { failures += 1; print("FAIL (expected \(expected))") }
    show(label, got)
  }
  // The transfer in the screenshot, field by field: this is what the intent files it under.
  if case .payment(let p) = KPPaymentText.read(notification: blobs[0].1) {
    let checks: [(String, String?, String?)] = [
      ("amount", String(format: "%.2f", p.amount), "120.00"),
      ("currency", p.currency, "PLN"),
      ("payee", p.merchant, "PETRENKO ANDRII"),
      ("sender", p.sender, "PETRENKO ANDRII"),
      ("reference", p.reference, "ZVROT"),
      ("card", p.card, "••1946"),
      ("balance", p.balance.map { String(format: "%.2f", $0) }, "3184.20"),
      ("income", p.income ? "yes" : "no", "yes"),
    ]
    for (what, got, want) in checks where got != want {
      failures += 1; print("FAIL transfer \(what) → \(got ?? "-"), expected \(want ?? "-")")
    }
  } else { failures += 1; print("FAIL the transfer notification was not read as a payment") }
  // The two halves of one transfer: each names its own account and the other, which is what pairs them.
  func fields(_ blob: String) -> KPPaymentText.Parse? { if case .payment(let p) = KPPaymentText.read(notification: blob) { return p }; return nil }
  let legChecks: [(String, KPPaymentText.Parse?, [(String, String?)])] = [
    ("debit", fields(blobs.first { $0.0.hasSuffix("own transfer, debit") }!.1),
     [("amount", "500.00"), ("currency", "USD"), ("income", "no"), ("own", "3203"), ("other", "5837"), ("balance", "3000.00"), ("ref", "PRZELEW IKO NA NUMER RACHUNKU"), ("payee", "JAN KOWALSKI")]),
    ("credit", fields(blobs.first { $0.0.hasSuffix("own transfer, credit") }!.1),
     [("amount", "1882.75"), ("currency", "PLN"), ("income", "yes"), ("own", "5837"), ("other", "3203"), ("balance", "2063.91"), ("payee", "JAN KOWALSKI")]),
    ("PKO transfer in", fields(blobs[0].1), [("own", "1946"), ("other", "0007")]),
    ("ES transfer sent", KPPaymentText.parse(title: "ING", subtitle: nil, body: "Transferencia emitida a favor de CARLOS RUIZ por 300,00 €\nCuenta destino: ES12 3456 7890 1234 5678 4321"),
     [("amount", "300.00"), ("currency", "EUR"), ("income", "no"), ("other", "4321"), ("payee", "CARLOS RUIZ")]),
    ("ES Bizum received", KPPaymentText.parse(title: "Bizum", subtitle: nil, body: "Has recibido un Bizum de 20,00 € de MARIA LOPEZ. Concepto: Cena"),
     [("amount", "20.00"), ("income", "yes"), ("payee", "MARIA LOPEZ"), ("ref", "Cena")]),
    ("ES Bizum sent", KPPaymentText.parse(title: "Bizum", subtitle: nil, body: "Bizum enviado a JUAN PEREZ por 15,00 €"),
     [("amount", "15.00"), ("income", "no"), ("payee", "JUAN PEREZ")]),
    ("ES BBVA purchase", KPPaymentText.parse(title: "BBVA", subtitle: nil, body: "Compra con tarjeta ****1234 en MERCADONA por 23,45 €"),
     [("amount", "23.45"), ("currency", "EUR"), ("income", "no"), ("payee", "MERCADONA"), ("own", "1234")]),
    ("ES transfer received", KPPaymentText.parse(title: "Sabadell", subtitle: nil, body: "Has recibido una transferencia de ANA GARCIA por 1.250,00 €. Saldo disponible: 3.410,22 €"),
     [("amount", "1250.00"), ("income", "yes"), ("payee", "ANA GARCIA"), ("balance", "3410.22")]),
    ("ES salary", KPPaymentText.parse(title: "Santander", subtitle: nil, body: "Abono de nómina: 2.100,00 € en tu cuenta ****7788"), [("amount", "2100.00"), ("income", "yes"), ("own", "7788")]),
    ("ES direct debit", KPPaymentText.parse(title: "BBVA", subtitle: nil, body: "Cargo en tu cuenta ...4455: 54,30 € RECIBO ENDESA ENERGIA"), [("amount", "54.30"), ("income", "no"), ("own", "4455")]),
    ("ES refund", KPPaymentText.parse(title: "Revolut", subtitle: nil, body: "Devolución de 18,99 € de AMAZON EU"), [("amount", "18.99"), ("income", "yes"), ("payee", "AMAZON EU")]),
    ("ES Revolut spent", KPPaymentText.parse(title: "Revolut", subtitle: nil, body: "Has pagado 4,50 € en STARBUCKS"), [("amount", "4.50"), ("income", "no"), ("payee", "STARBUCKS")]),
  ]
  for (label, p, want) in legChecks {
    guard let p else { failures += 1; print("FAIL \(label): not read as a payment"); continue }
    for (what, expected) in want {
      let got: String?
      switch what {
      case "amount": got = String(format: "%.2f", p.amount)
      case "currency": got = p.currency
      case "income": got = p.income ? "yes" : "no"
      case "own": got = p.ownAccount
      case "other": got = p.otherAccount
      case "balance": got = p.balance.map { String(format: "%.2f", $0) }
      case "ref": got = p.reference
      case "payee": got = p.merchant
      default: got = nil
      }
      if got != expected { failures += 1; print("FAIL \(label) \(what) → \(got ?? "-"), expected \(expected ?? "-")") }
    }
  }
  // Pairing: one tap notified twice (Wallet, then the bank app) must merge; two different shops must not.
  let pairs: [(String, String?, String?, Bool)] = [
    ("Wallet + bank, same shop", "Glovo", "GLOVO*ORDER, WARSZAWA", true),
    ("Wallet has no shop", nil, "ZABKA ZE212 K.5", true),
    ("Different shops", "Glovo", "BIEDRONKA 4021", false),
    ("Same chain, other branch", "ZABKA ZE212 K.5", "ZABKA NANO 3087", false),
    ("Same shop, longer bank name", "El Gato Coffee", "El Gato Coffeee Roaste", true),
  ]
  // Unwrapping the payment method: a bank wraps the shop in how it was paid for, and the wrapper is
  // not a name. Everything before the colon has to be method words — a shop whose own name has a
  // colon in it keeps it, or the entry would be filed under half a name.
  let unwrapped: [(String, String)] = [
    ("BLIK INTERNET: FLYSTORE.PL", "FLYSTORE.PL"),
    ("Blik Internet: allegro.pl", "allegro.pl"),
    ("ZAKUP KARTA: ROSSMANN 123", "ROSSMANN 123"),
    ("PAYU: MEDIAEXPERT", "MEDIAEXPERT"),
    ("BLIK: ZAKUP: EMPIK", "EMPIK"),
    ("El Gato: Coffee Roasters", "El Gato: Coffee Roasters"),
    ("ZABKA ZE212 K.5", "ZABKA ZE212 K.5"),
    ("BLIK", "BLIK"),
    ("BLIK INTERNET: PL", "BLIK INTERNET: PL"),
  ]
  for (input, expected) in unwrapped {
    let got = KPPaymentText.unwrapMethod(input) ?? "-"
    if got != expected { failures += 1; print("FAIL unwrap \(input) → \(got), expected \(expected)") }
  }
  for (label, a, b, expected) in pairs {
    let got = KPPaymentText.sameMerchant(a, b)
    if got != expected { failures += 1; print("FAIL pairing (expected \(expected ? "merge" : "two entries"))") }
    print("· \(label)\n    \(a ?? "-") + \(b ?? "-") → \(got ? "merge" : "two entries")")
  }
  // The issuer name is an account hint only when the title names a bank, not an event.
  // Both figures are kept, so the intent can take the one already in the account's currency.
  if case .payment(let p) = KPPaymentText.read(title: "Bank", subtitle: nil, body: "Amount: 36,00 EUR (154,80 PLN)") {
    let byCurrency = Dictionary(uniqueKeysWithValues: p.amounts.compactMap { m in m.currency.map { ($0, m.value) } })
    if byCurrency["EUR"] != 36.00 || byCurrency["PLN"] != 154.80 {
      failures += 1; print("FAIL both currencies → \(p.amounts.map { "\($0.value) \($0.currency ?? "-")" })")
    }
  } else { failures += 1; print("FAIL both currencies: not read as a payment") }
  // A day the bank printed is used only if a payment could have happened on it.
  let fixed = KPPaymentText.dayValue("2026-09-12")
  let days: [(String, Bool)] = [("2026-09-12", true), ("2026-09-05", true), ("2026-09-13", false), ("2026-12-01", false), ("2026-01-01", false), ("nonsense", false)]
  for (day, expected) in days where KPPaymentText.isPlausibleDay(day, now: fixed) != expected {
    failures += 1; print("FAIL day \(day) → \(!expected), expected \(expected)")
  }
  // Direction: a "+" makes income of anything, a "-" never unmakes it, words decide the rest.
  let directions: [(String, String, Bool)] = [
    ("plus sign", "Account credit\n+120,00 PLN", true),
    ("minus sign", "Amount: -36,00 PLN at ZABKA", false),
    ("dash separator with credit wording", "Kwota - 100,00 PLN\nUznanie rachunku", true),
    ("no sign, no words", "Amount: 36,00 PLN at ZABKA", false),
    ("no sign, refund wording", "Amount: 36,00 PLN\nZwrot", true),
    ("cash paid in", "Wpłata 500,00 PLN na rachunek", true),
    ("salary", "Wynagrodzenie 8 000,00 PLN", true),
    ("ATM withdrawal is not income", "Wypłata z bankomatu 200,00 PLN", false),
    ("debited first, credited later", "Acct XX123 debited with Rs 10 & Acct XX456 credited", false),
    ("credited first, debited later", "Acct XX456 credited with Rs 10, debited from XX123", true),
    ("styled unicode is still spending", "Rs.90.00 𝗌𝗉𝖾𝗇𝗍 𝗈𝗇 𝗒𝗈𝗎𝗋 𝖢𝖺𝗋𝖽", false),
  ]
  for (label, text, expected) in directions {
    guard case .payment(let p) = KPPaymentText.read(notification: text) else { failures += 1; print("FAIL direction \(label): not read as a payment"); continue }
    if p.income != expected { failures += 1; print("FAIL direction \(label) → \(p.income ? "income" : "expense"), expected \(expected ? "income" : "expense")") }
  }
  let issuers: [(String, String?)] = [("PKO Bank Polski", "PKO Bank Polski"), ("Payment card authorization", nil), ("Apple Pay", "Apple Pay"), ("Autoryzacja karty płatniczej", nil)]
  for (title, expected) in issuers {
    let got = KPPaymentText.issuer(title)
    if got != expected { failures += 1; print("FAIL issuer \(title) → \(got ?? "-"), expected \(expected ?? "-")") }
  }
  let total = samples.count + blobs.count + pairs.count + issuers.count + directions.count + days.count + unwrapped.count + legChecks.reduce(0) { $0 + $1.2.count } + 9
  print(failures == 0 ? "\nall \(total) checks behaved as expected" : "\n\(failures) of \(total) checks went wrong")
  exit(failures == 0 ? 0 : 1)
}
// payment-parse "<whole notification>", or "<title>" "<subtitle>" "<message>" as three arguments.
if args.count == 1 { show("input", KPPaymentText.read(notification: args[0])) }
else { show("input", KPPaymentText.read(title: args[0], subtitle: args.count > 1 ? args[1] : nil, body: args.count > 2 ? args[2] : nil)) }
