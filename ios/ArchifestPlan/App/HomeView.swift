// HomeView — "Nova snimka" (live RoomPlan capture) or "Učitaj uzorak" (the
// bundled synthetic fixture — the only path that's exercisable in Simulator,
// RoomPlan itself needs a real LiDAR device). No scan history for v1: every
// capture goes straight into the report, same one-shot feel as opening a
// file in the browser today.
import SwiftUI
import RoomPlan

struct ReportPayload: Identifiable {
  let id = UUID()
  let scan: Data
  let meta: Data?
  let name: String
}

struct HomeView: View {
  @State private var captureName = ""
  @State private var showNameSheet = false
  @State private var showCapture = false
  @State private var report: ReportPayload?

  var body: some View {
    NavigationStack {
      VStack(spacing: 24) {
        Spacer()

        VStack(spacing: 8) {
          Text("ARCHIFEST Plan")
            .font(.largeTitle.bold())
          Text("Tlocrt, strop i zidovi iz RoomPlan snimke, po prostoriji.")
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.center)
        }

        if RoomCaptureSession.isSupported {
          Button("Nova snimka") {
            captureName = ""
            showNameSheet = true
          }
          .buttonStyle(.borderedProminent)
          .controlSize(.large)
        } else {
          Text("RoomPlan nije podržan na ovom uređaju — potreban je LiDAR skener (npr. iPhone 12 Pro ili noviji, iPad Pro s LiDAR-om).")
            .font(.footnote)
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.center)
            .padding(.horizontal)
        }

        Button("Učitaj uzorak") { loadSample() }
          .buttonStyle(.bordered)

        Spacer()

        Text("iOS omot v1 · web izvještaj se učitava iz paketa aplikacije")
          .font(.caption2)
          .foregroundStyle(.tertiary)
      }
      .padding()
      .sheet(isPresented: $showNameSheet) {
        NameEntrySheet(name: $captureName) {
          showNameSheet = false
          showCapture = true
        }
      }
      .fullScreenCover(isPresented: $showCapture) {
        CaptureScreen(projectName: captureName) { scan, meta, name in
          showCapture = false
          report = ReportPayload(scan: scan, meta: meta, name: name)
        }
      }
      .fullScreenCover(item: $report) { payload in
        ReportScreen(payload: payload) { report = nil }
      }
    }
    .onAppear {
      // Lets `xcrun simctl launch ... -autoLoadSample` exercise the report
      // path (fixture -> WKWebView -> JS bridge) without a human tap — the
      // only way to smoke-test any of this in Simulator, since RoomPlan
      // itself never runs there.
      if ProcessInfo.processInfo.arguments.contains("-autoLoadSample") {
        loadSample()
      }
    }
  }

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
    report = ReportPayload(scan: scan, meta: meta, name: "uzorak")
  }
}

private struct NameEntrySheet: View {
  @Binding var name: String
  let onStart: () -> Void
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    NavigationStack {
      Form {
        Section("Naziv projekta") {
          TextField("npr. adresa ili naziv prostora", text: $name)
        }
      }
      .navigationTitle("Nova snimka")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Odustani") { dismiss() }
        }
        ToolbarItem(placement: .confirmationAction) {
          Button("Započni") { onStart() }
        }
      }
    }
    .presentationDetents([.medium])
  }
}

private struct ReportScreen: View {
  let payload: ReportPayload
  let onClose: () -> Void

  var body: some View {
    NavigationStack {
      ReportWebView(name: payload.name, scanJSON: payload.scan, metaJSON: payload.meta)
        .ignoresSafeArea(edges: .bottom)
        .navigationTitle(payload.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
          ToolbarItem(placement: .cancellationAction) {
            Button("Zatvori") { onClose() }
          }
        }
    }
  }
}
