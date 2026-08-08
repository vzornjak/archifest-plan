// PlanView — the floor plan drawn natively, on the blueprint backdrop.
//
// First native piece of what has until now been an SVG built by app.js. The
// drawing conventions follow that one (walls at full length, openings cut
// into them, a compass rose showing where true north ends up) with two
// deliberate differences the owner asked for:
//
//   - **No dimension lines or measurements** — the plan alone.
//   - **Doors are dotted marks in the plane of the wall**, not the standard
//     leaf-and-swing-arc symbol the web plan draws. The swing side was always
//     a drawing convention anyway (the scan records only `isOpen`), so
//     dropping it removes an invented detail rather than real information.
//
// No furniture either: this is currently used for the document thumbnail,
// where furniture rectangles just crowd a small tile.
import SwiftUI

struct PlanView: View {
  let scan: PlanGeometry.Scan
  let headingDegrees: Double?

  // Drawn over the owner's blueprint backdrop, so the plan sits on the same
  // paper as the rest of the app.
  private let wallColor = Color(red: 0.94, green: 0.97, blue: 1.0)
  private let openingColor = Color(red: 0.98, green: 0.80, blue: 0.52)
  private let floorColor = Color(red: 0.60, green: 0.75, blue: 0.95)
  private let compassColor = Color(red: 0.88, green: 0.93, blue: 1.0)

  var body: some View {
    ZStack {
      BlueprintBackground()
      Canvas { context, size in
        draw(&context, size: size)
      }
    }
  }

  private func draw(_ context: inout GraphicsContext, size: CGSize) {
    let segments = scan.walls.map { PlanGeometry.wallSegment($0) }
    guard !segments.isEmpty else { return }

    let northBearing = PlanGeometry.northBearing(
      headingDegrees: headingDegrees,
      referenceRotationDegrees: scan.referenceRotationDegrees
    )

    // Aligned to the longest wall, exactly as the web plan does, so the two
    // drawings of the same scan come out the same way up.
    let longest = scan.walls.max(by: { $0.dimensions[0] < $1.dimensions[0] })!
    let longestSegment = PlanGeometry.wallSegment(longest)
    let wallAngle = atan2(
      longestSegment.p2.y - longestSegment.p1.y,
      longestSegment.p2.x - longestSegment.p1.x
    ) * 180 / .pi

    let orientation = PlanGeometry.planOrientation(
      wallAngle: wallAngle,
      northBearing: northBearing,
      preferLandscape: false   // the thumbnail is always portrait
    )

    let theta = orientation.rotationDegrees * .pi / 180
    let cosT = cos(theta), sinT = sin(theta)
    func project(_ p: CGPoint) -> CGPoint {
      CGPoint(x: p.x * cosT - p.y * sinT, y: p.x * sinT + p.y * cosT)
    }

    // Fit the projected drawing into the canvas, preserving aspect.
    let projected = segments.flatMap { [project($0.p1), project($0.p2)] }
    let pad = 1.2
    let minX = projected.map(\.x).min()! - pad, maxX = projected.map(\.x).max()! + pad
    let minY = projected.map(\.y).min()! - pad, maxY = projected.map(\.y).max()! + pad
    let worldW = maxX - minX, worldH = maxY - minY
    guard worldW > 0, worldH > 0 else { return }

    // Leaves room at the bottom-right for the compass rose.
    let inset: CGFloat = 24
    let scale = min((size.width - inset * 2) / worldW, (size.height - inset * 2) / worldH)
    let drawnW = worldW * scale, drawnH = worldH * scale
    let originX = (size.width - drawnW) / 2, originY = (size.height - drawnH) / 2

    func toCanvas(_ p: CGPoint) -> CGPoint {
      let q = project(p)
      return CGPoint(x: originX + (q.x - minX) * scale, y: originY + (q.y - minY) * scale)
    }

    let wallWidth = max(2.0, min(drawnW, drawnH) * 0.012)

    // Floor fill first, so everything else sits on top of it.
    for floor in scan.floors {
      let polygon = PlanGeometry.floorPolygon(floor).map(toCanvas)
      guard polygon.count >= 3 else { continue }
      var path = Path()
      path.move(to: polygon[0])
      for point in polygon.dropFirst() { path.addLine(to: point) }
      path.closeSubpath()
      context.fill(path, with: .color(floorColor.opacity(0.10)))
    }

    // Walls. A low-confidence wall is dashed, same signal the web plan uses.
    for wall in scan.walls {
      let segment = PlanGeometry.wallSegment(wall)
      var path = Path()
      path.move(to: toCanvas(segment.p1))
      path.addLine(to: toCanvas(segment.p2))
      let style = StrokeStyle(
        lineWidth: wallWidth,
        lineCap: .square,
        dash: wall.confidence == "low" ? [wallWidth * 1.2, wallWidth * 0.8] : []
      )
      context.stroke(path, with: .color(wallColor), style: style)
    }

    // Openings: the wall is cut away, then the opening is marked. Doors get
    // dots along the wall plane instead of a swing arc (see the file note).
    for opening in scan.openings {
      let segment = PlanGeometry.wallSegment(opening)
      let a = toCanvas(segment.p1), b = toCanvas(segment.p2)
      var path = Path()
      path.move(to: a)
      path.addLine(to: b)

      // Cut: paint over the wall with the backdrop so the opening reads as a
      // gap rather than an overlay.
      context.blendMode = .destinationOut
      context.stroke(path, with: .color(.black), style: StrokeStyle(lineWidth: wallWidth * 1.6, lineCap: .butt))
      context.blendMode = .normal

      switch opening.kind {
      case .door:
        context.stroke(
          path,
          with: .color(openingColor),
          style: StrokeStyle(
            lineWidth: wallWidth * 0.9,
            lineCap: .round,
            dash: [wallWidth * 0.1, wallWidth * 1.1]  // dotted, in the wall's own plane
          )
        )
      default:
        context.stroke(
          path,
          with: .color(openingColor),
          style: StrokeStyle(lineWidth: wallWidth * 0.9, lineCap: .butt)
        )
      }
    }

    drawCompass(
      &context,
      center: CGPoint(x: size.width - inset - 34, y: size.height - inset - 34),
      radius: 30,
      // The rose turns with the drawing: north ends up wherever the chosen
      // rotation put it. Without meta.json north is unknown, and the rose
      // shows the assumed north instead — same convention as the web plan.
      roseDegrees: orientation.rotationDegrees - (northBearing ?? 0),
      known: northBearing != nil
    )
  }

  private func drawCompass(
    _ context: inout GraphicsContext,
    center: CGPoint,
    radius: CGFloat,
    roseDegrees: Double,
    known: Bool
  ) {
    let opacity = known ? 1.0 : 0.45
    context.stroke(
      Path(ellipseIn: CGRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2)),
      with: .color(compassColor.opacity(0.5 * opacity)),
      lineWidth: 1
    )

    var rose = context
    rose.translateBy(x: center.x, y: center.y)
    rose.rotate(by: .degrees(roseDegrees))

    // Ticks every 30°, heavier on the cardinals.
    for angle in stride(from: 0.0, to: 360.0, by: 30.0) {
      let major = angle.truncatingRemainder(dividingBy: 90) == 0
      let rad = angle * .pi / 180
      let sx = sin(rad), sy = -cos(rad)
      let r1 = radius * (major ? 0.80 : 0.88), r2 = radius * 0.97
      var tick = Path()
      tick.move(to: CGPoint(x: sx * r1, y: sy * r1))
      tick.addLine(to: CGPoint(x: sx * r2, y: sy * r2))
      rose.stroke(tick, with: .color(compassColor.opacity(0.7 * opacity)), lineWidth: major ? 1.4 : 0.8)
    }

    // Needle: north half bright, south half muted.
    var north = Path()
    north.move(to: CGPoint(x: 0, y: -radius * 0.45))
    north.addLine(to: CGPoint(x: -radius * 0.10, y: 0))
    north.addLine(to: CGPoint(x: radius * 0.10, y: 0))
    north.closeSubpath()
    rose.fill(north, with: .color(compassColor.opacity(opacity)))

    var south = Path()
    south.move(to: CGPoint(x: 0, y: radius * 0.45))
    south.addLine(to: CGPoint(x: -radius * 0.10, y: 0))
    south.addLine(to: CGPoint(x: radius * 0.10, y: 0))
    south.closeSubpath()
    rose.fill(south, with: .color(compassColor.opacity(0.4 * opacity)))

    // "N" counter-rotated so it stays upright however the rose is turned.
    var label = context
    let labelAngle = roseDegrees * .pi / 180
    label.translateBy(
      x: center.x + sin(labelAngle) * radius * 0.62,
      y: center.y - cos(labelAngle) * radius * 0.62
    )
    label.draw(
      Text("N").font(.system(size: 13, weight: .semibold, design: .monospaced))
        .foregroundColor(compassColor.opacity(opacity)),
      at: .zero
    )
  }
}
