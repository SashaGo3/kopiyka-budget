import UIKit
import ObjectiveC

/// The colour theme as a trait. Nothing reads its value: it only changes, once per theme switch, and
/// because it `affectsColorAppearance` UIKit treats that change the way it treats light ↔ dark —
/// every dynamic colour in the window is resolved again and every view that draws itself redraws.
struct KPThemeTrait: UITraitDefinition {
  static let defaultValue = 0
  static let affectsColorAppearance = true
  static let name = "KopiykaTheme"
  static let identifier = "dev.kopiyka.theme"
}

/// The app's theme colours, served to React Native by name (src/constants/theme.ts).
///
/// A theme switch used to re-mount every screen's content so its style sheets were rebuilt in the new
/// colours. Re-mounting under native navigators (stacks, tabs, form sheets) was the switch's weak
/// spot: now and then a screen came back empty. So nothing re-mounts any more. JS hands over every
/// colour of every theme once (`define`), styles name them (`PlatformColor("kp.label")`), and React
/// Native and Expo both look a name up through `+[UIColor colorNamed:]`, which this answers for
/// "kp." names with a dynamic colour that reads the *current* theme each time it is resolved. A
/// switch (`apply`) changes the current theme and makes UIKit resolve everything again.
///
/// Thread-safe: Fabric resolves colours on its own threads (to hash them) while the main thread draws.
enum KPThemeColors {
  private static let lock = NSLock()
  /// name → theme id → (light, dark).
  nonisolated(unsafe) private static var table: [String: [String: (light: UIColor, dark: UIColor)]] = [:]
  nonisolated(unsafe) private static var theme = ""
  /// One UIColor per name, handed out every time it is asked for.
  nonisolated(unsafe) private static var colors: [String: UIColor] = [:]
  nonisolated(unsafe) private static var generation = 0
  nonisolated(unsafe) private static var installed = false
  static let prefix = "kp."
  /// The theme a name falls back to when the current one has no entry for it.
  private static let fallbackTheme = "graphite"

  /// Add (or replace) colours: `[name: [themeId: [light, dark]]]`, each "#RRGGBB", "#RRGGBBAA" or
  /// "@systemName" (a UIKit system colour such as "@tertiarySystemFill"). False if anything was
  /// unreadable — JS then keeps drawing with plain colours.
  static func define(_ json: [String: [String: [String]]]) -> Bool {
    install()
    var ok = true
    var parsed: [String: [String: (light: UIColor, dark: UIColor)]] = [:]
    for (name, byTheme) in json {
      for (id, pair) in byTheme {
        guard pair.count == 2, let l = parse(pair[0]), let d = parse(pair[1]) else { ok = false; continue }
        parsed[name, default: [:]][id] = (l, d)
      }
    }
    lock.lock()
    for (name, byTheme) in parsed { table[name, default: [:]].merge(byTheme) { _, new in new } }
    lock.unlock()
    // The whole arrangement stands on `colorNamed:` answering for us: if it does not, say so, and JS
    // keeps plain colours rather than naming ones nothing would resolve (they would draw clear).
    if let probe = parsed.keys.first, UIColor(named: probe) == nil { return false }
    return ok
  }

  /// Make `id` the current theme; true when it was not already. Any thread.
  @discardableResult
  static func apply(_ id: String) -> Bool {
    lock.lock(); defer { lock.unlock() }
    let changed = theme != id
    theme = id
    return changed
  }

  /// After a switch: everything on screen (and every view a navigator holds off screen) resolves its
  /// colours again.
  @MainActor static func signal() {
    generation += 1
    for case let scene as UIWindowScene in UIApplication.shared.connectedScenes {
      scene.traitOverrides[KPThemeTrait.self] = generation
      for window in scene.windows { refresh(window) }
    }
  }

  static func named(_ name: String) -> UIColor? {
    guard name.hasPrefix(prefix) else { return nil }
    lock.lock(); defer { lock.unlock() }
    if let c = colors[name] { return c }
    guard table[name] != nil else { return nil }
    let c = UIColor { traits in resolve(name, traits) }
    colors[name] = c
    return c
  }

  private static func resolve(_ name: String, _ traits: UITraitCollection) -> UIColor {
    lock.lock()
    let entry = table[name]
    let pair = entry?[theme] ?? entry?[fallbackTheme] ?? entry?.values.first
    lock.unlock()
    guard let pair else { return .clear }
    let c = traits.userInterfaceStyle == .dark ? pair.dark : pair.light
    return c.resolvedColor(with: traits)
  }

  /// Belt and braces beside the trait: React Native's views re-read their layer colours only when the
  /// trait change counts as a colour change, and a view a navigator keeps off screen (a screen under
  /// the top of a stack, an unselected tab) is not in the window to hear it. So every view under every
  /// view controller is walked: its layer colours re-resolved, and anything that draws itself redrawn.
  @MainActor private static func refresh(_ window: UIWindow) {
    var seen = Set<ObjectIdentifier>()
    func walk(_ view: UIView) {
      guard seen.insert(ObjectIdentifier(view)).inserted else { return }
      // React Native's own views only: UIKit re-resolves its views itself, and a snapshot (the switch's
      // cover) must not be asked to redraw.
      if NSStringFromClass(type(of: view)).hasPrefix("RCT") {
        view.setNeedsDisplay()  // text (RCTParagraphTextView) draws itself
        if view.responds(to: invalidateLayer) { view.perform(invalidateLayer) }
      }
      for sub in view.subviews { walk(sub) }
    }
    func visit(_ vc: UIViewController) {
      if let v = vc.viewIfLoaded { walk(v) }
      for child in vc.children { visit(child) }
      if let presented = vc.presentedViewController, presented.presentingViewController === vc { visit(presented) }
    }
    walk(window)
    if let root = window.rootViewController { visit(root) }
  }
  private static let invalidateLayer = NSSelectorFromString("invalidateLayer")

  private static func parse(_ value: String) -> UIColor? {
    if value.hasPrefix("@") { return system(String(value.dropFirst())) }
    return KPThemeTransition.color(hex: value)
  }

  private static func system(_ name: String) -> UIColor? {
    let sel = NSSelectorFromString(name.hasSuffix("Color") ? name : "\(name)Color")
    guard UIColor.responds(to: sel) else { return nil }
    return UIColor.perform(sel).takeUnretainedValue() as? UIColor
  }

  /// `+[UIColor colorNamed:]` answers "kp." names first. Swapped once, before the first colour is defined.
  private static func install() {
    lock.lock(); defer { lock.unlock() }
    guard !installed else { return }
    installed = true
    let original = NSSelectorFromString("colorNamed:")
    let replacement = #selector(UIColor.kp_colorNamed(_:))
    guard let a = class_getClassMethod(UIColor.self, original), let b = class_getClassMethod(UIColor.self, replacement) else { return }
    method_exchangeImplementations(a, b)
  }
}

extension UIColor {
  /// After `install` this *is* `+colorNamed:`, and calling `kp_colorNamed` reaches the original.
  @objc class func kp_colorNamed(_ name: String) -> UIColor? {
    if let c = KPThemeColors.named(name) { return c }
    return kp_colorNamed(name)
  }
}
