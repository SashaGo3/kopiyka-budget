import UIKit
import VisionKit

/// The system document camera for a receipt: it finds the paper's edges, takes the picture on its own
/// once the receipt is steady, and hands back a flat, straightened page — which is what lets the text
/// reader (KPReceipt) read small print a hand-held snapshot loses. A receipt too long for one shot can
/// be taken in several; the pages are stacked into one tall picture, top to bottom, so the entry still
/// has one photo (DATA.md rule 4). The picture goes to a temporary file; the entry sheet keeps it on save.
final class KPDocScan: NSObject, VNDocumentCameraViewControllerDelegate {
  private static var current: KPDocScan?
  private let done: (Result<String?, Error>) -> Void

  private init(done: @escaping (Result<String?, Error>) -> Void) { self.done = done }

  static var isSupported: Bool { VNDocumentCameraViewController.isSupported }

  /// Presents the scanner over whatever is on screen. `done` gets a file URI, nil when cancelled.
  @MainActor
  static func present(from presenter: UIViewController, done: @escaping (Result<String?, Error>) -> Void) {
    let scan = KPDocScan(done: done)
    current = scan
    let vc = VNDocumentCameraViewController()
    vc.delegate = scan
    vc.modalPresentationStyle = .fullScreen
    presenter.present(vc, animated: true)
  }

  /// The view controller on top of the key window's stack, to present from.
  @MainActor
  static func topViewController(in window: UIWindow?) -> UIViewController? {
    var vc = window?.rootViewController
    while let next = vc?.presentedViewController, !next.isBeingDismissed { vc = next }
    return vc
  }

  func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFinishWith scan: VNDocumentCameraScan) {
    let pages = (0..<scan.pageCount).map { scan.imageOfPage(at: $0) }
    controller.dismiss(animated: true)
    finish(Result { try Self.write(Self.stack(pages)) })
  }

  func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) {
    controller.dismiss(animated: true)
    finish(.success(nil))
  }

  func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFailWithError error: Error) {
    controller.dismiss(animated: true)
    finish(.failure(error))
  }

  private func finish(_ r: Result<String?, Error>) {
    done(r)
    Self.current = nil
  }

  /// Pages one under another at a common width: no wider than 1800 px, which keeps receipt print sharp
  /// for the reader without making a photo of several megabytes.
  static func stack(_ pages: [UIImage]) -> UIImage? {
    guard !pages.isEmpty else { return nil }
    let width = min(1800, pages.map(\.size.width).max() ?? 1800)
    let scaled = pages.map { p in CGSize(width: width, height: p.size.height * width / max(p.size.width, 1)) }
    let size = CGSize(width: width, height: scaled.reduce(0) { $0 + $1.height })
    let fmt = UIGraphicsImageRendererFormat.default(); fmt.scale = 1; fmt.opaque = true
    return UIGraphicsImageRenderer(size: size, format: fmt).image { _ in
      var y: CGFloat = 0
      for (p, s) in zip(pages, scaled) { p.draw(in: CGRect(x: 0, y: y, width: s.width, height: s.height)); y += s.height }
    }
  }

  enum Failure: LocalizedError { case noImage; var errorDescription: String? { "No page was scanned" } }

  static func write(_ image: UIImage?) throws -> String? {
    guard let image, let data = image.jpegData(compressionQuality: 0.72) else { throw Failure.noImage }
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("scan-\(UUID().uuidString.prefix(8)).jpg")
    try data.write(to: url)
    return url.absoluteString
  }
}
