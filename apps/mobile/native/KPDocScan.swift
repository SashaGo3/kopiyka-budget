import AVFoundation
import CoreImage
import CoreImage.CIFilterBuiltins
import PhotosUI
import UIKit
import Vision

/// The receipt camera: point, tap, done.
///
/// Nothing has to be lined up. The picture is taken when the shutter is tapped, and only then does
/// Vision look for the paper on it: the photo is cropped and squared up to the receipt's edges —
/// which is what lets the text reader (KPReceipt) read small print a hand-held snapshot loses — or
/// kept whole when no receipt can be told apart from what is around it. The file goes straight
/// back; the entry sheet keeps it on save (DATA.md rule 4) and the photo viewer shows what was read.
///
/// The preview shows the whole frame the photo will hold (4:3, letterboxed like the Camera app),
/// never a crop of it, and the lens is the one the Camera app calls 1×; on a phone with an
/// ultra-wide lens the system moves to it on its own for a receipt held close (macro).
///
/// Nothing on it but the picture, the shutter, the library (a receipt already photographed goes
/// through the same cropping) and ✕: what to do is obvious, and a spinner says it is working.
///
/// It replaced the system document camera, which collects any number of pages and ends on its own
/// Save, and then a camera of its own that waited for the outline to hold still and asked Retake
/// or Continue. A receipt is one picture, and lining it up is the app's job, not the person's.
final class KPDocScan: UIViewController, AVCapturePhotoCaptureDelegate, PHPickerViewControllerDelegate {
  private static var current: KPDocScan?
  private let done: (Result<String?, Error>) -> Void

  static var isSupported: Bool { AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back) != nil }

  /// Presents the camera over whatever is on screen. `done` gets a file URI, nil when cancelled.
  @MainActor
  static func present(from presenter: UIViewController, done: @escaping (Result<String?, Error>) -> Void) {
    let start = {
      let vc = KPDocScan(done: done)
      current = vc
      vc.modalPresentationStyle = .fullScreen
      presenter.present(vc, animated: true)
    }
    switch AVCaptureDevice.authorizationStatus(for: .video) {
    case .authorized: start()
    case .notDetermined:
      AVCaptureDevice.requestAccess(for: .video) { ok in
        DispatchQueue.main.async { if ok { start() } else { done(.failure(Failure.cameraOff)) } }
      }
    default: done(.failure(Failure.cameraOff))
    }
  }

  /// The view controller on top of the key window's stack, to present from.
  @MainActor
  static func topViewController(in window: UIWindow?) -> UIViewController? {
    var vc = window?.rootViewController
    while let next = vc?.presentedViewController, !next.isBeingDismissed { vc = next }
    return vc
  }

  enum Failure: LocalizedError {
    case noImage, cameraOff
    var errorDescription: String? {
      switch self { case .noImage: return L10n.Receipt.noImage; case .cameraOff: return L10n.Receipt.Scan.cameraOff }
    }
  }

  private init(done: @escaping (Result<String?, Error>) -> Void) {
    self.done = done
    super.init(nibName: nil, bundle: nil)
  }
  required init?(coder: NSCoder) { fatalError("not used") }

  // MARK: - Camera

  private let session = AVCaptureSession()
  private let photoOutput = AVCapturePhotoOutput()
  private let sessionQueue = DispatchQueue(label: "dev.kopiyka.receipt-camera")
  private let preview = AVCaptureVideoPreviewLayer()
  private var device: AVCaptureDevice?
  private let library = UIButton(type: .system)
  private let shutter = UIButton(type: .custom)
  private let close = UIButton(type: .system)
  private let flash = UIView()
  private let working = UIActivityIndicatorView(style: .large)
  private var capturing = false

  override var prefersStatusBarHidden: Bool { true }
  override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .portrait }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .black
    preview.session = session
    // The whole frame, as the photo will hold it. Aspect-fill cropped a 4:3 picture to the screen's
    // shape, so the preview looked zoomed in and hid the receipt's edges that were in the photo.
    preview.videoGravity = .resizeAspect
    view.layer.addSublayer(preview)
    view.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(focusTapped(_:))))

    shutter.backgroundColor = .white
    shutter.layer.cornerRadius = 36
    shutter.layer.borderWidth = 5
    shutter.layer.borderColor = UIColor.white.withAlphaComponent(0.45).cgColor
    shutter.accessibilityLabel = L10n.Receipt.Scan.take
    shutter.addTarget(self, action: #selector(shoot), for: .touchUpInside)
    view.addSubview(shutter)

    library.setImage(UIImage(systemName: "photo.on.rectangle", withConfiguration: UIImage.SymbolConfiguration(pointSize: 20, weight: .medium)), for: .normal)
    library.tintColor = .white
    library.backgroundColor = UIColor.white.withAlphaComponent(0.16)
    library.layer.cornerRadius = 24
    library.accessibilityLabel = L10n.Receipt.Scan.library
    library.addTarget(self, action: #selector(pickFromLibrary), for: .touchUpInside)
    view.addSubview(library)

    close.setImage(UIImage(systemName: "xmark", withConfiguration: UIImage.SymbolConfiguration(pointSize: 17, weight: .semibold)), for: .normal)
    close.tintColor = .white
    close.backgroundColor = UIColor.white.withAlphaComponent(0.16)
    close.layer.cornerRadius = 20
    close.accessibilityLabel = L10n.Receipt.Scan.close
    close.addTarget(self, action: #selector(cancel), for: .touchUpInside)
    view.addSubview(close)

    flash.backgroundColor = .white
    flash.alpha = 0
    flash.isUserInteractionEnabled = false
    view.addSubview(flash)

    working.color = .white
    working.hidesWhenStopped = true
    view.addSubview(working)

    sessionQueue.async { self.configureSession() }
  }

  /// Where the 4:3 picture sits: full width, under the close button, clear of the shutter when the
  /// screen has room for both.
  private var frameRect: CGRect {
    let b = view.bounds, safe = view.safeAreaInsets
    let h = b.width * 4 / 3
    let top = max(0, min(safe.top + 56, b.height - h - max(safe.bottom, 16) - 128))
    return CGRect(x: 0, y: top, width: b.width, height: h)
  }

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    let b = view.bounds, safe = view.safeAreaInsets
    preview.frame = frameRect
    flash.frame = frameRect
    working.center = CGPoint(x: frameRect.midX, y: frameRect.midY)
    close.frame = CGRect(x: 16, y: safe.top + 8, width: 40, height: 40)
    shutter.frame = CGRect(x: b.midX - 36, y: b.maxY - max(safe.bottom, 16) - 20 - 72, width: 72, height: 72)
    library.frame = CGRect(x: 32, y: shutter.frame.midY - 24, width: 48, height: 48)
  }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    sessionQueue.async { [session] in if !session.isRunning { session.startRunning() } }
  }

  override func viewWillDisappear(_ animated: Bool) {
    super.viewWillDisappear(animated)
    sessionQueue.async { [session] in if session.isRunning { session.stopRunning() } }
  }

  /// The back camera the Camera app uses: the virtual multi-lens one where there is one, so a receipt
  /// held close switches to the ultra-wide's macro focus by itself instead of staying a blur.
  private static func backCamera() -> AVCaptureDevice? {
    AVCaptureDevice.DiscoverySession(deviceTypes: [.builtInTripleCamera, .builtInDualWideCamera, .builtInDualCamera, .builtInWideAngleCamera],
                                     mediaType: .video, position: .back).devices.first
  }

  private func configureSession() {
    session.beginConfiguration()
    session.sessionPreset = .photo
    if let device = Self.backCamera(), let input = try? AVCaptureDeviceInput(device: device), session.canAddInput(input) {
      session.addInput(input)
      self.device = device
      if (try? device.lockForConfiguration()) != nil {
        // Zoom 1 on a virtual camera that starts with the ultra-wide is the Camera app's 0.5×; its 1× is
        // the first switch-over point, where the wide lens takes over.
        if device.constituentDevices.first?.deviceType == .builtInUltraWideCamera, let wide = device.virtualDeviceSwitchOverVideoZoomFactors.first {
          device.videoZoomFactor = CGFloat(truncating: wide)
        }
        if device.isFocusModeSupported(.continuousAutoFocus) { device.focusMode = .continuousAutoFocus }
        if device.isExposureModeSupported(.continuousAutoExposure) { device.exposureMode = .continuousAutoExposure }
        device.unlockForConfiguration()
      }
    }
    if session.canAddOutput(photoOutput) {
      session.addOutput(photoOutput)
      photoOutput.maxPhotoQualityPrioritization = .quality
    }
    if let c = photoOutput.connection(with: .video), c.isVideoRotationAngleSupported(90) { c.videoRotationAngle = 90 }
    session.commitConfiguration()
    DispatchQueue.main.async {
      if let c = self.preview.connection, c.isVideoRotationAngleSupported(90) { c.videoRotationAngle = 90 }
    }
  }

  /// A tap on the picture focuses there, as in the Camera app.
  @objc private func focusTapped(_ g: UITapGestureRecognizer) {
    let at = g.location(in: view)
    guard frameRect.contains(at), let device else { return }
    let point = preview.captureDevicePointConverted(fromLayerPoint: view.layer.convert(at, to: preview))
    sessionQueue.async {
      guard (try? device.lockForConfiguration()) != nil else { return }
      if device.isFocusPointOfInterestSupported { device.focusPointOfInterest = point; device.focusMode = .autoFocus }
      if device.isExposurePointOfInterestSupported { device.exposurePointOfInterest = point; device.exposureMode = .autoExpose }
      device.unlockForConfiguration()
    }
  }

  // MARK: - Taking it

  @objc private func shoot() {
    guard !capturing else { return }
    capturing = true
    shutter.isEnabled = false
    UIImpactFeedbackGenerator(style: .medium).impactOccurred()
    UIView.animate(withDuration: 0.08, animations: { self.flash.alpha = 0.85 }) { _ in UIView.animate(withDuration: 0.3) { self.flash.alpha = 0 } }
    let settings = AVCapturePhotoSettings()
    settings.photoQualityPrioritization = .balanced
    photoOutput.capturePhoto(with: settings, delegate: self)
  }

  func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
    guard error == nil, let data = photo.fileDataRepresentation(), let raw = UIImage(data: data) else {
      DispatchQueue.main.async { self.capturing = false; self.shutter.isEnabled = true }
      return
    }
    DispatchQueue.main.async { self.process(raw) }
  }

  /// Cropped on a background queue — the paper found on the full photo, then perspective correction —
  /// with a spinner over the stopped camera meanwhile, then handed back.
  private func process(_ raw: UIImage) {
    sessionQueue.async { [session] in session.stopRunning() }
    shutter.isEnabled = false
    library.isEnabled = false
    working.startAnimating()
    DispatchQueue.global(qos: .userInitiated).async {
      let upright = Self.upright(raw)
      let image = Self.straightened(upright) ?? upright
      let result = Result { try Self.write(image) }
      DispatchQueue.main.async {
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        self.dismiss(animated: true) { self.finish(result) }
      }
    }
  }

  // MARK: - From the library

  /// A receipt photographed earlier, at the till: picked, then cropped exactly like a new photo.
  @objc private func pickFromLibrary() {
    guard !capturing else { return }
    var config = PHPickerConfiguration()
    config.filter = .images
    config.selectionLimit = 1
    let picker = PHPickerViewController(configuration: config)
    picker.delegate = self
    present(picker, animated: true)
  }

  func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
    picker.dismiss(animated: true)
    guard let provider = results.first?.itemProvider, provider.canLoadObject(ofClass: UIImage.self) else { return }
    capturing = true
    working.startAnimating()
    provider.loadObject(ofClass: UIImage.self) { object, _ in
      DispatchQueue.main.async {
        guard let image = object as? UIImage else {
          self.capturing = false
          self.working.stopAnimating()
          return
        }
        self.process(image)
      }
    }
  }

  /// The photo drawn upright, so pixel rows run the way the receipt reads.
  static func upright(_ image: UIImage) -> UIImage {
    if image.imageOrientation == .up { return image }
    let fmt = UIGraphicsImageRendererFormat.default(); fmt.scale = 1
    return UIGraphicsImageRenderer(size: CGSize(width: image.size.width * image.scale, height: image.size.height * image.scale), format: fmt).image { _ in
      image.draw(in: CGRect(origin: .zero, size: CGSize(width: image.size.width * image.scale, height: image.size.height * image.scale)))
    }
  }

  /// Cropped and squared up to the receipt's edges; nil when no receipt is found on the photo, and the
  /// photo is then kept whole — the reader copes with that far better than with a wrong crop.
  static func straightened(_ image: UIImage) -> UIImage? {
    guard let cg = image.cgImage, let out = receiptCrop(cg) else { return nil }
    return UIImage(cgImage: out)
  }

  /// The paper on the photo, squared up. Document segmentation first; failing that, the largest
  /// rectangle (a receipt on a pale table has a weak outline but straight edges). A find covering
  /// less than a tenth of the picture is a label or a card on the receipt, not the receipt, and is
  /// ignored. UIKit-free, so `scripts/receipt-parse` can run it on a Mac.
  static func receiptCrop(_ cg: CGImage) -> CGImage? {
    func area(_ q: VNRectangleObservation) -> CGFloat {
      let p = [q.topLeft, q.topRight, q.bottomRight, q.bottomLeft]
      return abs((0..<4).reduce(0) { $0 + p[$1].x * p[($1 + 1) % 4].y - p[($1 + 1) % 4].x * p[$1].y }) / 2
    }
    let handler = VNImageRequestHandler(cgImage: cg, orientation: .up)
    let doc = VNDetectDocumentSegmentationRequest()
    let rect = VNDetectRectanglesRequest()
    rect.minimumAspectRatio = 0.08
    rect.maximumAspectRatio = 1
    rect.minimumSize = 0.25
    rect.quadratureTolerance = 25
    rect.minimumConfidence = 0.6
    rect.maximumObservations = 4
    try? handler.perform([doc, rect])
    let candidates = (doc.results?.filter { $0.confidence > 0.5 } ?? []) + (rect.results?.sorted { area($0) > area($1) } ?? [])
    guard let q = candidates.first(where: { area($0) >= 0.1 }), area(q) < 0.97 else { return nil }
    let ci = CIImage(cgImage: cg)
    let w = ci.extent.width, h = ci.extent.height
    let filter = CIFilter.perspectiveCorrection()
    filter.inputImage = ci
    // Vision and Core Image share the bottom-left origin; only the scale differs.
    filter.topLeft = CGPoint(x: q.topLeft.x * w, y: q.topLeft.y * h)
    filter.topRight = CGPoint(x: q.topRight.x * w, y: q.topRight.y * h)
    filter.bottomLeft = CGPoint(x: q.bottomLeft.x * w, y: q.bottomLeft.y * h)
    filter.bottomRight = CGPoint(x: q.bottomRight.x * w, y: q.bottomRight.y * h)
    guard let out = filter.outputImage, out.extent.width > 200, out.extent.height > 200 else { return nil }
    return CIContext().createCGImage(out, from: out.extent)
  }

  @objc private func cancel() {
    dismiss(animated: true) { self.finish(.success(nil)) }
  }

  private func finish(_ r: Result<String?, Error>) {
    done(r)
    Self.current = nil
  }

  /// No wider than 1800 px: receipt print stays sharp for the reader without a photo of several megabytes.
  static func write(_ image: UIImage?) throws -> String? {
    guard let image else { throw Failure.noImage }
    let maxWidth: CGFloat = 1800
    let px = CGSize(width: image.size.width * image.scale, height: image.size.height * image.scale)
    let scale = min(1, maxWidth / max(px.width, 1))
    let size = CGSize(width: px.width * scale, height: px.height * scale)
    let fmt = UIGraphicsImageRendererFormat.default(); fmt.scale = 1; fmt.opaque = true
    let resized = UIGraphicsImageRenderer(size: size, format: fmt).image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
    guard let data = resized.jpegData(compressionQuality: 0.75) else { throw Failure.noImage }
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("scan-\(UUID().uuidString.prefix(8)).jpg")
    try data.write(to: url)
    return url.absoluteString
  }
}
