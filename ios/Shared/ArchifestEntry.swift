// Entry names inside a .archifp archive. Shared between the app target (which
// writes them) and the thumbnail extension (which reads plan.png), so the two
// sides cannot drift apart — a typo here would silently mean "no thumbnail",
// with nothing failing loudly to point at it.
enum ArchifestEntry {
  static let scan = "scan.json"
  static let meta = "meta.json"
  static let planImage = "plan.png"
}
