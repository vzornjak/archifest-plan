// PlanGeometry — the floor-plan maths, in Swift.
//
// FIRST STEP OF A DELIBERATE MIGRATION. Until now geometry.js was the single
// engine and CLAUDE.md said so in as many words ("two repos means two
// versions of the truth"). The owner has decided to move the app to Swift
// over time, starting here, so for a while the plan maths genuinely does
// exist twice: geometry.js still drives the web report, this drives the
// native drawing. That is a known, accepted cost of the transition, not an
// oversight — but it means **any change to the drawing maths has to be made
// in both places until the web report is retired**.
//
// Ported directly from geometry.js so the two agree: reshapeMatrix,
// localToWorld, wallSegment, floorPolygon, planOrientation and
// northBearingFrom are line-for-line equivalents of the functions with those
// names there. HEADING_OFFSET_DEG in particular is the empirically
// calibrated constant described in the README — don't "fix" it here alone.
import Foundation
import CoreGraphics

enum PlanGeometry {
  /// Mirrors HEADING_OFFSET_DEG in geometry.js. Calibrated in a real room;
  /// still unverified against RoomPlan's own heading convention (see
  /// CLAUDE.md), which is a reason to keep it identical in both engines
  /// rather than diverge.
  static let headingOffsetDegrees = 90.0

  // MARK: - Parsed scan

  struct Element {
    let identifier: String
    let transform: [Double]     // flat 16, column-major
    let dimensions: [Double]    // [width, height, depth]
    let polygonCorners: [[Double]]?
    let confidence: String
    let kind: Kind

    enum Kind: String { case wall, door, window, opening, floor, object }
  }

  struct Scan {
    let walls: [Element]
    let openings: [Element]     // doors + windows + generic openings
    let floors: [Element]
    /// Rotation of the capture's reference frame, degrees — the same
    /// `refRotDeg` geometry.js derives from rooms[0].referenceOriginTransform.
    let referenceRotationDegrees: Double
  }

  // MARK: - Decoding

  /// Parses the scan JSON directly rather than going through CapturedRoom, so
  /// this works for every shape the app accepts: a single room, a merged
  /// CapturedStructure, and a loose scan.json imported from elsewhere.
  static func parse(scanJSON: Data) -> Scan? {
    guard
      let root = (try? JSONSerialization.jsonObject(with: scanJSON)) as? [String: Any]
    else { return nil }

    // A bare CapturedRoom (top-level `walls`, no `rooms`) is accepted too —
    // same fallback as applyScan in app.js.
    let rooms: [[String: Any]]
    if let list = root["rooms"] as? [[String: Any]] {
      rooms = list
    } else if root["walls"] != nil {
      rooms = [root]
    } else {
      return nil
    }

    var walls: [String: Element] = [:]
    var openings: [String: Element] = [:]
    var floors: [String: Element] = [:]

    for room in rooms {
      collect(room["walls"], kind: .wall, into: &walls)
      collect(room["doors"], kind: .door, into: &openings)
      collect(room["windows"], kind: .window, into: &openings)
      collect(room["openings"], kind: .opening, into: &openings)
      collect(room["floors"], kind: .floor, into: &floors)
    }

    // Only room 0's reference frame is used — a whole capture shares one, the
    // same assumption geometry.js makes.
    var refRot = 0.0
    if let t = rooms.first?["referenceOriginTransform"] as? [Double], t.count == 16 {
      refRot = atan2(t[2], t[0]) * 180 / .pi
    }

    guard !walls.isEmpty else { return nil }
    return Scan(
      walls: Array(walls.values),
      openings: Array(openings.values),
      floors: Array(floors.values),
      referenceRotationDegrees: refRot
    )
  }

  /// Keyed by identifier, which also does the de-duplication geometry.js
  /// does: a wall shared by two rooms appears in both and must be drawn once.
  private static func collect(_ raw: Any?, kind: Element.Kind, into store: inout [String: Element]) {
    guard let list = raw as? [[String: Any]] else { return }
    for item in list {
      guard
        let transform = item["transform"] as? [Double], transform.count == 16,
        let dimensions = item["dimensions"] as? [Double], dimensions.count >= 2
      else { continue }
      let identifier = (item["identifier"] as? String) ?? UUID().uuidString
      // `confidence` is Swift's enum-with-case JSON shape: {"high": {}}.
      let confidence = (item["confidence"] as? [String: Any])?.keys.first ?? "medium"
      store[identifier] = Element(
        identifier: identifier,
        transform: transform,
        dimensions: dimensions,
        polygonCorners: item["polygonCorners"] as? [[Double]],
        confidence: confidence,
        kind: kind
      )
    }
  }

  // MARK: - Transforms (ports of the geometry.js functions of the same name)

  /// Flat column-major 4x4 -> world point, for a point in the element's own
  /// local space. Returns the (x, z) pair only: the plan is a top-down view,
  /// so world Y (height) is dropped everywhere below.
  static func localToWorld(_ lx: Double, _ ly: Double, _ lz: Double, _ m: [Double]) -> CGPoint {
    CGPoint(
      x: lx * m[0] + ly * m[4] + lz * m[8] + m[12],
      y: lx * m[2] + ly * m[6] + lz * m[10] + m[14]
    )
  }

  static func wallSegment(_ element: Element) -> (p1: CGPoint, p2: CGPoint) {
    let half = element.dimensions[0] / 2
    return (
      localToWorld(-half, 0, 0, element.transform),
      localToWorld(half, 0, 0, element.transform)
    )
  }

  static func floorPolygon(_ element: Element) -> [CGPoint] {
    guard let corners = element.polygonCorners else { return [] }
    return corners.compactMap { corner in
      guard corner.count >= 3 else { return nil }
      return localToWorld(corner[0], corner[1], corner[2], element.transform)
    }
  }

  // MARK: - Orientation

  struct Orientation {
    let rotationDegrees: Double
    let landscape: Bool
  }

  /// Port of planOrientation() in geometry.js. Every orientation bug in this
  /// project so far has lived in that function, which is why it's unit tested
  /// there — keep this in step with it.
  static func planOrientation(
    wallAngle: Double,
    northBearing: Double?,
    preferLandscape: Bool
  ) -> Orientation {
    func norm(_ a: Double) -> Double { ((a.truncatingRemainder(dividingBy: 360)) + 360).truncatingRemainder(dividingBy: 360) }

    if let northBearing {
      func offset(for step: Double) -> Double {
        let rose = norm(-wallAngle + step - northBearing)
        return abs(rose > 180 ? rose - 360 : rose)
      }
      var base = 0.0
      for step in [90.0, 180.0, 270.0] where offset(for: step) < offset(for: base) { base = step }
      let baseLandscape = base.truncatingRemainder(dividingBy: 180) == 0
      // The thumbnail is always portrait, so unlike the web report there is
      // no override and no panel-shape guess — portrait is simply asked for.
      let landscape = preferLandscape
      return Orientation(
        rotationDegrees: norm(-wallAngle + base + (landscape == baseLandscape ? 0 : -90)),
        landscape: landscape
      )
    }

    return Orientation(
      rotationDegrees: norm(-wallAngle + (preferLandscape ? 0 : 90)),
      landscape: preferLandscape
    )
  }

  /// Port of northBearingFrom() in geometry.js. nil when there's no meta.json
  /// — north is genuinely unknown then, and the drawing says so rather than
  /// pretending to a direction.
  static func northBearing(headingDegrees: Double?, referenceRotationDegrees: Double) -> Double? {
    guard let headingDegrees else { return nil }
    let raw = headingDegrees - referenceRotationDegrees + headingOffsetDegrees
    return ((raw.truncatingRemainder(dividingBy: 360)) + 360).truncatingRemainder(dividingBy: 360)
  }
}
