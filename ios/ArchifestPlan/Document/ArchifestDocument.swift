// ArchifestDocument — one FileDocument handling two very different inputs:
// the app's own .archifp (a real zip, see ArchifestZip.swift) and a loose
// scan.json/meta.json dropped in from elsewhere — the exact shape the web
// app's drag-and-drop already accepts (isMeta(), app.js:72).
//
// A document opened from a loose .json is never rewritten into a zip: this
// app has no in-place editing, the only thing that ever populates a
// document's scan/meta is finishing a brand-new capture (or loading the
// sample fixture) on a freshly created, empty document. `source` exists so
// that invariant is enforced by the type, not just by "nothing happens to
// call it" — a defensive guard, not a feature.
import SwiftUI
import UniformTypeIdentifiers

extension UTType {
  /// Matches the identifier declared in project.yml's UTExportedTypeDeclarations.
  static var archifestDocument: UTType {
    UTType(exportedAs: "hr.archifest.plan.document")
  }
}

struct ArchifestDocument: FileDocument, Sendable {
  enum Source: Sendable {
    case new        // just created, nothing captured yet
    case ownArchive // read from our own .archifp (zip)
    case looseJSON  // read from a plain scan.json or meta.json
  }

  static var readableContentTypes: [UTType] { [.archifestDocument, .json] }
  static var writableContentTypes: [UTType] { [.archifestDocument] }

  var name: String
  var scan: Data?
  var meta: Data?
  private(set) var source: Source

  static var empty: ArchifestDocument {
    ArchifestDocument(name: "", scan: nil, meta: nil, source: .new)
  }

  init(name: String, scan: Data?, meta: Data?, source: Source) {
    self.name = name
    self.scan = scan
    self.meta = meta
    self.source = source
  }

  init(configuration: ReadConfiguration) throws {
    guard let data = configuration.file.regularFileContents else {
      throw CocoaError(.fileReadCorruptFile)
    }
    let baseName = configuration.file.filename.map { ($0 as NSString).deletingPathExtension } ?? "snimka"

    if configuration.contentType.conforms(to: .archifestDocument) {
      let entries = try ArchifestZip.read(data)
      self.scan = entries["scan.json"]
      self.meta = entries["meta.json"]
      self.source = .ownArchive
    } else {
      // Loose json: classify by shape, same rule app.js's isMeta() uses
      // (app.js:72) — has headingDegrees but no rooms/walls means meta,
      // otherwise treat it as a scan.
      let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
      let looksLikeMeta = obj?["headingDegrees"] != nil && obj?["rooms"] == nil && obj?["walls"] == nil
      if looksLikeMeta {
        self.meta = data
        self.scan = nil
      } else {
        self.scan = data
        self.meta = nil
      }
      self.source = .looseJSON
    }
    self.name = baseName
  }

  func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
    var entries: [ArchifestZip.Entry] = []
    if let scan { entries.append(.init(name: "scan.json", data: scan)) }
    if let meta { entries.append(.init(name: "meta.json", data: meta)) }
    return FileWrapper(regularFileWithContents: ArchifestZip.data(for: entries))
  }
}
