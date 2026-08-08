// PlanThumbnailRenderer — renders the floor plan to a portrait PNG that gets
// stored inside the .archifp and shown as the file's thumbnail in the
// document browser and Files (see the ThumbnailProvider extension target).
//
// Why render here and store the result, rather than have the thumbnail
// extension draw it on demand:
//   - The plan is drawn by app.js. Reproducing that drawing natively would
//     mean two sources of truth for the same picture, which is exactly what
//     the "geometry.js is the engine" rule exists to prevent.
//   - Running a WKWebView inside a Quick Look thumbnail extension means
//     doing an async page load + JS execution inside a process with a tight
//     time and memory budget. Doing it once here, in the app, and handing
//     the extension a ready-made image keeps that extension trivial.
//
// The plan is drawn WITHOUT dimension lines or measurements ("bez kota") and
// always in portrait, regardless of how the report itself is being viewed.
import UIKit
import WebKit
import os

@MainActor
enum PlanThumbnailRenderer {
  private static let log = Logger(subsystem: "hr.archifest.plan", category: "thumbnail")

  /// Portrait canvas the plan is centred on. 3:4, big enough to stay sharp
  /// on the largest tile the document browser shows.
  private static let canvasSize = CGSize(width: 768, height: 1024)

  /// Narrow enough that the report lays out in its single-column (phone)
  /// form. Height only needs to fit the plan itself, because everything
  /// around it is hidden before snapshotting — see the CSS below. It must
  /// stay a plausible on-screen size: WKWebView paints tile-by-tile around
  /// the viewport, so content far below it simply isn't drawn, and an
  /// earlier version with a 2400pt-tall view snapshotted a blank rectangle.
  private static let webViewSize = CGSize(width: 500, height: 900)

  /// `--bg` from style.css — so the padding around the plan matches the
  /// report instead of sitting on an unrelated colour.
  private static let backgroundColor = UIColor(red: 0x0A / 255, green: 0x19 / 255, blue: 0x29 / 255, alpha: 1)

  /// Renders `scanJSON` (plus optional `metaJSON`) to a portrait PNG.
  /// Returns nil rather than throwing — a missing thumbnail is a cosmetic
  /// loss, never a reason to fail saving a scan.
  static func render(scanJSON: Data, metaJSON: Data?) async -> Data? {
    guard
      let indexURL = Bundle.main.url(forResource: "index", withExtension: "html"),
      let resourceRoot = Bundle.main.resourceURL
    else {
      log.error("index.html missing from the bundle — cannot render plan thumbnail")
      return nil
    }

    let webView = WKWebView(frame: CGRect(origin: .zero, size: webViewSize))
    // Offscreen but in the hierarchy: WKWebView will not lay out or paint
    // reliably while detached, and takeSnapshot needs real painted content.
    if let window = UIApplication.shared.connectedScenes
      .compactMap({ $0 as? UIWindowScene })
      .flatMap(\.windows)
      .first(where: \.isKeyWindow) {
      // Full opacity, hidden by being the bottom-most subview so the app's
      // own UI covers it. NOT alpha 0 (or near-0): takeSnapshot renders the
      // view *with* its alpha, so a transparent view snapshots to a
      // transparent image — which is exactly how two earlier attempts here
      // produced a blank tile while every other diagnostic said the plan had
      // drawn correctly.
      webView.isUserInteractionEnabled = false
      window.insertSubview(webView, at: 0)
    }
    defer { webView.removeFromSuperview() }

    let loader = NavigationLoader()
    webView.navigationDelegate = loader

    do {
      webView.loadFileURL(indexURL, allowingReadAccessTo: resourceRoot)
      try await loader.waitForLoad()

      let scanObject = try JSONSerialization.jsonObject(with: scanJSON)
      let metaObject = try metaJSON.map { try JSONSerialization.jsonObject(with: $0) }

      // Same injection order as ReportWebView / handleFiles (app.js:60-78).
      _ = try await webView.callAsyncJavaScript(
        """
        if (!metaJSON) { window.__meta = null; }
        if (metaJSON) { applyMeta(metaJSON, !!scanJSON); }
        if (scanJSON) { applyScan('plan', scanJSON); }
        """,
        arguments: [
          "scanJSON": scanObject,
          "metaJSON": metaObject as Any,
        ],
        contentWorld: .page
      )

      // Strip everything around the plan so it sits at the very top of the
      // page — both because the thumbnail should be the drawing alone, and
      // because it's what keeps the plan inside the painted viewport.
      // Dimension lines/labels go too ("bez kota"); scoped to #plan-svg on
      // purpose, since .sv-dimtxt is also used by the compass rose, which is
      // a separate SVG we aren't touching.
      _ = try await webView.callAsyncJavaScript(
        """
        const style = document.createElement('style');
        style.textContent = `
          body { padding: 0 !important; }
          .sheet { border: none !important; padding: 0 !important; }
          .titleblock, #uploadArea, .footnote,
          .corner-tl, .corner-tr, .corner-bl, .corner-br { display: none !important; }
          .layout > *:not(#plan-wrap) { display: none !important; }
          #plan-wrap { margin: 0 !important; border: none !important; }
          #plan-wrap h2, #plan-wrap .legend-row { display: none !important; }
          #plan-svg .sv-dim, #plan-svg .sv-dimtxt { display: none !important; }
        `;
        document.head.appendChild(style);
        const land = document.getElementById('landToggle');
        if (land) { land.checked = false; land.dispatchEvent(new Event('change')); }
        window.scrollTo(0, 0);
        """,
        contentWorld: .page
      )

      // One runloop turn for the re-render triggered by the toggle above.
      try await Task.sleep(for: .milliseconds(250))

      // Clamped to the view's bounds: a rect extending past the painted area
      // snapshots as blank, which is exactly how the first version of this
      // silently produced an empty tile.
      let rect = try await planRect(in: webView)
        .intersection(CGRect(origin: .zero, size: webViewSize))
      guard rect.width > 1, rect.height > 1 else {
        log.error("plan element has no drawable size — skipping thumbnail")
        return nil
      }

      let config = WKSnapshotConfiguration()
      config.rect = rect
      let snapshot = try await webView.takeSnapshot(configuration: config)
      return portraitPNG(from: snapshot)
    } catch {
      log.error("plan thumbnail render failed: \(error.localizedDescription, privacy: .public)")
      return nil
    }
  }

  private static func planRect(in webView: WKWebView) async throws -> CGRect {
    let result = try await webView.callAsyncJavaScript(
      """
      const el = document.getElementById('plan-svg');
      if (!el) { return null; }
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
      """,
      contentWorld: .page
    )
    guard
      let dict = result as? [String: Any],
      let x = dict["x"] as? Double, let y = dict["y"] as? Double,
      let w = dict["width"] as? Double, let h = dict["height"] as? Double
    else { return .zero }
    return CGRect(x: x, y: y, width: w, height: h)
  }

  /// Centres the plan on a portrait canvas — "always portrait" regardless of
  /// the plan's own proportions, which is the whole point of the thumbnail
  /// being generated rather than screenshotted.
  private static func portraitPNG(from image: UIImage) -> Data? {
    let renderer = UIGraphicsImageRenderer(size: canvasSize)
    let output = renderer.image { context in
      backgroundColor.setFill()
      context.fill(CGRect(origin: .zero, size: canvasSize))

      let inset: CGFloat = 48
      let available = CGSize(width: canvasSize.width - inset * 2, height: canvasSize.height - inset * 2)
      let scale = min(available.width / image.size.width, available.height / image.size.height)
      let drawn = CGSize(width: image.size.width * scale, height: image.size.height * scale)
      image.draw(in: CGRect(
        x: (canvasSize.width - drawn.width) / 2,
        y: (canvasSize.height - drawn.height) / 2,
        width: drawn.width,
        height: drawn.height
      ))
    }
    return output.pngData()
  }
}

/// Bridges WKNavigationDelegate's "page finished" callback to async/await.
private final class NavigationLoader: NSObject, WKNavigationDelegate {
  private var continuation: CheckedContinuation<Void, Error>?
  private var finished = false

  func waitForLoad() async throws {
    if finished { return }
    try await withCheckedThrowingContinuation { continuation in
      self.continuation = continuation
    }
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    finished = true
    continuation?.resume()
    continuation = nil
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    continuation?.resume(throwing: error)
    continuation = nil
  }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    continuation?.resume(throwing: error)
    continuation = nil
  }
}
