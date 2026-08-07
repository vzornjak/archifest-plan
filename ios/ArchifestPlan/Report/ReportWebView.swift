// ReportWebView — shows the EXACT same report the browser produces, in a
// WKWebView pointed at the bundled copy of index.html/app.js/geometry.js/
// style.css (copied in verbatim by the Run Script build phase in
// project.yml — see CLAUDE.md's iOS section). None of those four files are
// edited for the app: same file:// loading shape the CSP (index.html:12) was
// designed around, same maths, same report.
//
// The only native-side addition is a `window.print` override, injected as a
// WKUserScript rather than by editing app.js, so the shared files stay
// byte-identical between browser and app.
import SwiftUI
import WebKit

struct ReportWebView: UIViewRepresentable {
  let name: String
  let scanJSON: Data
  let metaJSON: Data?

  func makeCoordinator() -> Coordinator { Coordinator() }

  func makeUIView(context: Context) -> WKWebView {
    let controller = WKUserContentController()
    controller.add(context.coordinator, name: "nativePrint")
    controller.addUserScript(WKUserScript(
      source: "window.print = function(){ window.webkit.messageHandlers.nativePrint.postMessage(null); };",
      injectionTime: .atDocumentStart,
      forMainFrameOnly: true
    ))

    let config = WKWebViewConfiguration()
    config.userContentController = controller

    let webView = WKWebView(frame: .zero, configuration: config)
    webView.navigationDelegate = context.coordinator
    context.coordinator.webView = webView
    context.coordinator.name = name
    context.coordinator.scanJSON = scanJSON
    context.coordinator.metaJSON = metaJSON

    guard
      let indexURL = Bundle.main.url(forResource: "index", withExtension: "html"),
      let resourceRoot = Bundle.main.resourceURL
    else {
      assertionFailure("index.html missing from the bundle — check the Run Script build phase in project.yml")
      return webView
    }
    webView.loadFileURL(indexURL, allowingReadAccessTo: resourceRoot)
    return webView
  }

  func updateUIView(_ webView: WKWebView, context: Context) {}

  @MainActor
  final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
    weak var webView: WKWebView?
    var name = ""
    var scanJSON: Data?
    var metaJSON: Data?

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
      Task { await injectScan() }
    }

    // Replicates handleFiles' classification order (app.js:60-78): clear a
    // stale window.__meta before applying a scan that has none of its own,
    // apply meta first with scanFollows=true, then apply the scan — same
    // order the browser's own file-picker path uses, so there's exactly one
    // code path for "what happens when a scan + optional meta arrive".
    private func injectScan() async {
      guard let webView, let scanJSON else { return }
      do {
        let scanObject = try JSONSerialization.jsonObject(with: scanJSON)
        let metaObject = try metaJSON.map { try JSONSerialization.jsonObject(with: $0) }

        let body = """
        if (!metaJSON) { window.__meta = null; }
        if (metaJSON) { applyMeta(metaJSON, !!scanJSON); }
        if (scanJSON) { applyScan(name, scanJSON); }
        """
        _ = try await webView.callAsyncJavaScript(
          body,
          arguments: [
            "name": name,
            "scanJSON": scanObject,
            "metaJSON": metaObject as Any,
          ],
          contentWorld: .page
        )
      } catch {
        assertionFailure("failed to inject scan into report: \(error)")
      }
    }

    // MARK: - window.print() -> native PDF

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
      guard message.name == "nativePrint", let webView else { return }
      Task { await exportAndSharePDF(webView) }
    }

    private func exportAndSharePDF(_ webView: WKWebView) async {
      do {
        // The existing @media print stylesheet (style.css:134-162) is already
        // tuned for a light printable page, so createPDF against the current
        // DOM reuses it with no extra work.
        let data = try await webView.pdf(configuration: .init())
        presentShareSheet(for: data)
      } catch {
        assertionFailure("PDF export failed: \(error)")
      }
    }

    private func presentShareSheet(for pdfData: Data) {
      let tmpURL = FileManager.default.temporaryDirectory
        .appendingPathComponent("izvjestaj-\(Int(Date().timeIntervalSince1970))")
        .appendingPathExtension("pdf")
      do {
        try pdfData.write(to: tmpURL)
      } catch {
        assertionFailure("could not write temp PDF: \(error)")
        return
      }
      let activity = UIActivityViewController(activityItems: [tmpURL], applicationActivities: nil)
      UIApplication.shared.connectedScenes
        .compactMap { $0 as? UIWindowScene }
        .flatMap(\.windows)
        .first(where: \.isKeyWindow)?
        .rootViewController?
        .present(activity, animated: true)
    }
  }
}
