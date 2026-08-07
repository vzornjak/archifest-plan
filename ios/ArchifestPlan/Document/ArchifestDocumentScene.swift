// ArchifestDocumentScene — what DocumentGroup shows for one open document.
// A brand-new (empty) document IS the "new scan" flow now: DocumentGroup's
// own "+" already created it, so there's no separate "Nova snimka" button
// or name-entry step — tap + in the document browser and you're straight
// into capture, the same "+  -> straight into a new document" feel Numbers
// has. A document that already has scan data (opened from our own .archifp
// or a loose scan.json/meta.json) goes straight to the report.
import SwiftUI
import RoomPlan

struct ArchifestDocumentScene: View {
  @Binding var document: ArchifestDocument

  var body: some View {
    if let scan = document.scan {
      ReportScreen(name: document.name, scan: scan, meta: document.meta)
    } else if RoomCaptureSession.isSupported {
      CaptureScreen(projectName: document.name) { scan, meta, name in
        document.name = name
        document.scan = scan
        document.meta = meta
      }
    } else {
      UnsupportedCaptureView(onLoadSample: loadSample)
    }
  }

  // The only way to populate a new document in Simulator (no LiDAR, so
  // RoomCaptureSession.isSupported is false there) — also handy for anyone
  // trying the app before they've walked a room. Loads the same bundled
  // fixture the base app's debug path used.
  private func loadSample() {
    guard
      let scanURL = Bundle.main.url(forResource: "sample-scan", withExtension: "json"),
      let metaURL = Bundle.main.url(forResource: "sample-scan-meta", withExtension: "json"),
      let scan = try? Data(contentsOf: scanURL),
      let meta = try? Data(contentsOf: metaURL)
    else {
      assertionFailure("bundled sample-scan.json / sample-scan-meta.json missing — check Fixtures resources in project.yml")
      return
    }
    document.name = "uzorak"
    document.scan = scan
    document.meta = meta
  }
}

private struct UnsupportedCaptureView: View {
  let onLoadSample: () -> Void

  var body: some View {
    VStack(spacing: 20) {
      Spacer()
      Text("RoomPlan nije podržan na ovom uređaju — potreban je LiDAR skener (npr. iPhone 12 Pro ili noviji, iPad Pro s LiDAR-om).")
        .font(.footnote)
        .foregroundStyle(.secondary)
        .multilineTextAlignment(.center)
        .padding(.horizontal)
      Button("Učitaj uzorak", action: onLoadSample)
        .buttonStyle(.borderedProminent)
      Spacer()
    }
    .padding()
  }
}
