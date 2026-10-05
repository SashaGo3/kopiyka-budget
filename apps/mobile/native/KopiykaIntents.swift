import AppIntents
import CoreLocation
import UIKit
import WidgetKit

// App Intents for Siri, Shortcuts, the Action button and Spotlight. Compiled into the
// app target (App Shortcuts must live in the app), so they run inside the app process
// and write straight into the shared database; JS refreshes through KPBridge.
//
// Flow the user asked for: amount → category → tags, ordered exactly like the app's pickers.

/// The place name the app writes when you log by hand (`src/lib/location.ts` `placeName`): the spot's
/// own name, else the street and its number, else the district or the city. Short, and never a country.
extension CLPlacemark {
  var kpPlaceName: String? {
    let named = (name != nil && name != thoroughfare) ? name : [thoroughfare, subThoroughfare].compactMap { $0 }.joined(separator: " ")
    return (named?.isEmpty == false ? named : nil) ?? subLocality ?? locality
  }
}

/// A dialog from text already in the app's language (`L10n`). Static metadata — titles, parameter
/// names, descriptions — names its key as a literal instead, which iOS resolves in the phone's language.
extension IntentDialog {
  static func text(_ s: String) -> IntentDialog { IntentDialog(.verbatim(s)) }
}

extension LocalizedStringResource {
  /// Finished text, shown as it is. There is no verbatim initialiser: `stringLiteral:` would treat the
  /// text as a key (and a message that happened to equal one would be swapped for it), so the text is
  /// the single argument of a "%@" looked up in a table that does not exist — which always falls back
  /// to that format.
  static func verbatim(_ s: String) -> LocalizedStringResource { LocalizedStringResource("\(s)", table: "KPVerbatim") }
}

enum KPKind: String, AppEnum {
  case expense, income
  static var typeDisplayRepresentation: TypeDisplayRepresentation = "native.intents.kind.type"
  static var caseDisplayRepresentations: [KPKind: DisplayRepresentation] = [.expense: "native.intents.kind.expense", .income: "native.intents.kind.income"]
}

// MARK: - Entities

struct KPAccountEntity: AppEntity {
  let id: String
  let name: String
  let currency: String
  static var typeDisplayRepresentation: TypeDisplayRepresentation = "native.intents.entity.account"
  static var defaultQuery = KPAccountQuery()
  var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(name)", subtitle: "\(currency)") }
  init(_ a: KPWatchState.Account) { id = a.id; name = a.name; currency = a.currency }
}

struct KPAccountQuery: EntityQuery {
  func entities(for identifiers: [String]) async throws -> [KPAccountEntity] {
    KPStore.buildState().accounts.filter { identifiers.contains($0.id) }.map(KPAccountEntity.init)
  }
  func suggestedEntities() async throws -> [KPAccountEntity] { KPStore.buildState().accounts.map(KPAccountEntity.init) }
  func defaultResult() async -> KPAccountEntity? { KPStore.buildState().defaultAccount.map(KPAccountEntity.init) }
}

struct KPCategoryEntity: AppEntity {
  let id: String
  let name: String
  let folder: String?
  static var typeDisplayRepresentation: TypeDisplayRepresentation = "native.intents.entity.category"
  static var defaultQuery = KPCategoryQuery()
  var displayRepresentation: DisplayRepresentation {
    DisplayRepresentation(title: "\(name)", subtitle: "\(folder ?? (id == KPCategoryEntity.noneId ? "" : L10n.Intents.folder))")
  }
  static let noneId = "none"
  /// Computed so its name is in the app's language at the time it is offered.
  static var none: KPCategoryEntity { KPCategoryEntity(id: noneId, name: L10n.Intents.noCategory, folder: nil) }
  init(id: String, name: String, folder: String?) { self.id = id; self.name = name; self.folder = folder }
  init(_ c: KPWatchState.Category) { id = c.id; name = c.name; folder = c.parent_name }
  /// nil for the "No category" choice.
  var categoryId: String? { id == KPCategoryEntity.noneId ? nil : id }
}

struct KPCategoryQuery: EntityStringQuery {
  func entities(for identifiers: [String]) async throws -> [KPCategoryEntity] {
    let cats = KPStore.categories().map(KPCategoryEntity.init) + [.none]
    return identifiers.compactMap { id in cats.first { $0.id == id } }
  }
  func entities(matching string: String) async throws -> [KPCategoryEntity] {
    let q = string.lowercased()
    return KPRank.categories(KPStore.categories(), kind: "expense").filter { $0.name.lowercased().contains(q) || ($0.parent_name?.lowercased().contains(q) ?? false) }.map(KPCategoryEntity.init)
  }
  func suggestedEntities() async throws -> [KPCategoryEntity] { KPRank.categories(KPStore.categories(), kind: "expense").map(KPCategoryEntity.init) }
}

/// Category choices ordered like the app (most used in the last 180 days first), for the chosen type.
struct KPCategoryOptions: DynamicOptionsProvider {
  @IntentParameterDependency<AddTransactionIntent>(\.$kind) var add
  func results() async throws -> [KPCategoryEntity] {
    KPRank.categories(KPStore.categories(), kind: add?.kind.rawValue ?? "expense").map(KPCategoryEntity.init) + [.none]
  }
}

struct KPTagEntity: AppEntity {
  let id: String
  let name: String
  static var typeDisplayRepresentation: TypeDisplayRepresentation = "native.intents.entity.tag"
  static var defaultQuery = KPTagQuery()
  var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(name)") }
  init(_ t: KPWatchState.Tag) { id = t.id; name = t.name }
  init(id: String, name: String) { self.id = id; self.name = name }
  /// Sentinel offered while asking for tags one by one.
  static let doneId = "done"
  static var done: KPTagEntity { KPTagEntity(id: doneId, name: L10n.Intents.noMoreTags) }
}

struct KPTagQuery: EntityStringQuery {
  func entities(for identifiers: [String]) async throws -> [KPTagEntity] {
    KPStore.tags().tags.filter { identifiers.contains($0.id) }.map(KPTagEntity.init) + (identifiers.contains(KPTagEntity.doneId) ? [.done] : [])
  }
  func entities(matching string: String) async throws -> [KPTagEntity] {
    let q = string.lowercased()
    return KPStore.tags().tags.filter { $0.name.lowercased().contains(q) }.map(KPTagEntity.init)
  }
  func suggestedEntities() async throws -> [KPTagEntity] {
    let (tags, together) = KPStore.tags()
    return KPRank.tags(tags, category: nil, categories: [], together: together).map { KPTagEntity($0.tag) }
  }
}

/// Tags ranked for the chosen category: assigned / used-together first, then the rest; tags for other categories hidden.
struct KPTagOptions: DynamicOptionsProvider {
  @IntentParameterDependency<AddTransactionIntent>(\.$category) var add
  func results() async throws -> [KPTagEntity] {
    let (tags, together) = KPStore.tags()
    let cats = KPStore.categories()
    let cat = add.flatMap { $0.category.categoryId }.flatMap { id in cats.first { $0.id == id } }
    return KPRank.tags(tags, category: cat, categories: cats, together: together).map { KPTagEntity($0.tag) }
  }
}

// MARK: - Intents

/// "Add expense": amount → category → tags. Works with the app closed (runs in the app process in the background).
struct AddTransactionIntent: AppIntent {
  static var title: LocalizedStringResource = "native.intents.add.title"
  static var description = IntentDescription("native.intents.add.description", categoryName: "native.intents.category.logging")
  static var openAppWhenRun = false

  @Parameter(title: "native.intents.param.amount", requestValueDialog: "native.intents.add.howMuch")
  var amount: Double

  @Parameter(title: "native.intents.param.type", default: .expense)
  var kind: KPKind

  @Parameter(title: "native.intents.param.category", optionsProvider: KPCategoryOptions())
  var category: KPCategoryEntity?

  @Parameter(title: "native.intents.param.tags", optionsProvider: KPTagOptions())
  var tags: [KPTagEntity]?

  @Parameter(title: "native.intents.param.account")
  var account: KPAccountEntity?

  @Parameter(title: "native.intents.param.note")
  var note: String?

  @Parameter(title: "native.intents.param.ask", default: true)
  var ask: Bool

  private func trimmed(_ s: String?) -> String? {
    let t = s?.trimmingCharacters(in: .whitespacesAndNewlines)
    return t?.isEmpty == false ? t : nil
  }

  static var parameterSummary: some ParameterSummary {
    Summary("Add \(\.$amount) \(\.$kind)") {
      \.$category
      \.$tags
      \.$account
      \.$note
      \.$ask
    }
  }

  func perform() async throws -> some IntentResult & ProvidesDialog {
    WatchBridge.shared.activate()
    let state = KPStore.buildState()
    guard let acc = account.flatMap({ a in state.accounts.first { $0.id == a.id } }) ?? state.defaultAccount else {
      return .result(dialog: .text(L10n.Intents.noAccounts))
    }
    guard amount > 0 else { throw $amount.needsValueError(.text(L10n.Intents.Add.howMuch)) }

    var chosen = category
    if chosen == nil && ask {
      let options = KPRank.categories(state.categories, kind: kind.rawValue).map(KPCategoryEntity.init) + [.none]
      if options.count > 1 { chosen = try await $category.requestDisambiguation(among: options, dialog: .text(L10n.Intents.whichCategory)) }
    }
    // An unattended shortcut ("Ask for category and tags" off) whose note the database has seen before
    // files itself: the category, tags and place of the last entry filed under that same name. Nothing
    // the shortcut supplied is overridden, and an answer the user gave to a prompt is never second-guessed.
    var history = KPStore.PayeeHistory.none
    if !ask, category == nil || tags == nil, let n = trimmed(note) {
      history = await KPStore.payeeHistory(payee: nil, note: n)
    }
    // An explicit category is used as given, "None" included; history only speaks when none was chosen.
    let cat = chosen != nil ? state.category(chosen?.categoryId) : state.category(history.categoryId)

    // Tags are picked one at a time (an entity array cannot be prompted for from perform),
    // each list ordered like the app's tag picker for this category.
    var chosenTags = tags ?? []
    if tags == nil && ask {
      var pool = KPRank.tags(state.tags, category: cat, categories: state.categories, together: state.together).map { KPTagEntity($0.tag) }
      while !pool.isEmpty {
        let pick = try await $tags.requestDisambiguation(among: [.done] + pool, dialog: .text(chosenTags.isEmpty ? L10n.Intents.anyTags : L10n.Intents.anotherTag))
        if pick.id == KPTagEntity.doneId { break }
        chosenTags.append(pick)
        pool.removeAll { $0.id == pick.id }
      }
    }
    if tags == nil, chosenTags.isEmpty { chosenTags = history.tagIds.compactMap { id in state.tags.first { $0.id == id } }.map(KPTagEntity.init) }

    let minor = KPFormat.minor(amount, acc.currency)
    let saved = await KPWrites.addTransaction(accountId: acc.id, amountMinor: kind == .expense ? -minor : minor, categoryId: cat?.id, tagIds: chosenTags.map(\.id),
                                              note: note, lat: history.lat, lon: history.lon, place: history.place, source: "siri")
    guard saved.ok else { return .result(dialog: .text(saved.error.map { L10n.Intents.saveFailedWhy(reason: $0) } ?? L10n.Intents.saveFailed)) }
    WidgetCenter.shared.reloadAllTimelines()
    NotificationCenter.default.post(name: KP.externalChange, object: nil)
    WatchBridge.shared.pushState()

    let money = KPFormat.money(amount, acc.currency)
    let toAccount = state.accounts.count > 1
    var said: String
    switch (cat, toAccount) {
    case (let c?, true): said = L10n.Intents.addedCategoryAccount(amount: money, category: c.name, account: acc.name)
    case (let c?, false): said = L10n.Intents.addedCategory(amount: money, category: c.name)
    case (nil, true): said = L10n.Intents.addedAccount(amount: money, account: acc.name)
    case (nil, false): said = L10n.Intents.added(amount: money)
    }
    if !chosenTags.isEmpty { said += " " + L10n.Intents.addedTags(tags: chosenTags.map { "#\($0.name)" }.joined(separator: " ")) }
    return .result(dialog: .text(said))
  }
}

/// "Scan receipt": a photo in (Shortcuts "Take Photo" feeds it), a pending expense out. Reads the
/// receipt with Vision and the on-device model (KPReceipt); saved straight away as *pending* so a
/// batch of receipts can be checked and confirmed together in the app (Transactions → Select → Confirm).
struct ScanReceiptIntent: AppIntent {
  static var title: LocalizedStringResource = "native.intents.scan.title"
  static var description = IntentDescription("native.intents.scan.description", categoryName: "native.intents.category.logging")
  static var openAppWhenRun = false

  @Parameter(title: "native.intents.param.photo", supportedContentTypes: [.image])
  var photo: IntentFile

  @Parameter(title: "native.intents.param.account")
  var account: KPAccountEntity?

  static var parameterSummary: some ParameterSummary {
    Summary("Scan \(\.$photo)") { \.$account }
  }

  func perform() async throws -> some IntentResult & ProvidesDialog {
    WatchBridge.shared.activate()
    let state = KPStore.buildState()
    guard let acc = account.flatMap({ a in state.accounts.first { $0.id == a.id } }) ?? state.defaultAccount else {
      return .result(dialog: .text(L10n.Intents.noAccounts))
    }
    guard let image = UIImage(data: photo.data) else { return .result(dialog: .text(L10n.Intents.notAPhoto)) }
    let parse: KPReceipt.Parse
    do { parse = try await KPReceipt.analyze(image: image) } catch { return .result(dialog: .text(error.localizedDescription)) }
    guard parse.total > 0 else { return .result(dialog: .text(L10n.Intents.noTotal)) }
    guard let saved = await KPReceipt.save(parse, account: (acc.id, acc.currency)) else { return .result(dialog: .text(L10n.Intents.saveFailed)) }
    WidgetCenter.shared.reloadAllTimelines()
    NotificationCenter.default.post(name: KP.externalChange, object: nil)
    WatchBridge.shared.pushState()
    let money = KPFormat.money(KPFormat.major(saved.amountMinor, acc.currency), acc.currency)
    var parts = [parse.category_name.map { L10n.Intents.scanSavedCategory(amount: money, merchant: parse.merchant, category: $0) }
                 ?? L10n.Intents.scanSaved(amount: money, merchant: parse.merchant)]
    if saved.converted, let rc = parse.currency { parts.append(L10n.Intents.scanOriginal(amount: KPFormat.money(parse.total, rc))) }
    parts.append(L10n.Intents.scanPending)
    return .result(dialog: .text(parts.joined(separator: " ")))
  }
}

/// Opens the app straight on the keypad: `kopiyka://log` is a React Native route (src/app/log.tsx)
/// that replaces itself with the app's own Log sheet, so Siri, the Action button and Shortcuts all
/// land in exactly the same UI as the "+" button.
struct OpenLogIntent: AppIntent {
  static var title: LocalizedStringResource = "native.intents.open.title"
  static var description = IntentDescription("native.intents.open.description", categoryName: "native.intents.category.logging")
  static var openAppWhenRun = true
  // `OpenURLIntent` refuses custom schemes ("URL scheme `kopiyka` is unsupported; launch is prohibited"),
  // so `openAppWhenRun` brings the app forward and the deep link is handed to React Native from
  // inside the app. Not with `UIApplication.open`: opening our own scheme makes iOS present the
  // whole app over itself, so running the shortcut with Kopiyka already open slid a second copy of
  // the app up as a modal card. See `KPQuickLog.deliver`.
  @MainActor
  func perform() async throws -> some IntentResult {
    KPQuickLog.deliver(KP.url("log"))
    return .result()
  }
}

/// What Shortcuts shows the user when the automation cannot do its job. Everything that works is
/// silent (see `LogPaymentIntent`), so an error is the only thing this automation ever says.
struct KPIntentError: Error, CustomLocalizedStringResourceConvertible {
  let message: String
  init(_ message: String) { self.message = message }
  var localizedStringResource: LocalizedStringResource { .verbatim(message) }
}

/// "Log payment from an app notification": the action a Shortcuts automation runs when the bank
/// tells you about a payment.
///
/// iOS shares no Wallet transaction API with apps, and on iOS 26+ the old **Transaction** trigger is
/// gone, so the route is the **"When I receive a notification"** automation. It offers the whole
/// notification as one variable, which is what `notification` below takes; the separate Title,
/// Subtitle and Message fields are still accepted for automations built the old way. `KPPaymentText`
/// turns the text into an amount, a shop, a sender, a card and a time. Settings → Automate with
/// Shortcut explains the setup.
///
/// It runs **silently**. An automation fires on notifications all day and a banner after each one is
/// worse than no automation at all, so:
/// * a notification that is not about a payment is passed over without a word — that is most of them;
/// * a charge already sitting there pending is passed over too (Wallet and the bank app both notify
///   the same tap, and iOS re-delivers notifications);
/// * the user hears from it only when something is actually wrong: money is named and the reader
///   could not make sense of it, there is no account to log to, or the write failed.
///
/// What it files admits how sure it is. A payment this database has seen before, filed by hand, hands
/// its category, tags and place on and is logged outright — that filing is a decision already made.
/// Anything else is *pending*, and there the category may be a guess from the words of the shop's
/// name, or from the categories used near here: better than a blank, because a row that is nearly
/// right is quicker to confirm than an empty one, but recorded as a guess (`source` =
/// "shortcut-guess") so the Pending queue can say which categories nobody has agreed to yet. A guess
/// never skips the queue.
///
/// Where you paid is optional and comes from the automation, not from here: Shortcuts' own "Get
/// Current Location" action runs before this one and its result goes into `location`. The intent
/// itself never asks for a fix — it runs in the background off a notification, where Kopiyka's
/// when-in-use permission grants nothing.
struct LogPaymentIntent: AppIntent {
  static var title: LocalizedStringResource = "native.intents.payment.title"
  static var description = IntentDescription("native.intents.payment.description", categoryName: "native.intents.category.logging")
  static var openAppWhenRun = false

  @Parameter(title: "native.intents.param.notification")
  var notification: String?

  @Parameter(title: "native.intents.param.title")
  var alertTitle: String?

  @Parameter(title: "native.intents.param.subtitle")
  var alertSubtitle: String?

  @Parameter(title: "native.intents.param.body")
  var alertBody: String?

  @Parameter(title: "native.intents.param.amount")
  var amount: Double?

  @Parameter(title: "native.intents.param.merchant")
  var merchant: String?

  @Parameter(title: "native.intents.param.card")
  var card: String?

  @Parameter(title: "native.intents.param.account")
  var account: KPAccountEntity?

  /// Where the phone is, handed over by the automation. The intent never takes a fix of its own: it
  /// runs in the background on a notification, where when-in-use permission buys nothing, and a
  /// location request there would either hang or come back empty. Shortcuts' own "Get Current
  /// Location" action runs in the foreground of the automation and can, so it does the asking.
  @Parameter(title: "native.intents.param.location", description: "native.intents.param.locationHelp")
  var location: CLPlacemark?

  @Parameter(title: "native.intents.param.pending", default: true)
  var pending: Bool

  static var parameterSummary: some ParameterSummary {
    Summary("Log the payment in \(\.$notification)") {
      \.$alertTitle
      \.$alertSubtitle
      \.$alertBody
      \.$amount
      \.$merchant
      \.$card
      \.$account
      \.$location
      \.$pending
    }
  }

  /// The coordinate Shortcuts passed, if it passed a usable one — (0, 0) is what an empty or refused
  /// "Get Current Location" leaves behind, and it is in the Gulf of Guinea, not where anybody shops.
  private var fix: CLLocationCoordinate2D? {
    guard let c = location?.location?.coordinate, CLLocationCoordinate2DIsValid(c), c.latitude != 0 || c.longitude != 0 else { return nil }
    return c
  }

  func perform() async throws -> some IntentResult {
    // The whole notification when the automation passes it (the way the guide describes), the three
    // separate fields when it was built before that existed.
    let outcome = trimmed(notification).map { KPPaymentText.read(notification: $0) }
      ?? KPPaymentText.read(title: alertTitle, subtitle: alertSubtitle, body: alertBody)
    // The notification as it arrived, kept for the log: the only way to fix a bank whose wording the
    // reader does not know yet is to still have the wording afterwards.
    let raw = trimmed(notification) ?? [alertTitle, alertSubtitle, alertBody].compactMap { trimmed($0) }.joined(separator: " · ")
    var parsed: KPPaymentText.Parse? = nil
    if case .payment(let p) = outcome { parsed = p }
    // A mapped Amount (the old Transaction automation) beats the text; without either there is
    // nothing to log, and whether that is worth a word depends on what the text was.
    let value = amount.map(abs).flatMap { $0 > 0 ? $0 : nil } ?? parsed?.amount
    guard let value else {
      if case .unreadable = outcome {
        KPParseLog.record(.unreadable, text: raw, note: "money named, no amount read")
        throw KPIntentError(L10n.Intents.Payment.unreadable)
      }
      KPParseLog.record(.ignored, text: raw, note: "no amount, or money the bank is not charging")
      return .result()   // not a payment: the ordinary outcome, and it says nothing
    }

    // Just the accounts, not `buildState()`: that also scans every transaction for tags, categories
    // and history, which this automation cannot afford (see the round-trip budgets below).
    let (accounts, currentAccount) = KPStore.accountList()
    guard let acc = resolveAccount(accounts, current: currentAccount, parsed: parsed) else {
      KPParseLog.record(.failed, text: raw, parse: parsed, note: "no account to put it on")
      throw KPIntentError(L10n.Intents.Payment.noAccounts)
    }

    let shop = trimmed(merchant) ?? parsed?.merchant
    // A bank that prints the purchase twice — "36,00 EUR (154,80 PLN)" — has already converted it on
    // the terms it actually charged, and its own figure beats anything a cached rate could
    // reconstruct. So when one of the sums it named is in the account's own currency, that is the one.
    var paid = value, paidCurrency = parsed?.currency
    if amount == nil, let native = parsed?.amounts.first(where: { $0.currency == acc.currency }) {
      paid = native.value; paidCurrency = native.currency
    }
    // Otherwise the bank printed its own currency and the account is in another one. `resolveAccount`
    // has already tried to avoid this by picking an account held in that currency, so reaching here
    // means there was none and the number has to be converted — or, with no rate to convert by, left
    // for the user. Either way what the bank actually charged is kept in the cross-currency columns,
    // so the row shows "1 200,00 UAH" beside whatever it ended up as and can be checked.
    var charged = paid, currencyNote: String? = nil, converted = false
    var enteredMinor: Int? = nil, enteredCurrency: String? = nil, usedRate: Double? = nil
    if let from = paidCurrency, from != acc.currency {
      converted = true
      enteredMinor = KPFormat.minor(paid, from) * (parsed?.income == true ? 1 : -1)
      enteredCurrency = from
      if let rate = KPStore.cachedRate(from: from, to: acc.currency) {
        charged = paid * rate
        usedRate = rate
      } else {
        // No rate has ever been cached for this pair, so any number in the account's currency would
        // be invented. Zero is the one honest answer: the row cannot be confirmed until an amount is
        // typed (the sheet's Save stays disabled at zero), and it cannot quietly distort a total in
        // the meantime — which writing the foreign number as if it were the account's currency did.
        charged = 0
        currencyNote = L10n.Intents.Payment.noRate(amount: KPFormat.money(paid, from))
      }
    }
    let minor = KPFormat.minor(charged, acc.currency)
    let income = parsed?.income ?? false

    // Without a shop the notification's own text is the name, and it is what the note below will hold.
    let noteKey = shop == nil ? parsed?.text : nil
    // "When I receive a notification" gives Shortcuts a hard wall-clock budget — seconds, not the
    // ~10s a user-facing intent can spend waiting on the app. So the two round-trips to JS below are
    // capped well under KPWrites' own defaults (3s / 8s): a card charge that misses the budget is
    // better logged late by hand than reported to the user as a failed shortcut.
    let ctx = await KPStore.paymentContext(accountId: acc.id, amountMinor: income ? minor : -minor, payee: shop, note: noteKey, timeout: 1.5)
    let history = ctx.history
    // Two very different kinds of category, and the difference is the whole point.
    //
    // History is a decision the user already made about this exact name, so it is used as it stands
    // and the entry skips the pending queue. A guess from the words of the shop's name is not a
    // decision — it is better than a blank, because a row that is nearly right is quicker to confirm
    // than one that is empty, but it is only ever offered *pending* and marked as a guess
    // (`source`), so the queue can say out loud which categories nobody has agreed to yet.
    var categoryId = history.categoryId
    // A category from history is a guess unless history recognised this exact name. The first-word
    // rule ("ZABKA ZE212 K.5" finding "ZABKA NANO 3087") also makes "BLIK INTERNET: FLYSTORE.PL"
    // look like every other online BLIK payment, so what it offers is worth a category and not the
    // right to skip the queue.
    var guessed = categoryId != nil && !history.trusted
    if categoryId == nil, let s = shop, let hit = LogPaymentIntent.matchCategory(s, KPStore.categoryRefs()) {
      categoryId = hit.id
      guessed = true
    }
    // Still nothing, and the automation passed a location: the category used near here, exactly as
    // the entry sheet and the watch offer it. Also only a guess — the same spot sells lunch and
    // stationery — so it lands pending and marked, and it is asked for last because it is the one
    // question that may cost a round-trip to the app (op "suggest"; the word match is in-process).
    if categoryId == nil, let fix {
      categoryId = await KPStore.suggestCategoryNear(lat: fix.latitude, lon: fix.longitude, place: location?.kpPlaceName, timeout: 1.5)
      guessed = categoryId != nil
    }
    // Where the payment happened: the fix the automation handed over, else what the shop's history
    // remembers. Both halves come from the same source, so a point and a name never disagree.
    let lat = fix?.latitude ?? history.lat
    let lon = fix?.longitude ?? history.lon
    // Where you were, not where the bank says the shop is registered. The fix the automation passed
    // (its Location parameter), else where this shop was last seen — both of which have a point
    // behind them. The town printed on the notification is *not* a location: a card used abroad, or
    // an online order, prints a town the phone was nowhere near, and writing it here would put the
    // purchase on the map in the wrong country. It goes in the note instead, where it belongs — it
    // is something the bank told you about the purchase, like the shop's name.
    // Only read a name off a placemark that also carried a usable point, so a name always has one.
    let place = (fix == nil ? nil : location?.kpPlaceName) ?? history.place
    // History has filed this name by hand before, so the entry is already understood and skips the
    // pending queue — unless the amount had to be converted, because then the number itself is an
    // estimate and wants a pair of eyes; or unless this shop has been filed more than one way
    // (fuel one week, a hot dog the next), because then the last filing is not a decision about
    // this payment and the entry sheet has to ask which of them it was.
    //
    // A hold is deliberately *not* one of these. Every card payment is an authorisation until the
    // bank settles it — for some banks every notification says so in as many words — so treating one
    // as unsettled would put every payment back in the queue and undo the whole point of history
    // filling a shop in. "Pending" already means exactly "not final yet".
    // Where this shop was last seen, against where the phone says you are. A name filed before in
    // another town is not this payment's shop, whatever it is called — so it fills the entry in and
    // the entry still waits to be looked at.
    var movedTown = false
    if let fix, let hlat = history.lat, let hlon = history.lon {
      movedTown = KPStore.distanceMeters(fix.latitude, fix.longitude, hlat, hlon) > KPStore.samePlaceRadiusM
    }
    // A notification that names the account on the other end is a transfer, or half of one: it waits
    // in the queue whatever history knows about the name, so its other half can still pair with it
    // (core transferPair.ts only pairs what is pending) and a person sees it before it counts.
    let transferLike = parsed?.otherAccount != nil
    let known = history.trusted && !converted && !history.ambiguous && !movedTown && !transferLike

    // The same amount on the same account, minutes ago, from a shop whose name is compatible: one tap,
    // two notifications (Wallet's and the bank app's), or iOS re-delivering one. Never a second entry.
    if let twin = ctx.twin, KPPaymentText.sameMerchant(twin.payee, shop) {
      // A charge that has already been confirmed is left exactly as it is. One still waiting in the
      // queue takes whatever this notification knows and it does not (Wallet has the tidy shop name,
      // the bank app the city), and leaves the queue as well when history recognises the shop.
      if twin.pending {
        // The location included: `fillIn` only ever writes a column that is still empty, so the
        // second notification can give a payment the place the first one had no location for, and
        // can never move one that already knows where it happened.
        _ = await KPWrites.fillIn(id: twin.id, payee: shop, place: place, categoryId: categoryId,
                                  tagIds: history.tagIds, lat: lat, lon: lon, confirm: known, timeout: 4)
        NotificationCenter.default.post(name: KP.externalChange, object: nil)
      }
      return .result()
    }

    // What the payer called the transfer names it; without that, a shop names it on its own and
    // without either the notification itself has to.
    // "Place: CYBEX, BAYREUTH." — the shop and the town as the bank printed them. Kept together, so
    // the row is named after the purchase rather than after a town on its own.
    var printedPlace: String? = nil
    if let town = parsed?.place { printedPlace = [shop, town].compactMap { $0 }.joined(separator: ", ") }
    let note = [parsed?.reference, printedPlace, shop == nil ? parsed?.text : nil, currencyNote].compactMap { $0 }.joined(separator: " · ")
    // The bank's own timestamp, so a notification that arrives late still lands on the right day.
    // Only a day a payment could actually have happened on: a notification about something scheduled
    // would otherwise file the entry in the future, where it sits invisible until the day comes.
    var date: String? = nil
    if let p = parsed, let day = p.date, KPPaymentText.isPlausibleDay(day) { date = "\(day)T\(p.time ?? "12:00:00")\(KPStore.isoNow().suffix(6))" }
    // The location the automation passed, else the city from the notification and wherever this shop
    // was the last time it was logged (see `lat` / `lon` / `place` above).
    // The id is minted here rather than inside `addTransaction`, because the notification below has
    // to link to this exact row and there is no second way to find it afterwards.
    let rowId = UUID().uuidString.lowercased()
    // The account numbers the bank printed, and the balance after: how the debit and the credit of one
    // transfer between your own accounts find each other once the app reads them.
    let bank = KPBankRef(own: parsed?.ownAccount, other: parsed?.otherAccount,
                         balanceMinor: parsed?.balance.map { KPFormat.minor($0, parsed?.currency ?? acc.currency) })
    let saved = await KPWrites.addTransaction(id: rowId, accountId: acc.id, amountMinor: income ? minor : -minor, categoryId: categoryId, tagIds: history.tagIds,
                                              note: note.isEmpty ? nil : note, payee: shop, lat: lat, lon: lon,
                                              place: place, pending: pending && !known, date: date,
                                              source: guessed ? "shortcut-guess" : "shortcut",
                                              enteredMinor: enteredMinor, enteredCurrency: enteredCurrency, rate: usedRate, bank: bank, timeout: 4)
    guard saved.ok else {
      KPParseLog.record(.failed, text: raw, parse: parsed, account: acc.name, note: saved.error ?? "the app refused the write")
      throw KPIntentError(saved.error.map { L10n.Intents.Payment.saveFailedWhy(reason: $0) } ?? L10n.Intents.Payment.saveFailed)
    }

    // Say so, unless the user has turned it off. The automation runs with the app closed and used to
    // be silent by design; what that actually bought was purchases turning up in a list days later.
    // One notification, replacing the last one it posted (KPNotify), naming what was filed and how
    // sure it is — a guess and a pending row are exactly what wants a second pair of eyes.
    if KPStore.meta("shortcut_notify") != "0" {
      let name = categoryId.flatMap { id in KPStore.categories().first { $0.id == id }?.name }
      let marks = [name, guessed ? L10n.Notify.guess : nil, pending && !known ? L10n.Notify.pending : nil].compactMap { $0 }
      // `money` already ends in the currency code.
      let body = ([KPFormat.money(abs(KPFormat.major(minor, acc.currency)), acc.currency), acc.name] + marks).joined(separator: " · ")
      await KPNotify.payment(id: rowId,
                             title: shop ?? (income ? L10n.Notify.received : L10n.Notify.logged),
                             body: body,
                             badge: saved.reply["pending"] as? Int ?? KPStore.pendingCount())
    }
    WidgetCenter.shared.reloadAllTimelines()
    NotificationCenter.default.post(name: KP.externalChange, object: nil)
    // Off the critical path: the watch update is pure side work the shortcut's own result does not
    // depend on, and `buildState()` (inside `pushState`) is exactly the expensive scan this whole
    // change is trying to keep out of Shortcuts' timeout — so it runs after the result is already on
    // its way back.
    Task.detached(priority: .utility) { WatchBridge.shared.pushState() }
    return .result()
  }

  private func trimmed(_ s: String?) -> String? {
    let t = s?.trimmingCharacters(in: .whitespacesAndNewlines)
    return t?.isEmpty == false ? t : nil
  }

  /// Explicit account → an account named like the card → an account held in the currency the bank
  /// printed → the current account.
  ///
  /// The currency step is what keeps a foreign charge off the home account: a notification in EUR
  /// belongs on the EUR account if there is one, and then no exchange rate has to be guessed at.
  private func resolveAccount(_ accounts: [KPWatchState.Account], current: String, parsed: KPPaymentText.Parse?) -> KPWatchState.Account? {
    if let a = account.flatMap({ a in accounts.first { $0.id == a.id } }) { return a }
    // The digits the bank prints for the account, once an approval has taught them (DATA.md rule 18).
    if let own = parsed?.ownAccount, let hit = LogPaymentIntent.matchNumber(own, accounts) { return hit }
    if let hit = LogPaymentIntent.matchCard(trimmed(card) ?? parsed?.card, accounts) { return hit }
    // Every currency the text named, not only the winning amount's: "36,00 EUR (154,80 PLN)" names
    // both, and the one the money really moved in is whichever the user actually holds. Two matches
    // would be a guess between them, so that falls through to the usual account instead.
    let named = ([parsed?.currency] + (parsed?.amounts.map(\.currency) ?? [])).compactMap { $0 }
    let held = accounts.filter { named.contains($0.currency) }
    if !held.isEmpty, Set(held.map(\.currency)).count == 1 {
      // The usual account first, so a second PLN account does not steal every PLN payment.
      if let d = KPStore.defaultAccount(accounts, current: current), held.contains(where: { $0.id == d.id }) { return d }
      return held[0]
    }
    return KPStore.defaultAccount(accounts, current: current)
  }

  /// Best-effort merchant → category: a word of the category name or its description that appears in
  /// the merchant name. The longest match wins, then the most used category. nil when nothing fits.
  ///
  /// Only ever a *pending* suggestion (see `perform`), never a filed decision, and folders are not
  /// among the candidates — `KPStore.categoryRefs()` leaves them out, which is what stopped this from
  /// filing payments into "Food" itself instead of "Groceries".
  static func matchCategory(_ merchant: String, _ refs: [KPCategoryRef]) -> KPCategoryRef? {
    let haystack = merchant.lowercased()
    guard !haystack.isEmpty else { return nil }
    var best: (ref: KPCategoryRef, length: Int)?
    for ref in refs {
      let words = ([ref.name] + (ref.description.map { [$0] } ?? []))
        .flatMap { $0.lowercased().split(whereSeparator: { !$0.isLetter && !$0.isNumber }) }
        .map(String.init).filter { $0.count >= 4 }
      guard let hit = words.filter({ haystack.contains($0) }).max(by: { $0.count < $1.count }) else { continue }
      if best == nil || hit.count > best!.length || (hit.count == best!.length && ref.uses > best!.ref.uses) { best = (ref, hit.count) }
    }
    return best?.ref
  }

  /// The one account known by these four digits; nil when none is, or more than one claims them.
  static func matchNumber(_ digits: String, _ accounts: [KPWatchState.Account]) -> KPWatchState.Account? {
    let hits = accounts.filter { ($0.numbers ?? []).contains(digits) }
    return hits.count == 1 ? hits[0] : nil
  }

  /// An account named after the card the notification names: either name containing the other, or
  /// both ending in the same four digits ("••1946" against "Millennium 1946").
  static func matchCard(_ hint: String?, _ accounts: [KPWatchState.Account]) -> KPWatchState.Account? {
    let name = (hint ?? "").lowercased()
    guard !name.isEmpty else { return nil }
    if let hit = accounts.first(where: { $0.name.lowercased().contains(name) || name.contains($0.name.lowercased()) }) { return hit }
    let last4 = String(name.filter(\.isNumber).suffix(4))
    guard last4.count == 4 else { return nil }
    return accounts.first { $0.name.filter(\.isNumber).hasSuffix(last4) }
  }
}

struct KopiykaShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(intent: AddTransactionIntent(),
                phrases: ["Add expense in \(.applicationName)", "Log expense in \(.applicationName)", "Add a transaction in \(.applicationName)"],
                shortTitle: "native.intents.shortcut.addExpense", systemImageName: "plus.circle")
    AppShortcut(intent: OpenLogIntent(), phrases: ["New expense in \(.applicationName)", "Open \(.applicationName) expense"], shortTitle: "native.intents.shortcut.expenseInApp", systemImageName: "square.and.pencil")
    AppShortcut(intent: ScanReceiptIntent(), phrases: ["Scan receipt in \(.applicationName)", "Scan a receipt with \(.applicationName)"], shortTitle: "native.intents.shortcut.scanReceipt", systemImageName: "doc.text.viewfinder")
    AppShortcut(intent: LogPaymentIntent(), phrases: ["Log a payment in \(.applicationName)", "Log card payment in \(.applicationName)"], shortTitle: "native.intents.shortcut.logPayment", systemImageName: "creditcard")
  }
}
