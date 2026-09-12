import SwiftUI
import WidgetKit

@main
struct KopiykaWidgetBundle: WidgetBundle {
  var body: some Widget {
    NetWorthWidget()
    BudgetsWidget()
    BudgetLockWidget()
  }
}

// MARK: - Timeline

struct KPEntry: TimelineEntry {
  let date: Date
  let snapshot: KPSnapshot
  let isPlaceholder: Bool
}

struct KPProvider: TimelineProvider {
  func placeholder(in context: Context) -> KPEntry { KPEntry(date: .now, snapshot: .placeholder, isPlaceholder: true) }
  func getSnapshot(in context: Context, completion: @escaping (KPEntry) -> Void) {
    completion(KPEntry(date: .now, snapshot: KPSnapshot.load() ?? .placeholder, isPlaceholder: context.isPreview))
  }
  func getTimeline(in context: Context, completion: @escaping (Timeline<KPEntry>) -> Void) {
    let entry = KPEntry(date: .now, snapshot: KPSnapshot.load() ?? .placeholder, isPlaceholder: false)
    // The app reloads timelines explicitly after each write; this is just a safety net.
    let next = Calendar.current.date(byAdding: .hour, value: 6, to: .now) ?? .now
    completion(Timeline(entries: [entry], policy: .after(next)))
  }
}

// MARK: - Net worth (small)

struct NetWorthWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "dev.kopiyka.networth", provider: KPProvider()) { entry in
      NetWorthView(entry: entry)
        .containerBackground(for: .widget) { Color("$widgetBackground") }
    }
    .configurationDisplayName("Net worth")
    .description("Balances across your accounts.")
    .supportedFamilies([.systemSmall, .systemMedium])
  }
}

struct NetWorthView: View {
  let entry: KPEntry
  @Environment(\.widgetFamily) var family

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack {
        Text("Net worth").font(.caption).foregroundStyle(.secondary)
        Spacer()
        Link(destination: KP.url("transaction/new?kind=expense")) {
          Image(systemName: "plus.circle.fill").font(.title3).foregroundStyle(Color("$accent"))
        }
      }
      ForEach(entry.snapshot.net_worth.prefix(family == .systemSmall ? 2 : 3), id: \.currency) { nw in
        Text(KPFormat.money(nw.amount, nw.currency, decimals: 0))
          .font(family == .systemSmall ? .title3 : .title2).fontWeight(.bold).monospacedDigit()
          .minimumScaleFactor(0.6).lineLimit(1)
      }
      Spacer(minLength: 0)
      if family == .systemMedium {
        VStack(alignment: .leading, spacing: 3) {
          ForEach(entry.snapshot.accounts.prefix(3)) { a in
            Link(destination: KP.url("accounts/\(a.id)")) {
              HStack {
                Text(a.name).font(.caption).lineLimit(1)
                Spacer()
                Text(KPFormat.money(a.balance, a.currency)).font(.caption).monospacedDigit().foregroundStyle(a.balance < 0 ? .red : .primary)
              }
            }
          }
        }
      } else if let a = entry.snapshot.accounts.first {
        Text("\(a.name): \(KPFormat.compact(a.balance)) \(a.currency)").font(.caption2).foregroundStyle(.secondary).lineLimit(1)
      }
    }
    .widgetURL(KP.url("accounts"))
    .redacted(reason: entry.isPlaceholder ? .placeholder : [])
  }
}

// MARK: - Budgets (medium / large)

struct BudgetsWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "dev.kopiyka.budgets", provider: KPProvider()) { entry in
      BudgetsView(entry: entry)
        .containerBackground(for: .widget) { Color("$widgetBackground") }
    }
    .configurationDisplayName("Budgets")
    .description("What is left in each budget this month.")
    .supportedFamilies([.systemMedium, .systemLarge])
  }
}

struct BudgetsView: View {
  let entry: KPEntry
  @Environment(\.widgetFamily) var family

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack {
        Text(entry.snapshot.month).font(.caption).foregroundStyle(.secondary)
        Spacer()
        Link(destination: KP.url("transaction/new?kind=expense")) {
          Image(systemName: "plus.circle.fill").font(.title3).foregroundStyle(Color("$accent"))
        }
      }
      if let t = entry.snapshot.trip {
        Link(destination: KP.url("budgets")) {
          VStack(alignment: .leading, spacing: 3) {
            HStack {
              Image(systemName: "airplane").font(.caption).foregroundStyle(.blue)
              Text(t.name).font(.subheadline).fontWeight(.semibold).lineLimit(1)
              Text(t.allowance.map { "· \(KPFormat.money(max(0, $0), t.currency, decimals: 0))/day" } ?? "· \(t.dayLabel)").font(.caption).foregroundStyle(.secondary).lineLimit(1)
              Spacer()
              Text(KPFormat.money(t.remaining, t.currency, decimals: 0))
                .font(.subheadline).monospacedDigit().foregroundStyle(t.remaining < 0 ? .red : .primary)
            }
            ProgressView(value: t.ratio).tint(t.remaining < 0 ? .red : t.ratio > 0.85 ? .orange : .blue)
          }
        }
      }
      if entry.snapshot.budgets.isEmpty && entry.snapshot.trip == nil {
        Text("No budgets yet").font(.subheadline).foregroundStyle(.secondary)
        Spacer()
      } else {
        ForEach(entry.snapshot.budgets.prefix((family == .systemLarge ? 8 : 3) - (entry.snapshot.trip == nil ? 0 : 1))) { b in
          Link(destination: KP.url("budgets")) {
            VStack(alignment: .leading, spacing: 3) {
              HStack {
                Text(b.name).font(.subheadline).fontWeight(.medium).lineLimit(1)
                Spacer()
                Text(KPFormat.money(b.remaining, b.currency, decimals: 0))
                  .font(.subheadline).monospacedDigit().foregroundStyle(b.remaining < 0 ? .red : .primary)
              }
              ProgressView(value: b.ratio).tint(b.remaining < 0 ? .red : b.ratio > 0.85 ? .orange : .green)
            }
          }
        }
        Spacer(minLength: 0)
      }
    }
    .widgetURL(KP.url("budgets"))
    .redacted(reason: entry.isPlaceholder ? .placeholder : [])
  }
}

// MARK: - Lock Screen / watch complications

struct BudgetLockWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "dev.kopiyka.lock", provider: KPProvider()) { entry in
      LockView(entry: entry).containerBackground(for: .widget) { Color.clear }
    }
    .configurationDisplayName("Budget left")
    .description("Remaining amount in your first budget.")
    .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline])
  }
}

struct LockView: View {
  let entry: KPEntry
  @Environment(\.widgetFamily) var family
  var budget: KPSnapshot.Budget? { entry.snapshot.featured }

  var body: some View {
    switch family {
    case .accessoryCircular:
      Gauge(value: 1 - (budget?.ratio ?? 0)) {
        Image(systemName: entry.snapshot.trip == nil ? "chart.pie" : "airplane")
      } currentValueLabel: {
        Text(KPFormat.compact(budget?.remaining ?? 0)).font(.caption2).minimumScaleFactor(0.5)
      }
      .gaugeStyle(.accessoryCircular)
      .widgetURL(KP.url("budgets"))
    case .accessoryInline:
      Text("\(budget?.name ?? "Budget"): \(KPFormat.compact(budget?.remaining ?? 0)) left")
    default:
      VStack(alignment: .leading) {
        Text(budget?.name ?? "Budget").font(.headline)
        Text("\(KPFormat.money(budget?.remaining ?? 0, budget?.currency ?? "", decimals: 0)) left").font(.caption)
        ProgressView(value: budget?.ratio ?? 0)
      }
      .widgetURL(KP.url("budgets"))
    }
  }
}
