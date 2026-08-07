// ReportScreen — hosts ReportWebView for one document's scan/meta. Read-only:
// this app has no in-place editing of scan data, so there's nothing to save
// from here beyond what DocumentGroup already autosaves on capture/import.
import SwiftUI

struct ReportScreen: View {
  let name: String
  let scan: Data
  let meta: Data?

  @Environment(\.dismiss) private var dismiss

  var body: some View {
    NavigationStack {
      ReportWebView(name: name.isEmpty ? "snimka" : name, scanJSON: scan, metaJSON: meta)
        .ignoresSafeArea(edges: .bottom)
        .navigationTitle(name.isEmpty ? "Izvještaj" : name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
          ToolbarItem(placement: .cancellationAction) {
            Button("Zatvori") { dismiss() }
          }
        }
    }
  }
}
