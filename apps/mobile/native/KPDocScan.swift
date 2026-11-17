import AVFoundation
import CoreImage
import CoreImage.CIFilterBuiltins
import UIKit
import Vision

/// The receipt camera: one picture, then a look at it and Continue.
///
/// While aiming, Vision's document detection outlines the paper on the live picture; once the outline
/// has held still for a moment the picture is taken by itself (the shutter is there for anyone faster).
/// The photo is straightened to the receipt's edges — which is what lets the text reader (KPReceipt)
/// read small print a hand-held snapshot loses — and shown with Retake and Continue. Continue writes it
/// to a temporary file; the entry sheet keeps it on save (DATA.md rule 4).
///
/// It replaced the system document camera, which collects any number of pages and ends on its own
/// Save: a receipt is one picture, and what to do with it is the next question, not a page count.
final class KPDocScan: UIViewController, AVCaptureVideoDataOutputSampleBufferDelegate, AVCapturePhotoCaptureDelegate {
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
  private let videoOutput = AVCaptureVideoDataOutput()
  private let videoQueue = DispatchQueue(label: "dev.kopiyka.receipt-camera")
  private let preview = AVCaptureVideoPreviewLayer()
  private let outline = CAShapeLayer()
  private let hint = UILabel()
  private let shutter = UIButton(type: .custom)
  private let close = UIButton(type: .system)
  private let flash = UIView()

  // Detection state, touched on the video queue only.
  private var lastQuad: VNRectangleObservation?
  private var steadyFrames = 0
  private var lastRun = Date.distantPast
  private var capturing = false

  // What was taken: the photo, and the receipt's corners on it when they were found.
  private var shot: UIImage?

  override var prefersStatusBarHidden: Bool { true }
  override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .portrait }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .black
    preview.session = session
    preview.videoGravity = .resizeAspectFill
    view.layer.addSublayer(preview)

    outline.fillColor = UIColor.systemBlue.withAlphaComponent(0.18).cgColor
    outline.strokeColor = UIColor.white.cgColor
    outline.lineWidth = 3
    outline.lineJoin = .round
    outline.opacity = 0
    view.layer.addSublayer(outline)

    hint.text = L10n.Receipt.Scan.hint
    hint.textColor = .white
    hint.font = .systemFont(ofSize: 16, weight: .semibold)
    hint.textAlignment = .center
    hint.backgroundColor = UIColor.black.withAlphaComponent(0.55)
    hint.layer.cornerRadius = 16
    hint.layer.masksToBounds = true
    view.addSubview(hint)

    shutter.backgroundColor = .white
    shutter.layer.cornerRadius = 36
    shutter.layer.borderWidth = 5
    shutter.layer.borderColor = UIColor.white.withAlphaComponent(0.45).cgColor
    shutter.accessibilityLabel = L10n.Receipt.Scan.hint
    shutter.addTarget(self, action: #selector(shoot), for: .touchUpInside)
    view.addSubview(shutter)

    close.setImage(UIImage(systemName: "xmark", withConfiguration: UIImage.SymbolConfiguration(pointSize: 17, weight: .semibold)), for: .normal)
    close.tintColor = .white
    close.backgroundColor = UIColor.black.withAlphaComponent(0.45)
    close.layer.cornerRadius = 20
    close.accessibilityLabel = L10n.Receipt.Scan.close
    close.addTarget(self, action: #selector(cancel), for: .touchUpInside)
    view.addSubview(close)

    flash.backgroundColor = .white
    flash.alpha = 0
    flash.isUserInteractionEnabled = false
    view.addSubview(flash)

    configureSession()
  }

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    let b = view.bounds, safe = view.safeAreaInsets
    preview.frame = b
    outline.frame = b
    flash.frame = b
    close.frame = CGRect(x: 16, y: safe.top + 8, width: 40, height: 40)
    shutter.frame = CGRect(x: b.midX - 36, y: b.maxY - max(safe.bottom, 16) - 24 - 72, width: 72, height: 72)
    let size = hint.sizeThatFits(CGSize(width: b.width - 64, height: 40))
    hint.frame = CGRect(x: b.midX - (size.width + 28) / 2, y: shutter.frame.minY - 24 - 34, width: size.width + 28, height: 34)
  }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    videoQueue.async { [session] in if !session.isRunning { session.startRunning() } }
  }

  override func viewWillDisappear(_ animated: Bool) {
    super.viewWillDisappear(animated)
    videoQueue.async { [session] in if session.isRunning { session.stopRunning() } }
  }

  private func configureSession() {
    session.beginConfiguration()
    session.sessionPreset = .photo
    if let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
       let input = try? AVCaptureDeviceInput(device: device), session.canAddInput(input) {
      session.addInput(input)
      if (try? device.lockForConfiguration()) != nil {
        if device.isFocusModeSupported(.continuousAutoFocus) { device.focusMode = .continuousAutoFocus }
        if device.isAutoFocusRangeRestrictionSupported { device.autoFocusRangeRestriction = .near }
        device.unlockForConfiguration()
      }
    }
    if session.canAddOutput(photoOutput) { session.addOutput(photoOutput) }
    videoOutput.alwaysDiscardsLateVideoFrames = true
    videoOutput.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
    videoOutput.setSampleBufferDelegate(self, queue: videoQueue)
    if session.canAddOutput(videoOutput) { session.addOutput(videoOutput) }
    // Portrait buffers, so what Vision finds needs no turning before it is drawn.
    for c in [videoOutput.connection(with: .video), photoOutput.connection(with: .video)].compactMap({ $0 }) where c.isVideoRotationAngleSupported(90) {
      c.videoRotationAngle = 90
    }
    session.commitConfiguration()
  }

  // MARK: - Finding the receipt

  func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
    guard !capturing, Date().timeIntervalSince(lastRun) > 0.12, let pixels = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
    lastRun = Date()
    let request = VNDetectDocumentSegmentationRequest()
    try? VNImageRequestHandler(cvPixelBuffer: pixels, orientation: .up).perform([request])
    let quad = request.results?.first.flatMap { $0.confidence > 0.6 ? $0 : nil }
    let size = CGSize(width: CVPixelBufferGetWidth(pixels), height: CVPixelBufferGetHeight(pixels))
    // Steady: the corners have moved less than ~2% of the picture since the last look.
    if let q = quad, let last = lastQuad, Self.moved(q, last) < 0.02 { steadyFrames += 1 } else { steadyFrames = 0 }
    lastQuad = quad
    let steady = steadyFrames
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      self.draw(quad, imageSize: size, steady: steady)
      if steady >= 7, !self.capturing { self.shoot() }
    }
  }

  private static func moved(_ a: VNRectangleObservation, _ b: VNRectangleObservation) -> CGFloat {
    let pa = [a.topLeft, a.topRight, a.bottomRight, a.bottomLeft], pb = [b.topLeft, b.topRight, b.bottomRight, b.bottomLeft]
    return zip(pa, pb).map { hypot($0.x - $1.x, $0.y - $1.y) }.max() ?? 1
  }

  /// A normalized Vision point (origin bottom-left) on the screen, under the aspect-fill preview.
  private func screenPoint(_ p: CGPoint, imageSize: CGSize) -> CGPoint {
    let b = view.bounds
    let scale = max(b.width / imageSize.width, b.height / imageSize.height)
    let w = imageSize.width * scale, h = imageSize.height * scale
    return CGPoint(x: p.x * w - (w - b.width) / 2, y: (1 - p.y) * h - (h - b.height) / 2)
  }

  private func draw(_ quad: VNRectangleObservation?, imageSize: CGSize, steady: Int) {
    guard let q = quad else {
      outline.opacity = 0
      hint.text = L10n.Receipt.Scan.hint
      viewDidLayoutSubviews()
      return
    }
    let path = UIBezierPath()
    path.move(to: screenPoint(q.topLeft, imageSize: imageSize))
    for p in [q.topRight, q.bottomRight, q.bottomLeft] { path.addLine(to: screenPoint(p, imageSize: imageSize)) }
    path.close()
    outline.path = path.cgPath
    outline.opacity = 1
    // Turning green as it settles says the picture is about to be taken.
    let ready = steady >= 3
    outline.strokeColor = (ready ? UIColor.systemGreen : UIColor.white).cgColor
    outline.fillColor = (ready ? UIColor.systemGreen : UIColor.systemBlue).withAlphaComponent(0.18).cgColor
    let text = ready ? L10n.Receipt.Scan.hold : L10n.Receipt.Scan.hint
    if hint.text != text { hint.text = text; viewDidLayoutSubviews() }
  }

  // MARK: - Taking it

  @objc private func shoot() {
    guard !capturing else { return }
    capturing = true
    UIImpactFeedbackGenerator(style: .medium).impactOccurred()
    UIView.animate(withDuration: 0.08, animations: { self.flash.alpha = 0.85 }) { _ in UIView.animate(withDuration: 0.3) { self.flash.alpha = 0 } }
    let settings = AVCapturePhotoSettings()
    photoOutput.capturePhoto(with: settings, delegate: self)
  }

  func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
    guard error == nil, let data = photo.fileDataRepresentation(), let raw = UIImage(data: data) else {
      DispatchQueue.main.async { self.capturing = false }
      return
    }
    // Straightened on a background queue: detection on the full photo, then perspective correction.
    DispatchQueue.global(qos: .userInitiated).async {
      let image = Self.straightened(Self.upright(raw)) ?? Self.upright(raw)
      DispatchQueue.main.async { self.review(image) }
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

  /// Cropped and squared up to the receipt's edges; nil when no receipt is found on the photo.
  static func straightened(_ image: UIImage) -> UIImage? {
    guard let cg = image.cgImage else { return nil }
    let request = VNDetectDocumentSegmentationRequest()
    try? VNImageRequestHandler(cgImage: cg, orientation: .up).perform([request])
    guard let q = request.results?.first, q.confidence > 0.5 else { return nil }
    let ci = CIImage(cgImage: cg)
    let w = ci.extent.width, h = ci.extent.height
    let filter = CIFilter.perspectiveCorrection()
    filter.inputImage = ci
    // Vision and Core Image share the bottom-left origin; only the scale differs.
    filter.topLeft = CGPoint(x: q.topLeft.x * w, y: q.topLeft.y * h)
    filter.topRight = CGPoint(x: q.topRight.x * w, y: q.topRight.y * h)
    filter.bottomLeft = CGPoint(x: q.bottomLeft.x * w, y: q.bottomLeft.y * h)
    filter.bottomRight = CGPoint(x: q.bottomRight.x * w, y: q.bottomRight.y * h)
    guard let out = filter.outputImage, out.extent.width > 100, out.extent.height > 100,
          let result = CIContext().createCGImage(out, from: out.extent) else { return nil }
    return UIImage(cgImage: result)
  }

  // MARK: - Looking at it

  private var reviewView: UIView?

  private func review(_ image: UIImage) {
    shot = image
    videoQueue.async { [session] in session.stopRunning() }
    let pane = UIView(frame: view.bounds)
    pane.backgroundColor = .black
    let imageView = UIImageView(image: image)
    imageView.contentMode = .scaleAspectFit
    let safe = view.safeAreaInsets
    let barHeight: CGFloat = 52
    let bottom = view.bounds.maxY - max(safe.bottom, 16) - 12
    imageView.frame = CGRect(x: 16, y: safe.top + 12, width: view.bounds.width - 32, height: bottom - barHeight - 16 - safe.top - 12)
    pane.addSubview(imageView)

    let retake = Self.button(L10n.Receipt.Scan.retake, filled: false)
    retake.addTarget(self, action: #selector(retakeTapped), for: .touchUpInside)
    let next = Self.button(L10n.Receipt.Scan.continue, filled: true)
    next.addTarget(self, action: #selector(continueTapped), for: .touchUpInside)
    let width = (view.bounds.width - 16 * 3) / 2
    retake.frame = CGRect(x: 16, y: bottom - barHeight, width: width, height: barHeight)
    next.frame = CGRect(x: 32 + width, y: bottom - barHeight, width: width, height: barHeight)
    pane.addSubview(retake)
    pane.addSubview(next)

    // The page settles into place: a little larger and clear, then as it is.
    pane.alpha = 0
    imageView.transform = CGAffineTransform(scaleX: 1.06, y: 1.06)
    view.addSubview(pane)
    reviewView = pane
    UIView.animate(withDuration: 0.35, delay: 0, usingSpringWithDamping: 0.85, initialSpringVelocity: 0) {
      pane.alpha = 1
      imageView.transform = .identity
    }
    UINotificationFeedbackGenerator().notificationOccurred(.success)
  }

  private static func button(_ title: String, filled: Bool) -> UIButton {
    var config = filled ? UIButton.Configuration.filled() : UIButton.Configuration.gray()
    config.title = title
    config.cornerStyle = .capsule
    config.baseBackgroundColor = filled ? .systemBlue : UIColor.white.withAlphaComponent(0.18)
    config.baseForegroundColor = .white
    config.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { a in
      var a = a; a.font = .systemFont(ofSize: 17, weight: .semibold); return a
    }
    return UIButton(configuration: config)
  }

  @objc private func retakeTapped() {
    UIView.animate(withDuration: 0.2, animations: { self.reviewView?.alpha = 0 }) { _ in
      self.reviewView?.removeFromSuperview()
      self.reviewView = nil
    }
    shot = nil
    lastQuad = nil
    steadyFrames = 0
    outline.opacity = 0
    capturing = false
    videoQueue.async { [session] in session.startRunning() }
  }

  @objc private func continueTapped() {
    let result = Result { try Self.write(shot) }
    dismiss(animated: true) { self.finish(result) }
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
