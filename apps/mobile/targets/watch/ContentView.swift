import SwiftUI
import WatchKit

/// Four horizontal pages inside one NavigationStack (the stack must wrap the TabView on
/// watchOS 10+; pushes for the entry flow land on that outer stack). The path is a type-erased
/// NavigationPath on purpose: a typed `[QuickStep]` binding hits SwiftUI's
/// `AnyNavigationPath.Error.comparisonTypeMismatch` fatal when pages change mid-pop.
///
/// Keypad (default) | History | Budgets | Status. Amount → category → tags → saved, then the
/// app moves to History; swiping back (or the Action button / complication) returns to the keypad.
/// The account is always the app's current account (meta `current_account`).
///
/// Performance notes (Ultra 1): this view observes only `WatchNav` (page + path). The session
/// is read through `WatchSession.shared` inside closures so keystrokes, reachability flips and
/// location fixes never re-render the stack; list rows are precomputed plain values.
struct ContentView: View {
  @EnvironmentObject var nav: WatchNav

  var body: some View {
    // Measured outside the NavigationStack on purpose. A page inside the pager is told its top
    // safe-area inset is 66pt (room reserved for the navigation bar) for as long as the swipe
    // animates and 47.5pt (bar hidden) once it settles, so anything that sizes or places itself
    // from its own geometry snaps by that difference on the frame the transition ends — which is
    // the keypad jump. Out here the numbers never move, so `room` is the same before, during and
    // after a swipe.
    GeometryReader { screen in
      // Height the keypad may fill: everything below the clock, minus its own bottom clearance.
      let room = screen.size.height + screen.safeAreaInsets.bottom - LogPage.bottomInset
      NavigationStack(path: $nav.path) {
        TabView(selection: $nav.page) {
          LogPage(room: room).tag(0)
          HistoryPage().tag(1)
          BudgetsPage().tag(2)
          StatusPage().tag(3)
        }
        // No page dots: the keypad's bottom row sits right above them, and four unlabelled dots
        // say less than the swipe itself does.
        .tabViewStyle(.page(indexDisplayMode: .never))
        // One navigation-bar state for all four pages, so no page is the odd one out mid-swipe.
        // The bar's height still comes back into the page's safe area while the pager animates,
        // which is why the keypad reads its size from outside the stack rather than from itself.
        .toolbar(.hidden, for: .navigationBar)
        .navigationDestination(for: QuickStep.self) { step in
          let session = WatchSession.shared
          switch step {
          case .category:
            CategoryPickView { cat in
              // Skip the tags step when nothing could be picked anyway.
              let ranked = KPRank.tags(session.state.tags, category: cat, categories: session.state.categories, together: session.state.together)
              if ranked.isEmpty { save(category: cat, tags: []) } else { nav.path.append(QuickStep.tags(cat?.id)) }
            }
          case .tags(let catId):
            TagsPickView(category: session.state.category(catId), amountLabel: amountLabel) { tags in save(category: session.state.category(catId), tags: tags) }
          }
        }
      }
    }
  }

  var amountLabel: String {
    let s = WatchSession.shared
    return KPFormat.money(WatchDraft.shared.value, s.state.defaultAccount?.currency ?? "")
  }

  func save(category: KPWatchState.Category?, tags: [String]) {
    let session = WatchSession.shared, draft = WatchDraft.shared
    guard let acc = session.state.defaultAccount, draft.value > 0 else { return }
    let minor = KPFormat.minor(draft.value, acc.currency)
    session.add(amountMinor: -minor, account: acc, category: category, tagIds: tags)
    WKInterfaceDevice.current().play(.success)
    nav.path = NavigationPath()
    draft.text = ""
    nav.page = 1
  }
}

// MARK: - Log page (amount keypad)

enum QuickStep: Hashable { case category, tags(String?) }

/// Big amount row that doubles as "Next", 3×4 keypad filling the rest of the screen.
/// No ScrollView and no lazy grid (twelve fixed keys), so it always sits below the clock and
/// nothing can scroll under the status bar. The bottom row keeps a little distance from the
/// curved screen edge so "." and "⌫" are not clipped by the corners.
///
/// It takes `room` from `ContentView` rather than measuring itself, and hangs off the bottom
/// edge: inside the pager a page's top safe-area inset changes while the swipe animates, so a
/// self-measured, top-aligned keypad resized and slid up the moment the transition finished.
/// The bottom edge stays put through all of that, and `room` never changes at all.
struct LogPage: View {
  let room: CGFloat
  @EnvironmentObject var draft: WatchDraft
  @EnvironmentObject var nav: WatchNav

  /// The two things the keypad shows from the session, copied in when the phone pushes new state.
  /// Observing `WatchSession` itself re-rendered the whole keypad on every reachability flip,
  /// location fix, history rebuild and state push — also in the middle of the page transition,
  /// which is what made the swipe from History to the keypad stutter.
  @State private var account: KPWatchState.Account? = WatchSession.shared.state.defaultAccount
  @State private var hasData = WatchSession.shared.hasData

  private let amountHeight: CGFloat = 44
  private let gap: CGFloat = 4
  /// Clearance above the curved bottom edge.
  static let bottomInset: CGFloat = 10
  var shown: String { draft.text.isEmpty ? "0" : draft.text }
  var hasAmount: Bool { draft.value > 0 }

  var body: some View {
    let keyHeight = max(28, min(48, (room - amountHeight - gap * 4) / 4))
    VStack(spacing: gap) {
      Button { nav.path = NavigationPath([QuickStep.category]) } label: {
        HStack(alignment: .firstTextBaseline, spacing: 5) {
          Text(shown)
            .font(.system(.title, design: .rounded).weight(.bold)).monospacedDigit().lineLimit(1).minimumScaleFactor(0.5)
          Text(account?.currency ?? "").font(.footnote.weight(.semibold)).foregroundStyle(.secondary)
          Spacer(minLength: 4)
        }
        .padding(.horizontal, 10).frame(height: amountHeight)
        .background(hasAmount ? Color.green.opacity(0.28) : Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .disabled(!hasAmount || account == nil)
      .accessibilityLabel("Amount \(shown) \(account?.currency ?? "")")
      .accessibilityHint(hasAmount ? "Next: choose a category" : "Type an amount on the keypad below")
      .accessibilityAddTraits(.isHeader)

      KeypadGrid(keyHeight: keyHeight, gap: gap, decimals: KPFormat.decimals(account?.currency ?? "")).equatable()

      if !hasData {
        Text("Open Kopiyka on your iPhone once to sync.").font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
      }
    }
    // Bottom-aligned: the page's top inset moves during a swipe, its bottom edge does not.
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
    .padding(.horizontal, 4)
    .padding(.bottom, Self.bottomInset)
    .ignoresSafeArea(edges: .bottom)
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Add expense")
    // `@Published` hands a new subscriber the current value, so this also fills the two fields in.
    .onReceive(WatchSession.shared.$state) { s in
      if s.defaultAccount != account { account = s.defaultAccount }
      if !s.accounts.isEmpty != hasData { hasData = !s.accounts.isEmpty }
    }
  }
}

/// The twelve keys. Equatable on the only inputs that shape them, so typing a digit (or a page
/// transition) re-renders the amount row alone instead of twelve buttons with their backgrounds.
/// It writes to the shared draft itself rather than taking a closure, which keeps it comparable.
struct KeypadGrid: View, Equatable {
  let keyHeight: CGFloat
  let gap: CGFloat
  let decimals: Int
  private static let rows: [[String]] = [["7", "8", "9"], ["4", "5", "6"], ["1", "2", "3"], [".", "0", "⌫"]]

  static func == (a: KeypadGrid, b: KeypadGrid) -> Bool {
    a.keyHeight == b.keyHeight && a.gap == b.gap && a.decimals == b.decimals
  }

  var body: some View {
    VStack(spacing: gap) {
      ForEach(Self.rows, id: \.self) { row in
        HStack(spacing: gap) {
          ForEach(row, id: \.self) { k in KeyButton(key: k, height: keyHeight) { tap(k) } }
        }
      }
    }
  }

  private func tap(_ k: String) {
    WKInterfaceDevice.current().play(.click)
    let draft = WatchDraft.shared
    var t = draft.text
    switch k {
    case "⌫": if !t.isEmpty { t.removeLast() }
    case ".": if !t.contains(".") { t += t.isEmpty ? "0." : "." }
    default:
      if let dot = t.firstIndex(of: "."), t.distance(from: dot, to: t.endIndex) > decimals { return }
      if t == "0" { t = k } else if t.count < 9 { t += k }
    }
    if t != draft.text { draft.text = t }
  }
}

/// One keypad key. A separate value view so SwiftUI can skip keys whose inputs did not change.
struct KeyButton: View {
  let key: String
  let height: CGFloat
  let action: () -> Void
  var body: some View {
    Button(action: action) {
      Group {
        if key == "⌫" { Image(systemName: "delete.left.fill").foregroundStyle(.red) } else { Text(key) }
      }
      .font(.system(.title2, design: .rounded).weight(.medium))
      .frame(maxWidth: .infinity).frame(height: height)
      .background(key == "⌫" ? Color.red.opacity(0.2) : Color.white.opacity(0.15), in: RoundedRectangle(cornerRadius: 11, style: .continuous))
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .accessibilityLabel(key == "⌫" ? "Delete last digit" : key == "." ? "Decimal point" : key)
  }
}

// MARK: - Category

/// Same icon + colour the app draws (resolved on the phone by `iconFor`, sent in the state).
struct CategoryIconView: View {
  let symbol: String
  let hex: String?
  var size: CGFloat = 30
  init(category: KPWatchState.Category?, size: CGFloat = 30) {
    symbol = category?.icon ?? (category == nil ? "minus" : "tag.fill"); hex = category?.color; self.size = size
  }
  init(symbol: String, hex: String?, size: CGFloat) { self.symbol = symbol; self.hex = hex; self.size = size }
  var body: some View {
    let color = hex.map(Color.hex) ?? Color.gray
    ZStack {
      RoundedRectangle(cornerRadius: size * 0.28, style: .continuous).fill(color.opacity(0.22))
      Image(systemName: symbol).font(.system(size: size * 0.5, weight: .semibold)).foregroundStyle(color)
    }
    .frame(width: size, height: size)
    .accessibilityHidden(true)
  }
}

/// Categories most used first (same order as the app's picker), folder under the name.
/// When the phone knows this spot, its suggestion sits on top marked "Near here".
struct CategoryPickView: View {
  @EnvironmentObject var session: WatchSession
  let pick: (KPWatchState.Category?) -> Void

  var items: [KPWatchState.Category] {
    let ranked = KPRank.categories(session.state.categories, kind: "expense")
    guard let s = session.suggestedCategoryId, let hit = ranked.first(where: { $0.id == s }) else { return ranked }
    return [hit] + ranked.filter { $0.id != s }
  }

  var body: some View {
    let near = session.suggestedCategoryId
    List {
      if items.isEmpty { Text("Categories sync from your iPhone.").foregroundStyle(.secondary) }
      ForEach(items) { c in
        CategoryRow(category: c, near: c.id == near) { pick(c) }
      }
      Button { pick(nil) } label: {
        HStack(spacing: 8) { CategoryIconView(category: nil); Text("No category").font(.body).foregroundStyle(.secondary) }
      }
      .accessibilityHint("Save without a category")
    }
    .navigationTitle("Category")
  }
}

struct CategoryRow: View {
  let category: KPWatchState.Category
  let near: Bool
  let pick: () -> Void
  var body: some View {
    Button(action: pick) {
      HStack(spacing: 8) {
        CategoryIconView(category: category)
        VStack(alignment: .leading, spacing: 1) {
          Text(category.name).font(.body).lineLimit(1).minimumScaleFactor(0.5).allowsTightening(true)
          HStack(spacing: 4) {
            // The arrow alone says "near here" — the words next to it only squeezed the folder name.
            if near { Image(systemName: "location.fill").font(.footnote.weight(.semibold)).foregroundStyle(.secondary) }
            Text(category.parent_name ?? "Folder").font(.caption2).foregroundStyle(.secondary).lineLimit(1)
          }
        }
      }
    }
    .accessibilityLabel((near ? "Near here: " : "") + (category.parent_name.map { "\(category.name), in \($0)" } ?? "\(category.name) folder"))
    .accessibilityHint("Choose this category")
  }
}

// MARK: - Tags

/// "No tags" saves at once (first row); tags ranked for the category below; Save appears once some are ticked.
struct TagsPickView: View {
  let category: KPWatchState.Category?
  let amountLabel: String
  let save: ([String]) -> Void
  @State private var chosen: Set<String> = []
  /// Ranked once for this category; hidden tags (meant for other categories) only appear once selected, so re-rank on toggle.
  @State private var ranked: [KPRank.RankedTag] = []
  /// Travel mode: the trip tag starts ticked (the phone adds it anyway; this shows it).
  private let tripTag: String? = WatchSession.shared.state.snapshot?.trip?.tag_id

  var saveLabel: String { "Save \(amountLabel)\(category.map { " for \($0.name)" } ?? "")" }

  var body: some View {
    let first = ranked.filter { $0.rank == 0 }, rest = ranked.filter { $0.rank != 0 }
    List {
      Button { save(tripTag.map { [$0] } ?? []) } label: {
        HStack(spacing: 8) {
          Image(systemName: "checkmark.circle.fill").font(.title3).foregroundStyle(.green)
          VStack(alignment: .leading, spacing: 1) {
            Text(tripTag == nil ? "No tags" : "Just the trip tag").font(.body.weight(.semibold))
            Text(amountLabel).font(.caption2).foregroundStyle(.secondary)
          }
        }
      }
      .accessibilityLabel("No tags")
      .accessibilityHint(saveLabel)
      if category != nil && !first.isEmpty {
        Section("Used with \(category!.name)") { ForEach(first) { r in tagRow(r) } }
        if !rest.isEmpty { Section("Other tags") { ForEach(rest) { r in tagRow(r) } } }
      } else {
        Section("Tags") { ForEach(ranked) { r in tagRow(r) } }
      }
    }
    .navigationTitle("Tags")
    .onAppear { if ranked.isEmpty { rerank() } }
    .toolbar {
      if !chosen.isEmpty {
        ToolbarItem(placement: .bottomBar) {
          // Small on purpose: it sits over the list, so it takes the least room that still reads.
          Button { save(ranked.map(\.tag.id).filter { chosen.contains($0) }) } label: { Label("Save · \(chosen.count) tag\(chosen.count == 1 ? "" : "s")", systemImage: "checkmark").font(.caption.weight(.semibold)) }
            .buttonStyle(.borderedProminent).tint(.green).controlSize(.small)
            .fixedSize()
            .accessibilityLabel(saveLabel + " with \(chosen.count) tag\(chosen.count == 1 ? "" : "s")")
        }
      }
    }
  }

  private func rerank() {
    let s = WatchSession.shared.state
    ranked = KPRank.tags(s.tags, category: category, categories: s.categories, together: s.together, selected: chosen)
  }

  @ViewBuilder func tagRow(_ r: KPRank.RankedTag) -> some View {
    let on = chosen.contains(r.tag.id)
    Button { toggle(r.tag.id) } label: {
      HStack {
        Text(r.tag.name).font(.body).lineLimit(1).minimumScaleFactor(0.5).allowsTightening(true)
        Spacer()
        // Green like the "No tags" row and the saved confirmation: the accent tick was nearly
        // invisible on the dark watch background.
        Image(systemName: on ? "checkmark.circle.fill" : "circle").font(.title3).foregroundStyle(on ? Color.green : Color.secondary)
      }
    }
    .accessibilityLabel(r.tag.name)
    .accessibilityValue(on ? "selected" : "not selected")
    .accessibilityHint(on ? "Double tap to remove this tag" : "Double tap to add this tag")
    .accessibilityAddTraits(on ? .isSelected : [])
  }

  private func toggle(_ id: String) {
    WKInterfaceDevice.current().play(.click)
    if chosen.contains(id) { chosen.remove(id) } else { chosen.insert(id) }
    rerank()
  }
}

/// Secondary pages have no title bar content: the list starts right under the clock (the bar itself is hidden on the TabView).
struct PageBar: ViewModifier {
  func body(content: Content) -> some View { content.navigationTitle("") }
}

// MARK: - History

struct HistoryPage: View {
  @EnvironmentObject var session: WatchSession

  var body: some View {
    List {
      if let p = session.problem {
        Label(p, systemImage: "exclamationmark.triangle.fill").font(.footnote.weight(.semibold))
          .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 10).padding(.vertical, 7)
          .background(Color.orange.opacity(0.25), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
          .listRowBackground(Color.clear).listRowInsets(EdgeInsets())
      }
      if session.historyDays.isEmpty {
        Text(session.hasData ? "Nothing today or yesterday." : "Open Kopiyka on your iPhone once to sync.").font(.footnote).foregroundStyle(.secondary)
      }
      ForEach(session.historyDays) { d in
        Section(d.label) {
          // `.equatable()`: a row whose item did not change is not re-rendered when the session
          // publishes (a reachability flip, a location fix) — including during a page swipe.
          ForEach(d.rows) { HistoryRow(item: $0).equatable() }
        }
      }
    }
    .modifier(PageBar())
    .refreshable { session.refresh() }
  }
}

/// Category icon, title with amount, then "folder › category · time". A pure value view:
/// everything it shows was formatted once in `WatchSession.rebuildHistory`.
struct HistoryRow: View, Equatable {
  let item: WatchSession.HistoryItem

  var body: some View {
    HStack(alignment: .top, spacing: 8) {
      if item.transfer {
        ZStack { RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Color.gray.opacity(0.22)); Image(systemName: "arrow.left.arrow.right").font(.system(size: 13, weight: .semibold)).foregroundStyle(.gray) }
          .frame(width: 28, height: 28).accessibilityHidden(true)
      } else {
        CategoryIconView(symbol: item.icon, hex: item.color, size: 28)
      }
      // Single lines that shrink to fit: nothing wraps, nothing is cut off.
      VStack(alignment: .leading, spacing: 2) {
        Text(item.title).font(.footnote.weight(.semibold)).lineLimit(1).minimumScaleFactor(0.5).allowsTightening(true)
        HStack(alignment: .firstTextBaseline, spacing: 4) {
          Text(item.amount).font(.footnote.weight(.semibold)).monospacedDigit().lineLimit(1).minimumScaleFactor(0.7)
            .foregroundStyle(item.transfer ? Color.secondary : item.income ? Color.green : Color.primary)
          Spacer(minLength: 4)
          if item.queued { Image(systemName: "clock").font(.caption2).foregroundStyle(.orange) }
          if item.pending { Image(systemName: "hourglass").font(.caption2).foregroundStyle(.secondary) }
        }
        Text(item.path).font(.caption2).foregroundStyle(item.queued ? .orange : .secondary).lineLimit(1).minimumScaleFactor(0.5).allowsTightening(true)
        if !item.tags.isEmpty { TagPills(tags: item.tags) }
      }
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(item.accessibility)
  }
}

/// The transaction's tags as small tinted pills (tag colour from the phone, gray when none).
/// One line that shrinks rather than wraps, like the rest of the row.
struct TagPills: View {
  let tags: [WatchSession.TagChip]
  var body: some View {
    HStack(spacing: 3) {
      ForEach(tags) { t in
        let color = Color.hex(KPTagColor.hex(t.name, t.color))
        Text(t.name)
          .font(.system(size: 10, weight: .semibold)).lineLimit(1).minimumScaleFactor(0.6).allowsTightening(true)
          .padding(.horizontal, 5).padding(.vertical, 1.5)
          .background(color.opacity(0.22), in: Capsule())
          .foregroundStyle(color)
      }
    }
    .padding(.top, 1)
  }
}

// MARK: - Budgets

struct BudgetsPage: View {
  @EnvironmentObject var session: WatchSession
  var snapshot: KPSnapshot? { session.state.snapshot }

  var body: some View {
    List {
      if let t = snapshot?.trip {
        Section("Travel mode") {
          VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 4) {
              Image(systemName: "airplane").font(.caption2).foregroundStyle(.blue)
              Text(t.name).font(.footnote).foregroundStyle(.secondary).lineLimit(1).minimumScaleFactor(0.5)
            }
            Text("\(KPFormat.money(t.remaining, t.currency, decimals: 0)) left").font(.body.weight(.semibold)).monospacedDigit().foregroundStyle(t.remaining < 0 ? Color.red : Color.primary)
            ProgressView(value: t.ratio).tint(t.remaining < 0 ? .red : t.ratio > 0.85 ? .orange : .blue)
            Text(t.allowance.map { "\(t.dayLabel) · \(KPFormat.money(max(0, $0), t.currency, decimals: 0))/day" } ?? t.dayLabel).font(.caption2).foregroundStyle(.secondary)
          }
          .accessibilityElement(children: .ignore)
          .accessibilityLabel("Trip \(t.name), \(KPFormat.money(t.remaining, t.currency, decimals: 0)) left, \(t.dayLabel)")
        }
      }
      if let s = snapshot, !s.budgets.isEmpty {
        Section(s.month) {
          ForEach(s.budgets) { b in
            VStack(alignment: .leading, spacing: 4) {
              Text(b.name).font(.footnote).foregroundStyle(.secondary).lineLimit(1).minimumScaleFactor(0.5).allowsTightening(true)
              Text("\(KPFormat.money(b.remaining, b.currency, decimals: 0)) left").font(.body.weight(.semibold)).monospacedDigit().foregroundStyle(b.remaining < 0 ? Color.red : Color.primary)
              ProgressView(value: b.ratio).tint(b.remaining < 0 ? .red : b.ratio > 0.85 ? .orange : .green)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(b.name), \(KPFormat.money(b.remaining, b.currency, decimals: 0)) left")
          }
        }
      } else if snapshot?.trip == nil {
        Text(session.hasData ? "No budgets yet. Add one on your iPhone." : "Open Kopiyka on your iPhone once to sync.").font(.footnote).foregroundStyle(.secondary)
      }
    }
    .modifier(PageBar())
  }
}

// MARK: - Status

/// iPhone connection, pending watch entries and the last save; "Refresh" asks the phone for fresh data.
struct StatusPage: View {
  @EnvironmentObject var session: WatchSession

  var updatedAt: String {
    guard let d = KPFormat.parseIso(session.state.generated_at) else { return "never" }
    let t = KPFormat.timePrinter.string(from: d)
    return Calendar.current.isDateInToday(d) ? t : KPFormat.dayLabel(String(session.state.generated_at.prefix(10))) + " " + t
  }

  var body: some View {
    List {
      HStack {
        Spacer(minLength: 0)
        Button { session.refresh() } label: {
          HStack(spacing: 8) {
            if session.loading { ProgressView().controlSize(.small) } else { Image(systemName: "arrow.triangle.2.circlepath").font(.title3) }
            Text(session.loading ? "Refreshing…" : "Refresh").font(.body.weight(.semibold))
          }
          .padding(.horizontal, 6).frame(minHeight: 40)
        }
        .buttonStyle(.borderedProminent).tint(Color("$accent")).disabled(session.loading).fixedSize()
        .accessibilityHint("Asks the iPhone for the latest accounts, categories and history")
        Spacer(minLength: 0)
      }
      .listRowBackground(Color.clear).listRowInsets(EdgeInsets())

      Section("Status") {
        StatusRow(icon: session.reachable ? "iphone" : "iphone.slash", tint: session.reachable ? .green : .orange,
                  title: session.reachable ? "iPhone connected" : "iPhone not reachable",
                  detail: session.reachable ? "Entries are saved on the iPhone at once" : "Entries wait on the watch until it is back")
        StatusRow(icon: "clock.arrow.circlepath", tint: .secondary, title: "Data from iPhone", detail: updatedAt)
        StatusRow(icon: session.queued.isEmpty ? "checkmark.circle" : "tray.full", tint: session.queued.isEmpty ? .green : .orange,
                  title: session.queued.isEmpty ? "Nothing waiting" : "\(session.queued.count) waiting for iPhone",
                  detail: session.queued.isEmpty ? "All watch entries delivered" : "Delivered automatically when the iPhone is near")
        if let w = session.lastWrite {
          StatusRow(icon: w.ok ? "checkmark.circle" : "xmark.octagon", tint: w.ok ? .green : .red, title: w.text,
                    detail: "Last entry")
        }
      }
    }
    .modifier(PageBar())
  }
}

struct StatusRow: View {
  let icon: String; let tint: Color; let title: String; let detail: String
  var body: some View {
    HStack(alignment: .top, spacing: 8) {
      Image(systemName: icon).font(.body).foregroundStyle(tint).frame(width: 22)
      VStack(alignment: .leading, spacing: 1) {
        Text(title).font(.footnote.weight(.semibold)).fixedSize(horizontal: false, vertical: true)
        Text(detail).font(.caption2).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
      }
    }
    .accessibilityElement(children: .ignore).accessibilityLabel("\(title). \(detail)")
  }
}

extension Color {
  /// "#RRGGBB" → Color; anything else → gray.
  static func hex(_ s: String) -> Color {
    var h = s.trimmingCharacters(in: .whitespaces); if h.hasPrefix("#") { h.removeFirst() }
    guard h.count == 6, let v = UInt32(h, radix: 16) else { return .gray }
    return Color(red: Double((v >> 16) & 0xFF) / 255, green: Double((v >> 8) & 0xFF) / 255, blue: Double(v & 0xFF) / 255)
  }
}
