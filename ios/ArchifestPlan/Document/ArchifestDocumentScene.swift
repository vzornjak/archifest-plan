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
  let fileURL: URL?

  var body: some View {
    if let scan = document.scan {
      ReportScreen(name: document.name, scan: scan, meta: document.meta, fileURL: fileURL)
    } else if document.source == .new {
      // Only a genuinely brand-new, never-populated document reaches
      // capture. `scan == nil` is NOT enough on its own to mean "new" — an
      // opened standalone meta.json (or a broken .archifp) also has a nil
      // scan, and used to fall through to here too, silently launching
      // RoomPlan on a file that was never meant to be captured into. Fixed
      // by checking `document.source` (already tracked, just wasn't
      // consulted here) alongside `scan`.
      if RoomCaptureSession.isSupported {
        CaptureScreen(projectName: document.name) { scan, meta, planImage, name in
          document.name = name
          document.scan = scan
          document.meta = meta
          document.planImage = planImage
        }
      } else {
        UnsupportedCaptureView(onLoadSample: loadSample)
      }
    } else {
      NoScanDataView(meta: document.meta)
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

// Shown for a file that was actually opened (not a fresh document) but
// turned out to have no scan data in it — a standalone meta.json shared
// without its scan.json, or a corrupted/unexpected .archifp. Never starts
// a capture session; that would silently launch RoomPlan on the wrong
// trigger, exactly the bug this view exists to avoid.
private struct NoScanDataView: View {
  let meta: Data?

  private var decodedMeta: ScanMeta? {
    meta.flatMap { try? JSONDecoder().decode(ScanMeta.self, from: $0) }
  }

  var body: some View {
    VStack(spacing: 16) {
      Spacer()
      Image(systemName: "doc.questionmark")
        .font(.system(size: 40))
        .foregroundStyle(.secondary)
      Text("Ovaj fajl ne sadrži RoomPlan sken")
        .font(.headline)
      if let decodedMeta {
        VStack(spacing: 4) {
          Text("Pronađen je samo meta.json.")
            .font(.footnote)
            .foregroundStyle(.secondary)
          if let name = decodedMeta.name, !name.isEmpty {
            Text(name).font(.subheadline)
          }
          Text(String(format: "Kompas: %.1f°", decodedMeta.headingDegrees))
            .font(.footnote)
            .foregroundStyle(.secondary)
        }
      } else {
        Text("Fajl je učitan, ali ne sadrži prepoznatljive podatke skena (scan.json) niti meta.json.")
          .font(.footnote)
          .foregroundStyle(.secondary)
          .multilineTextAlignment(.center)
          .padding(.horizontal)
      }
      Spacer()
    }
    .padding()
  }
}
