import Foundation
import MapKit
import UIKit

/// Three small things only the system can answer, kept out of `KPBridgeModule` because none of them
/// is about the database. JS side: src/lib/device.ts.
///
///  - the pasteboard, so tapping an amount copies it;
///  - the languages and region the phone is set to, which is where the app's own language and the
///    currency offered during onboarding start from;
///  - place search, which is MapKit's `MKLocalSearch` — the same index Apple Maps uses, free, no
///    key, no account, and no third-party server learning where the user is looking.
enum KPDevice {

  // MARK: - Pasteboard

  static func copy(_ text: String) {
    UIPasteboard.general.string = text
  }

  /// What is on the pasteboard, if it is text. Empty string when there is nothing to paste.
  static func paste() -> String {
    UIPasteboard.general.string ?? ""
  }

  // MARK: - Languages and region

  /// The languages the user has chosen, best first ("uk-UA", "pl-PL"), and the region set in
  /// Settings → General → Language & Region, which is what the currency guess is built from.
  static func locales() -> [String: Any] {
    let languages = Locale.preferredLanguages
    let current = Locale.current
    let region = current.region?.identifier ?? ""
    return [
      "languages": languages,
      "locale": current.identifier,
      "region": region,
      "currency": current.currency?.identifier ?? "",
    ]
  }

  // MARK: - Place search

  /// Search Apple's map index for `query`, biased towards `lat`/`lon` when one is known so
  /// "pharmacy" finds the one on this street rather than one on another continent.
  ///
  /// Each result carries a name, an address line and a coordinate; the caller decides which to keep.
  static func searchPlaces(query: String, lat: Double?, lon: Double?, limit: Int) async throws -> [[String: Any]] {
    let request = MKLocalSearch.Request()
    request.naturalLanguageQuery = query
    request.resultTypes = [.pointOfInterest, .address]
    if let lat, let lon {
      request.region = MKCoordinateRegion(
        center: CLLocationCoordinate2D(latitude: lat, longitude: lon),
        // ~50 km across: wide enough for a city and its surroundings, narrow enough to rank local first.
        latitudinalMeters: 50_000, longitudinalMeters: 50_000)
    }
    let response = try await MKLocalSearch(request: request).start()
    return response.mapItems.prefix(limit).map { item in
      let p = item.placemark
      return [
        "name": item.name ?? p.name ?? "",
        "address": addressLine(p),
        "lat": p.coordinate.latitude,
        "lon": p.coordinate.longitude,
      ] as [String: Any]
    }
  }

  /// "Piękna 15, Warszawa" — street and city, skipping whatever the placemark does not know.
  private static func addressLine(_ p: MKPlacemark) -> String {
    let street = [p.thoroughfare, p.subThoroughfare].compactMap { $0 }.joined(separator: " ")
    return [street.isEmpty ? nil : street, p.locality ?? p.subAdministrativeArea, p.country]
      .compactMap { $0 }
      .filter { !$0.isEmpty }
      .joined(separator: ", ")
  }
}
