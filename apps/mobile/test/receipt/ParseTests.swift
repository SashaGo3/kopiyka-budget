import Foundation

// Checks for native/KPReceiptParse.swift, run by test/receiptParse.test.ts (swiftc, macOS).
// The fixtures are OCR rows as Vision returned them, misreadings included.

var failures = 0
func check<T: Equatable>(_ got: T, _ want: T, _ what: String) {
  if got != want { failures += 1; print("FAIL \(what): got \(got), want \(want)") }
}

// ZETO Serwis, Opole: a non-fiscal receipt photographed slightly askew. The tax letters after the
// line totals were read as digits ("5.95B" → "5.958"), and "*" as "+", "#" or a space.
let zeto = [
  "ZETO Serwis", "ZETO Serwis", "ul. OLeska 7", "45-052 OpoLe", "NIP: 7453009977", "14-08-2018  H000156",
  "## NIEFISKALNY ##",
  "Ser Żökty 0.500kg 11.90  5.958", "JabŁka 3.000+4.40  13.200", "Gruszki 2.000kg#7.50  15.000",
  "RAZEM:  34.15.", "SP.OP.B: 5.95 PTU 8.002  0.44", "SP.OP.D: 28.20 PTU 5.00%  1.34", "SUMA PTU  1.78",
  "SUMA:  PLN 34.15", "## NIEFISKALNY ##", "F93 #1 .Katarzyna Buczek", "14-08-2018 09:14", "Gotówka:  34.15",
  "DZIĘKUJEMY I ZAPRASZAMY PONOWNIE",
]
let z = KPReceiptText.heuristic(lines: zeto)
check(z.merchant, "ZETO Serwis", "zeto merchant")
check(z.total, 34.15, "zeto total")
check(z.currency, "PLN", "zeto currency")
check(z.date, "2018-08-14", "zeto date")
check(z.items.map(\.price), [5.95, 13.2, 15.0], "zeto line totals, not unit prices")
check(z.items.map(\.name), ["Ser Żökty", "Jabłka", "Gruszki"], "zeto names, l restored")
check(KPReceiptText.address(in: zeto), "ul. Oleska 7, 45-052 Opole", "zeto address")

// A model that took the unit prices is corrected against the rows.
let fromModel = KPReceiptText.reconcile([.init(name: "Ser żółty", price: 11.9), .init(name: "Jabłka", price: 4.4), .init(name: "Gruszki", price: 15.0)], lines: zeto)
check(fromModel.map(\.price), [5.95, 13.2, 15.0], "reconciled model prices")

// Polish fiscal receipt: parsed by its layout.
let fiscal = [
  "Żabka Polska sp. z o.o.", "ul. Stanisława Matyi 8", "61-586 Poznań", "NIP 972-11-24-438", "2026-11-12  nr wydr.123",
  "PARAGON FISKALNY", "Kanapka z kurczakiem 1szt.*10,99 10,99A", "Woda niegazowana 1 x2,49 2,49B",
  "SPRZEDAŻ OPODATK. A 10,99", "PTU A 23,00% 2,06", "SUMA PTU 2,24", "SUMA PLN 13,48", "Karta 13,48",
]
check(KPReceiptText.isFiscal(fiscal), true, "fiscal detected")
let f = KPReceiptText.fiscal(lines: fiscal)
check(f?.total, 13.48, "fiscal total")
check(f?.items.map(\.price), [10.99, 2.49], "fiscal prices")
check(KPReceiptText.address(in: fiscal), "ul. Stanisława Matyi 8, 61-586 Poznań", "fiscal address")

// Ukrainian receipt head.
check(KPReceiptText.address(in: ["АТБ-маркет", "вул.Хрещатик 22", "01001 Київ", "ПН 123456789012", "Хліб 24,50"]), "вул. Хрещатик 22, 01001 Київ", "ukrainian address")
check(KPReceiptText.address(in: ["Shop", "Kasa 3", "Chleb 4,50"]), nil, "no address")

// Pieces.
check(KPReceiptText.trailingPrice("Ser 0.500kg 11.90  5.958"), 5.95, "tax letter read as a digit")
check(KPReceiptText.trailingPrice("Gruszki 15.00 D"), nil, "letter apart from the price is not part of it")
check(KPReceiptText.trailingPrice("Woda 2,49B"), 2.49, "tax letter")
check(KPReceiptText.lineTotal("Jabłka 3.000*4.40"), 13.2, "quantity × price")
check(KPReceiptText.lineTotal("Ser 0.500kg 11.90"), 5.95, "kg, space for ×")
check(KPReceiptText.lineTotal("Mleko 2 x 3,49"), 6.98, "count x price")
check(KPReceiptText.lineTotal("Chleb 4,50"), nil, "no quantity")
check(KPReceiptText.fixCase("OpoLe"), "Opole", "L inside a word")
check(KPReceiptText.fixCase("McDonald"), "McDonald", "real capitals stay")
check(KPReceiptText.fixCase("ŁÓDŹ"), "ŁÓDŹ", "all caps stay")

print(failures == 0 ? "OK" : "\(failures) failed")
exit(failures == 0 ? 0 : 1)
