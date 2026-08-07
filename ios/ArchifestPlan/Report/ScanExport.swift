// ScanExport — turns finished RoomPlan capture(s) into exactly the JSON shape
// geometry.js already parses (see geometry.js:168-199, buildData), plus a
// meta.json built from an INDEPENDENT area calculation.
//
// Independent is the whole point: geometry.js's own floor/wall totals are one
// code path, and CLAUDE.md's "two controls" design exists to catch a bug that
// path could have. So this file deliberately does its own, simpler pass over
// the same CapturedRoom data — same real geometry, different implementation,
// different language — rather than calling into any JS.
import Foundation
import RoomPlan
import simd

enum ScanExport {

  // MARK: - Scan payload

  /// A single captured room, wrapped as `{"rooms":[...]}` — the shape
  /// applyScan expects (app.js:88-94 also auto-wraps a bare CapturedRoom, but
  /// wrapping explicitly here means we don't rely on that fallback).
  static func payload(fromSingle room: CapturedRoom) throws -> Data {
    let roomData = try JSONEncoder().encode(room)
    let roomObject = try JSONSerialization.jsonObject(with: roomData)
    let wrapped = ["rooms": [roomObject]]
    return try JSONSerialization.data(withJSONObject: wrapped)
  }

  /// A merged multi-room structure. CapturedStructure encodes with its own
  /// top-level "rooms" key already (verified against Apple's current RoomPlan
  /// docs, not memory — see StructureBuilder.capturedStructure(from:) and
  /// CapturedStructure's Codable conformance), so this is a direct encode;
  /// the extra top-level keys (floors/walls/doors/... at the structure level)
  /// are simply ignored by geometry.js, which only reads `rooms`.
  static func payload(fromStructure structure: CapturedStructure) throws -> Data {
    try JSONEncoder().encode(structure)
  }

  // MARK: - Independent area control

  /// Deduplicated (by identifier, same rule geometry.js uses for a wall
  /// shared by two rooms) floor and net-wall areas, computed straight from
  /// the Swift-side CapturedRoom data.
  static func independentAreas(rooms: [CapturedRoom]) -> (floorM2: Double, wallM2: Double) {
    var floors: [UUID: CapturedRoom.Surface] = [:]
    var walls: [UUID: CapturedRoom.Surface] = [:]
    var openings: [CapturedRoom.Surface] = []

    for room in rooms {
      for f in room.floors { floors[f.identifier] = f }
      for w in room.walls { walls[w.identifier] = w }
      openings.append(contentsOf: room.doors)
      openings.append(contentsOf: room.windows)
      openings.append(contentsOf: room.openings)
    }

    let floorArea: Float = floors.values.reduce(0) { $0 + surfaceArea($1) }

    let wallArea: Float = walls.values.reduce(0) { total, wall in
      let gross = surfaceArea(wall)
      let openingArea: Float = openings
        .filter { $0.parentIdentifier == wall.identifier }
        .reduce(0) { $0 + surfaceArea($1) }
      // Same clamp geometry.js applies (wallNetArea) — a net area can never
      // go below zero even if opening bookkeeping overlaps.
      return total + max(0, gross - openingArea)
    }

    return (Double(floorArea), Double(wallArea))
  }

  /// Bounding-box area, or the true polygon area when `polygonCorners` is
  /// present — mirrors geometry.js's own rule (polygon beats bbox, since a
  /// gable wall or an irregular floor isn't a rectangle) using the same
  /// local (x, y) plane the corners are already expressed in.
  private static func surfaceArea(_ s: CapturedRoom.Surface) -> Float {
    if s.polygonCorners.count >= 3 {
      return shoelaceArea(s.polygonCorners)
    }
    return s.dimensions.x * s.dimensions.y
  }

  private static func shoelaceArea(_ corners: [simd_float3]) -> Float {
    var sum: Float = 0
    for i in 0..<corners.count {
      let a = corners[i]
      let b = corners[(i + 1) % corners.count]
      sum += a.x * b.y - b.x * a.y
    }
    return abs(sum) / 2
  }

  // MARK: - Meta

  static func makeMeta(headingDegrees: Double, name: String?, rooms: [CapturedRoom]) -> ScanMeta {
    let areas = independentAreas(rooms: rooms)
    return ScanMeta(
      headingDegrees: headingDegrees,
      name: name,
      floorAreaSquareMetres: areas.floorM2,
      wallAreaSquareMetres: areas.wallM2,
      createdAt: ISO8601DateFormatter().string(from: Date()),
      roomCount: rooms.count
    )
  }
}
