import SwiftUI
import AppIntents

@main
struct KopiykaWatchApp: App {
  @StateObject private var session = WatchSession.shared
  @StateObject private var nav = WatchNav.shared
  @StateObject private var draft = WatchDraft.shared
  @Environment(\.scenePhase) private var phase

  var body: some Scene {
    WindowGroup {
      ContentView()
        .environmentObject(session)
        .environmentObject(nav)
        .environmentObject(draft)
        .onAppear { session.activate(); WatchShot.open() }
        .onChange(of: phase) { _, p in if p == .active { session.refresh() } }
        // Complications (`widgetURL`) and `kopiyka://…` links land here: straight to a blank amount.
        .onOpenURL { _ in nav.resetToQuickAdd() }
    }
  }
}

/// Navigation state shared by the pages, the Action-button intent and complication taps.
/// Kept small on purpose: every view observing it re-renders when anything here changes.
@MainActor
final class WatchNav: ObservableObject {
  static let shared = WatchNav()
  /// Horizontal page: 0 = keypad (default), 1 = History, 2 = Budgets, 3 = Status.
  @Published var page = 0
  @Published var path = NavigationPath()
  /// Back to a blank amount on the keypad (Action button / Siri / complication).
  func resetToQuickAdd() {
    if !path.isEmpty { path = NavigationPath() }
    if page != 0 { page = 0 }
    WatchDraft.shared.text = ""
    WatchDraft.shared.note = ""
  }
}

/// The amount being typed. Its own object so a keystroke re-renders only the keypad,
/// not the navigation stack, the pager and every list in it.
@MainActor
final class WatchDraft: ObservableObject {
  static let shared = WatchDraft()
  @Published var text = ""          // typed amount, e.g. "12.5"
  @Published var note = ""          // dictated or scribbled on the category list; empty for most entries
  var value: Double { Double(text) ?? 0 }
}

/// Screenshots (scripts/screenshots/capture.sh): launched with `-KPShot <screen>` and `-KPShotAmount
/// <amount>`, the app opens on that screen with the amount typed, so a capture needs no taps. Launch
/// arguments are not something a person can pass on a watch; without them nothing here runs.
enum WatchShot {
  @MainActor static func open() {
    let args = UserDefaults.standard
    guard let shot = args.string(forKey: "KPShot") else { return }
    let nav = WatchNav.shared
    WatchDraft.shared.text = args.string(forKey: "KPShotAmount") ?? ""
    switch shot {
    case "categories": nav.path = NavigationPath([QuickStep.category])
    case "tags":
      // The tags of the category the list puts first, as the logging flow would reach them.
      let s = WatchSession.shared.state
      var path = NavigationPath()
      path.append(QuickStep.category)
      path.append(QuickStep.tags(KPRank.categories(s.categories, kind: "expense").first?.id))
      nav.path = path
    case "history": nav.page = 1
    case "budgets": nav.page = 2
    case "status": nav.page = 3
    default: break   // "keypad"
    }
  }
}

/// Bind this to the Ultra's Action button (Settings → Action Button → Shortcut) or run it from Siri on the watch.
struct WatchQuickAddIntent: AppIntent {
  static var title: LocalizedStringResource = "native.watch.intent.title"
  static var description = IntentDescription("native.watch.intent.description")
  static var openAppWhenRun = true
  @MainActor
  func perform() async throws -> some IntentResult {
    WatchNav.shared.resetToQuickAdd()
    return .result()
  }
}

struct WatchShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(intent: WatchQuickAddIntent(), phrases: ["Log expense in \(.applicationName)", "Add expense in \(.applicationName)"], shortTitle: "native.watch.intent.title", systemImageName: "plus.circle")
  }
}
