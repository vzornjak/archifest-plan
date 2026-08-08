// PlanThumbnailRenderer — rasterises PlanView to the portrait PNG stored
// inside a .archifp and shown as the file's thumbnail (see the
// ThumbnailProvider extension target).
//
// This used to drive the real web report in an offscreen WKWebView and
// snapshot the SVG out of it. That worked, but it was a lot of moving parts
// for a picture — a page load, JS injection, CSS surgery to hide the report
// chrome, and a snapshot rect — and it produced a silently *blank* image in
// three different ways before it worked (a tall web view doesn't paint its
// full height; takeSnapshot renders a view with its alpha, so hiding the web
// view with alpha 0 gave a transparent image; a mis-measured rect captured
// nothing). Drawing natively removes every one of those failure modes: the
// plan is now just a SwiftUI view, and this is one call.
import SwiftUI
import UIKit
import os

@MainActor
enum PlanThumbnailRenderer {
  private static let log = Logger(subsystem: "hr.archifest.plan", category: "thumbnail")

  /// Portrait canvas, 3:4 — big enough to stay sharp on the largest tile the
  /// document browser shows.
  private static let canvasSize = CGSize(width: 768, height: 1024)

  /// Renders the plan for `scanJSON` to a portrait PNG. Returns nil rather
  /// than throwing — a missing thumbnail is cosmetic and must never be a
  /// reason a scan fails to save.
  static func render(scanJSON: Data, metaJSON: Data?) -> Data? {
    guard let scan = PlanGeometry.parse(scanJSON: scanJSON) else {
      log.error("scan has no walls to draw — skipping thumbnail")
      return nil
    }

    let heading = metaJSON
      .flatMap { try? JSONDecoder().decode(ScanMeta.self, from: $0) }
      .map(\.headingDegrees)

    let renderer = ImageRenderer(
      content: PlanView(scan: scan, headingDegrees: heading)
        .frame(width: canvasSize.width, height: canvasSize.height)
    )
    // 1x: the canvas is already 768x1024, comfortably above any tile the
    // document browser shows. At 2x the PNG came out ~1MB per scan, which is
    // a lot of derived data to carry inside every .archifp for no visible
    // gain.
    renderer.scale = 1

    guard let image = renderer.uiImage else {
      log.error("ImageRenderer produced no image for the plan thumbnail")
      return nil
    }
    return image.pngData()
  }
}
