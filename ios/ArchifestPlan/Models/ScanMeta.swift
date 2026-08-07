// ScanMeta — mirrors the meta.json shape the web report already understands.
//
// Field names match app.js exactly (see app.js:80-86, 127, 251, 270) so no
// custom CodingKeys are needed. Only fields app.js actually reads are
// required; `createdAt`/`roomCount` are carried for parity with the meta.json
// the previous (third-party-scanner) workflow produced, but app.js does not
// read them today.
//
// `floorAreaSquareMetres`/`wallAreaSquareMetres` are deliberately computed by
// a SEPARATE, simpler code path than geometry.js (see ScanExport.swift) —
// the whole point of a control is that it can't share a bug with the number
// it's checking.
struct ScanMeta: Codable {
  /// True-north compass heading in degrees, read once when the first room's
  /// capture starts. Required — app.js:82 calls `.toFixed(1)` on this
  /// unconditionally and throws if it's missing.
  var headingDegrees: Double

  /// Project/room name shown as the report title (app.js:127). Falls back to
  /// the scan's filename in the web report if absent.
  var name: String?

  /// Independent floor-area control, m² — see ScanExport.independentAreas.
  var floorAreaSquareMetres: Double?

  /// Independent net wall-area control, m² (gross minus openings) — see
  /// ScanExport.independentAreas.
  var wallAreaSquareMetres: Double?

  /// ISO 8601 capture timestamp. Not read by app.js today; kept for parity
  /// and for the owner's own record-keeping.
  var createdAt: String?

  /// Number of RoomCaptureSessions run for this scan (i.e. how many rooms
  /// were walked through) — an honest count of capture sessions, NOT the
  /// segmented-room count the report itself computes. Not read by app.js.
  var roomCount: Int?
}
