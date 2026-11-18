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

// The same ZETO rows through the layout reader, which a NIEFISKALNY header now sends them to.
let zf = KPReceiptText.fiscal(lines: zeto)
check(KPReceiptText.isFiscal(zeto), true, "niefiskalny is the till layout")
check(zf?.total, 34.15, "zeto fiscal total")
check(zf?.items.map(\.price), [5.95, 13.2, 15.0], "zeto fiscal line totals")
check(zf?.items.map(\.name), ["Ser Żökty", "Jabłka", "Gruszki"], "zeto fiscal names")

// Real receipts sent in on 2026-11-17, as macOS Vision read them.
// A long name on a row of its own, its "1 SZT * 25,82 = 25,82 A" under it; "Sp.op.A" is the tax summary.
let herbal = [
  "Centrum Zielarsko-Medyczne", "Henryka Cromala", "Waryńskiego 4", "58-400 Kamienna Góra", "NIP: 6141328303", "nr dok.000006758",
  "PARAGON FISKALNY", "RATCWNIK - BALSAM DO SKORY | PIĘT | STOP", "1 SZT * 25,82 = 25,82 A", "Sp.op.A  25,82", "PTU A=23,00%  4,83",
  "SUMA PTU  4,83", "SUMA PLN  25,82", "ROZLICZENTE PERINOSCI", "ZAPŁACONO GOTOWKA PLN  25,82", "00002/0364 #01/KTEROWNIK 12.04.2025 10:39",
]
let h = KPReceiptText.fiscal(lines: herbal)
check(h?.total, 25.82, "herbal total")
check(h?.items, [.init(name: "Ratcwnik - Balsam Do Skory I Pięt I Stop", price: 25.82)], "herbal item from two rows")
check(h?.merchant, "Centrum Zielarsko-Medyczne", "herbal merchant")
check(h?.date, "2025-04-12", "herbal date")
check(KPReceiptText.address(in: herbal), "Waryńskiego 4, 58-400 Kamienna Góra", "street without ul.")

// The same receipt as the phone's reader saw it: "SZT" read as "SZI", the tax letter as "月".
let herbalPhone = [
  "Centrum Zielarsko-Medyczne", "Henryka Gromala", "Harynskiego 4", "58-400 Kamienna Gora", "NIP: 6141328303", "nr dok.000006758",
  "PARAGON FISKALNY", "RATCANIK - BALSAM DO SKORY I PIĘT I STOP", "1SZI*25,82 : 25,82月", "Sp.op.A  25,82", "PTU A=23,000%  4,83",
  "SUMA PTU  4,83", "SUMA PLN  25,82", "ROZL ICZENIE PŁAINOSCI", "ZAPŁACONO GOTOMKA PLN  25,82",
]
check(KPReceiptText.fiscal(lines: herbalPhone)?.items, [.init(name: "Ratcanik - Balsam Do Skory I Pięt I Stop", price: 25.82)], "herbal as the phone read it")
check(KPReceiptText.trailingPrice("1SZI*25,82 : 25,82月"), 25.82, "any letter after the price")

// Novitus, photographed off a screen: "*" read as "%" and as "k", a price split by a space.
let novitus = ["NOVITUS", "COMP SA ODDZIAL NOMY SACZ", "NOVITUS - CENTRUM TECHNOLOGTI SPRZEDAZY", "UL. NAHOJOWSKA 118, 33-300 NOMY SĄCZ",
  "NIP: 000-000-00-00", "27-07-2021 12:57  W000037", "PARAGON FISKALNY", "Ketchup 1.0%4.02  4.02A", "Pomidory 2.0*6.23  12.46A",
  "Sok winogronowy 1.0k3.45  3. 45A", "SP.OP.A: 19.93 PTU 232  3.73", "SuMa PTU:  3.73", "SUMA PLN  19.93"]
check(KPReceiptText.fiscal(lines: novitus)?.items, [.init(name: "Ketchup", price: 4.02), .init(name: "Pomidory", price: 12.46), .init(name: "Sok winogronowy", price: 3.45)], "novitus items")
check(KPReceiptText.lineTotal("Ketchup 1.0%4.02  4.02A"), nil, "a price's cents are not a quantity")
check(KPReceiptText.lineTotal("Ser 0.500kg*11.90"), 5.95, "a weighed line still multiplies")

// NIEFISKALNY, "1*31.21", "SUMA:  PLN 31.21".
let promes = [
  "PROMES S.C.", "ul. Bartnicza 13", "43-300 Bielsko-BiaŁa", "NIP: 5472143206  #000135", "## NIEFISKALNY ##",
  "paluszki 1*31.21  31.21D", "Sprzedaz opodatkowana D:  31.21", "Kwota PTU D 0%  0.00", "SUMA PTU  0.00",
  "SUMA:  PLN 31.21", "DO ZAPŁATY:  31.21", "ROZLICZENIE PŁATNOŚCI", "Gotówka:  31.21", "## NIEFISKALNY ##", "F15 # KO  19-01-2020 11:40",
]
let pr = KPReceiptText.fiscal(lines: promes)
check(pr?.total, 31.21, "promes total")
check(pr?.paid, nil, "promes paid equals total")
check(pr?.items, [.init(name: "Paluszki", price: 31.21)], "promes item")

// "WODA  1 * 3,00 = 3,00 Å": the tax letter read as Å, no header above the PARAGON line but a watermark.
let woda = ["E-PARAGON", "nr dok. 000000146", "PARAGON FISKALNY", "WODA  1 * 3,00 = 3,00 Å", "Sp. op.A  3,00", "PTU A=23,00%  0,56",
            "SUMA PTU  0,56", "SUMA PLN  3,00", "ROZLICZENIE PLATNOSCI", "ZAPLACONO GOTÓWKA PLN  3,00"]
let w = KPReceiptText.fiscal(lines: woda)
check(w?.total, 3.0, "woda total")
check(w?.items, [.init(name: "Woda", price: 3.0)], "woda item")
check(w?.merchant, "Receipt", "a watermark is not a shop")

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
check(KPReceiptText.lineTotal("1  ACTIMEL FRESA X14   6,49"), nil, "a pack size glued to a letter is not a quantity")
check(KPReceiptText.lineTotal("1  FUNDA PLA.C/M 43X   11,80"), nil, "a line with its own quantity column has no second one")
check(KPReceiptText.lineTotal("ACTIMEL FRESA X14 6,49"), nil, "X14 is a name, not 14 ×")
check(KPReceiptText.fixCase("OpoLe"), "Opole", "L inside a word")
check(KPReceiptText.fixCase("McDonald"), "McDonald", "real capitals stay")
check(KPReceiptText.fixCase("ŁÓDŹ"), "ŁÓDŹ", "all caps stay")

print(failures == 0 ? "OK" : "\(failures) failed")
exit(failures == 0 ? 0 : 1)
