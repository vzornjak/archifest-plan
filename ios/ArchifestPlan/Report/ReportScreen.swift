// ReportScreen — hosts ReportWebView for one document's scan/meta. Read-only:
// this app has no in-place editing of scan data, so there's nothing to save
// from here beyond what DocumentGroup already autosaves on capture/import.
//
// No NavigationStack of its own — DocumentGroup already wraps its editor
// content in one, so wrapping again just stacks a second, redundant
// navigation bar on top of the real one. `.navigationTitle`/`.toolbar` here
// attach directly to DocumentGroup's own bar.
import SwiftUI

struct ReportScreen: View {
  let name: String
  let scan: Data
  let meta: Data?
  let fileURL: URL?

  @State private var pdfExportTrigger = 0

  var body: some View {
    ReportWebView(
      name: name.isEmpty ? "snimka" : name,
      scanJSON: scan,
      metaJSON: meta,
      pdfExportTrigger: $pdfExportTrigger
    )
    .ignoresSafeArea(edges: .bottom)
    .navigationTitle(name.isEmpty ? "Izvještaj" : name)
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      // Far trailing edge — the standard "all the way right" toolbar slot.
      ToolbarItem(placement: .primaryAction) {
        Menu {
          if let fileURL {
            ShareLink(item: fileURL) {
              Label("Podijeli .archifp", systemImage: "doc.zipper")
            }
          }
          Button {
            pdfExportTrigger += 1
          } label: {
            Label("Podijeli PDF", systemImage: "doc.richtext")
          }
        } label: {
          Image(systemName: "square.and.arrow.up")
        }
      }
    }
  }
}
