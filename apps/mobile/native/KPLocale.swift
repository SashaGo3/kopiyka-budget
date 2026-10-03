import Foundation

/// The language every Swift surface speaks — the app's choice, not necessarily the phone's.
///
/// The messages themselves are generated (`KPStrings.swift`, typed accessors such as `L10n.Watch.title`,
/// over `Localizable.xcstrings`; both from packages/i18n by `bun run i18n`). This file is the lookup.
///
/// iOS picks an app's language once, at launch, from the phone (or Settings → Kopiyka → Language).
/// The app lets you choose inside it as well, so a plain `NSLocalizedString` would answer in the wrong
/// language. Instead the JS side stores its language in the App Group (`KPBridge.setLanguage`), the
/// watch receives it in its state file, and every lookup here goes to that language's `.lproj`.
///
/// What cannot follow: anything iOS renders itself from the bundle before or without the app — App
/// Intent titles in the Shortcuts app, permission prompts, the home-screen quick action. Those use the
/// system's choice for the app, which is why the in-app picker also points at Settings → Kopiyka.
///
/// This file is shared by every target: `targets/*/KPLocale.swift` are symlinks to it.
enum KPL {
  static let defaultsKey = "kp.language"
  static let source = "en"

  /// One instance for the process: creating a suite costs more than reading a key, and a key read
  /// still sees what another process (the app, while a widget or Siri reads) wrote since.
  private static let defaults = UserDefaults(suiteName: KP.appGroup)

  /// Remember the app's language. True when it changed, so the caller knows to redraw.
  @discardableResult
  static func store(_ code: String) -> Bool {
    guard let d = defaults, !code.isEmpty, d.string(forKey: defaultsKey) != code else { return false }
    d.set(code, forKey: defaultsKey)
    return true
  }

  /// The language chosen in the app, if it has told us one — what the phone passes on to the watch.
  static var chosen: String? { defaults?.string(forKey: defaultsKey) }

  /// The language in use: the app's choice when this bundle has it, else what iOS chose for the bundle.
  static var language: String {
    if let c = defaults?.string(forKey: defaultsKey), lproj(c) != nil { return c }
    return Bundle.main.preferredLocalizations.first ?? source
  }

  /// For dates and times: the app's language, but the phone's region and 24-hour setting — English
  /// on a phone set to Ukraine or the UK still writes "Fri 2 Oct" and "23:37", as the app does
  /// (en-GB), never the US "Fri, Oct 2" / "11:37 PM" a bare `Locale(identifier: "en")` would give.
  static var locale: Locale { locale(for: language) }

  /// For numbers in the words around them: only the language decides, like core `formatMinor`
  /// ("1 234.56" in English, "1 234,56" in Ukrainian), whatever the phone's region.
  static var numberLocale: Locale { Locale(identifier: language) }

  /// `Locale.current` with only the language swapped for `code`. When the phone already speaks it,
  /// `Locale.current` itself, which carries every preference the components cannot express.
  static func locale(for code: String) -> Locale {
    let current = Locale.current
    let wanted = Locale(identifier: code).language.languageCode
    if wanted == nil || current.language.languageCode == wanted { return current }
    var c = Locale.Components(locale: current)
    var language = Locale.Language.Components(identifier: code)
    // The region has to be part of the language ("en_UA"), not just a preference beside it: that is
    // what picks the date patterns. CLDR falls back sensibly (en_UA → en_001: "Fri, 2 Oct").
    if language.region == nil { language.region = current.language.region ?? current.region }
    c.languageComponents = language
    c.hourCycle = current.hourCycle
    return Locale(components: c)
  }

  /// Each language's `.lproj`, looked up once: every message goes through here.
  private static var lprojCache: [String: Bundle?] = [:]
  private static let lprojLock = NSLock()
  private static func lproj(_ code: String) -> Bundle? {
    lprojLock.lock(); defer { lprojLock.unlock() }
    if let b = lprojCache[code] { return b }
    let b = Bundle.main.path(forResource: code, ofType: "lproj").flatMap(Bundle.init(path:))
    lprojCache[code] = b
    return b
  }

  /// The message `key`, formatted with `args` for the current language. Falls back to English, then
  /// to the key itself — a missing translation shows English, never nothing.
  static func string(_ key: String, _ args: CVarArg...) -> String {
    let missing = "\u{0}"
    var format = (lproj(language) ?? Bundle.main).localizedString(forKey: key, value: missing, table: nil)
    if format == missing { format = (lproj(source) ?? Bundle.main).localizedString(forKey: key, value: key, table: nil) }
    // Always formatted, even without arguments: the catalogue escapes a literal % as %%.
    return String(format: format, locale: numberLocale, arguments: args)
  }
}

/// Ready-made category names, the Swift half of core `categoryName` (packages/core/src/presets.ts,
/// DATA.md rule 16). Swift reads the database itself — Siri, Shortcuts, the watch state — so it has to
/// apply the same rule: a row created from a preset (`categories.preset`) is shown in the app's
/// language for as long as its stored name is still one of that preset's own names, in any language.
/// The names are in the String Catalog under `preset.<key>.name`, like the app's.
/// The first account's default name ("Main") goes through here too, as `preset: "account"` (DATA.md
/// rule 17, core `accountName`).
enum KPPreset {
  private static func own(_ key: String) -> [String] {
    let missing = "\u{0}"
    return Bundle.main.localizations.filter { $0 != "Base" }.compactMap { code in
      guard let path = Bundle.main.path(forResource: code, ofType: "lproj"), let b = Bundle(path: path) else { return nil }
      let s = b.localizedString(forKey: key, value: missing, table: nil)
      return s == missing ? nil : s
    }
  }
  private static func norm(_ s: String) -> String { s.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }

  /// The name to show: the preset's, in the app's language, while unrenamed; otherwise as stored.
  static func name(_ stored: String, preset: String?) -> String {
    guard let p = preset, !p.isEmpty else { return stored }
    let key = "preset.\(p).name"
    guard own(key).contains(where: { norm($0) == norm(stored) }) else { return stored }
    let shown = KPL.string(key)
    return shown == key ? stored : shown
  }

  /// What the receipt reader matches against (core `categoryMatchText`): an untouched preset description
  /// is every language's keywords at once; an edited one is the user's own.
  static func matchText(_ stored: String?, preset: String?) -> String? {
    guard let d = stored, let p = preset, !p.isEmpty else { return stored }
    let all = own("preset.\(p).description")
    guard all.contains(where: { norm($0) == norm(d) }) else { return stored }
    return all.joined(separator: ", ")
  }
}
