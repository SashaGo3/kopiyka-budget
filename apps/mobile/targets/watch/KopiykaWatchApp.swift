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
        .onAppear { session.activate() }
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
  }
}

/// The amount being typed. Its own object so a keystroke re-renders only the keypad,
/// not the navigation stack, the pager and every list in it.
@MainActor
final class WatchDraft: ObservableObject {
  static let shared = WatchDraft()
  @Published var text = ""          // typed amount, e.g. "12.5"
  var value: Double { Double(text) ?? 0 }
}

/// Bind this to the Ultra's Action button (Settings → Action Button → Shortcut) or run it from Siri on the watch.
struct WatchQuickAddIntent: AppIntent {
  static var title: LocalizedStringResource = "Log expense"
  static var description = IntentDescription("Open Kopiyka on the watch ready to type an amount.")
  static var openAppWhenRun = true
  @MainActor
  func perform() async throws -> some IntentResult {
    WatchNav.shared.resetToQuickAdd()
    return .result()
  }
}

struct WatchShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(intent: WatchQuickAddIntent(), phrases: ["Log expense in \(.applicationName)", "Add expense in \(.applicationName)"], shortTitle: "Log expense", systemImageName: "plus.circle")
  }
}
