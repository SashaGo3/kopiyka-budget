import SwiftUI
import WidgetKit

/// One complication, every accessory family: the app icon's К, which opens the watch app on a
/// blank amount (the app handles the `widgetURL` in `onOpenURL`). `Kay` is a template SVG in
/// Assets.xcassets, so watchOS tints it like any SF Symbol in every rendering mode.
@main
struct KopiykaWatchWidgetBundle: WidgetBundle {
  var body: some Widget { AddExpenseComplication() }
}

struct AddEntry: TimelineEntry { let date: Date }

struct AddProvider: TimelineProvider {
  func placeholder(in context: Context) -> AddEntry { AddEntry(date: .now) }
  func getSnapshot(in context: Context, completion: @escaping (AddEntry) -> Void) { completion(AddEntry(date: .now)) }
  func getTimeline(in context: Context, completion: @escaping (Timeline<AddEntry>) -> Void) {
    completion(Timeline(entries: [AddEntry(date: .now)], policy: .never))
  }
}

struct AddExpenseComplication: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "dev.kopiyka.watch.add", provider: AddProvider()) { _ in
      AddExpenseView()
        .containerBackground(for: .widget) { Color.clear }
        .widgetURL(KP.url("watch/add"))
    }
    .configurationDisplayName("Add expense")
    .description("Opens Kopiyka ready to type an amount.")
    .supportedFamilies([.accessoryCircular, .accessoryCorner, .accessoryRectangular, .accessoryInline])
  }
}

struct AddExpenseView: View {
  @Environment(\.widgetFamily) var family

  /// The app icon's silhouette — the lit face without the extrusion, which a single tint cannot
  /// carry — sized by its height, tinted by the complication's rendering mode.
  private func kay(_ size: CGFloat) -> some View {
    Image("Kay").resizable().renderingMode(.template).aspectRatio(contentMode: .fit).frame(height: size)
  }

  var body: some View {
    switch family {
    case .accessoryCircular:
      ZStack {
        AccessoryWidgetBackground()
        kay(30)
      }
      .widgetAccentable()
      .accessibilityLabel("Add expense")
    case .accessoryCorner:
      kay(28)
        .widgetAccentable()
        .accessibilityLabel("Add expense")
    case .accessoryInline:
      Label { Text("Expense") } icon: { kay(16) }
        .accessibilityLabel("Add expense")
    default:
      HStack(spacing: 8) {
        kay(34).widgetAccentable()
        Text("Expense").font(.headline)
      }
      .accessibilityElement(children: .ignore)
      .accessibilityLabel("Add expense")
    }
  }
}
