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
    // Key literals: the watch face gallery is the system's, so these follow the phone's language.
    .configurationDisplayName(LocalizedStringKey("native.complication.name"))
    .description(LocalizedStringKey("native.complication.description"))
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
      .accessibilityLabel(L10n.Complication.a11y)
    case .accessoryCorner:
      kay(28)
        .widgetAccentable()
        .accessibilityLabel(L10n.Complication.a11y)
    case .accessoryInline:
      Label { Text(L10n.Complication.label) } icon: { kay(16) }
        .accessibilityLabel(L10n.Complication.a11y)
    default:
      HStack(spacing: 8) {
        kay(34).widgetAccentable()
        Text(L10n.Complication.label).font(.headline)
      }
      .accessibilityElement(children: .ignore)
      .accessibilityLabel(L10n.Complication.a11y)
    }
  }
}
