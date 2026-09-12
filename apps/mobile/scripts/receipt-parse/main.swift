import Foundation
import Vision
import AppKit
let path = CommandLine.arguments[1]
guard let img = NSImage(contentsOfFile: path), let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else { print("no image"); exit(1) }
let sem = DispatchSemaphore(value: 0)
Task {
  var req = RecognizeTextRequest(); req.recognitionLevel = .accurate; req.usesLanguageCorrection = true; req.automaticallyDetectsLanguage = true
  let obs = try await req.perform(on: cg)
  struct Box { let text: String; let rect: CGRect }
  let boxes = obs.compactMap { o -> Box? in guard let t = o.topCandidates(1).first?.string.trimmingCharacters(in: .whitespaces), !t.isEmpty else { return nil }; return Box(text: t, rect: o.boundingBox.cgRect) }.sorted { $0.rect.midY > $1.rect.midY }
  var rows: [[Box]] = []
  for b in boxes { if let last = rows.last?.first, abs(last.rect.midY - b.rect.midY) < max(last.rect.height, b.rect.height) * 0.6 { rows[rows.count - 1].append(b) } else { rows.append([b]) } }
  let lines = rows.map { $0.sorted { $0.rect.minX < $1.rect.minX }.map(\.text).joined(separator: "  ") }
  var p = KPReceiptText.isFiscal(lines) ? KPReceiptText.fiscal(lines: lines) ?? KPReceiptText.heuristic(lines: lines) : KPReceiptText.heuristic(lines: lines)
  p.summary = KPReceiptText.summary(p)
  print("method=\(p.method) merchant=\(p.merchant) total=\(p.total) paid=\(String(describing: p.paid)) currency=\(p.currency ?? "-") date=\(p.date ?? "-")")
  for i in p.items { print("  item: \(i.name) = \(i.price)") }
  print("summary: \(p.summary)")
  sem.signal()
}
sem.wait()
