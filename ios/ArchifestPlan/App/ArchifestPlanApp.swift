// Document-based app: each scan is a real file (see ArchifestDocument.swift,
// ArchifestZip.swift), browsable/reopenable from the system's own document
// browser — no custom "home screen" needed, that browser IS the home screen
// now (its "+" starts a new scan; tapping a file reopens its report).
import SwiftUI

@main
struct ArchifestPlanApp: App {
  var body: some Scene {
    DocumentGroup(newDocument: ArchifestDocument.empty) { file in
      ArchifestDocumentScene(document: file.$document)
    }
  }
}
