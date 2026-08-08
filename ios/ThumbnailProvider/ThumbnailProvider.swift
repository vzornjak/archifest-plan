// ThumbnailProvider — the Quick Look thumbnail extension for .archifp files,
// so the document browser and Files show the floor plan instead of a generic
// document icon.
//
// Deliberately trivial: it does NOT draw anything. The portrait plan image
// was rendered once by the app when the scan finished (see
// PlanThumbnailRenderer) and stored inside the .archifp; all this does is
// unzip that entry and hand it back. That keeps the drawing in exactly one
// place (app.js, via the real report) and keeps this extension well inside
// the tight time and memory budget thumbnail extensions get.
//
// ArchifestZip.swift is shared with the app target rather than duplicated —
// see project.yml.
import UIKit
import QuickLookThumbnailing
import os

final class ThumbnailProvider: QLThumbnailProvider {
  private static let log = Logger(subsystem: "hr.archifest.plan", category: "thumbnail-extension")

  override func provideThumbnail(
    for request: QLFileThumbnailRequest,
    _ handler: @escaping (QLThumbnailReply?, (any Error)?) -> Void
  ) {
    guard let image = Self.planImage(at: request.fileURL) else {
      // No stored plan (a scan saved before thumbnails existed, or one whose
      // render failed). Returning nil is the documented way to say "no
      // thumbnail" — the system falls back to the generic document icon
      // rather than showing something wrong.
      handler(nil, nil)
      return
    }

    let target = request.maximumSize
    let scale = min(target.width / image.size.width, target.height / image.size.height)
    let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)

    handler(QLThumbnailReply(contextSize: size) { context in
      image.draw(in: CGRect(origin: .zero, size: size))
      return true
    }, nil)
  }

  private static func planImage(at url: URL) -> UIImage? {
    // The extension is handed a URL it may not otherwise have permission to
    // read; the security-scoped dance is required, and balanced in defer.
    let scoped = url.startAccessingSecurityScopedResource()
    defer { if scoped { url.stopAccessingSecurityScopedResource() } }

    do {
      let entries = try ArchifestZip.read(from: url)
      guard let data = entries[ArchifestEntry.planImage] else { return nil }
      return UIImage(data: data)
    } catch {
      log.error("could not read plan image: \(error.localizedDescription, privacy: .public)")
      return nil
    }
  }
}
