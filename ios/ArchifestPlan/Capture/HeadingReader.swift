// HeadingReader — captures one true-north compass reading at the start of a
// scan, for meta.json's headingDegrees (see ScanMeta.swift, geometry.js's
// northBearingFrom).
//
// CAVEAT (see the iOS section of CLAUDE.md / the PR that introduces this
// file): HEADING_OFFSET_DEG = 90 in geometry.js was empirically calibrated
// against a specific third-party scanner app's CLHeading convention with the
// phone in Landscape at scan start. RoomPlan capture normally runs Portrait.
// This reader hands back a plain compass heading; whether the existing
// +90° offset still lines up needs an on-device check (rotate in a room
// until the plan matches, same method the original README calibration
// used) — it is NOT verified here.
import CoreLocation

@MainActor
final class HeadingReader: NSObject, ObservableObject, @MainActor CLLocationManagerDelegate {
  @Published private(set) var headingDegrees: Double?

  private let manager = CLLocationManager()

  override init() {
    super.init()
    manager.delegate = self
  }

  func start() {
    headingDegrees = nil
    guard CLLocationManager.headingAvailable() else { return }
    manager.requestWhenInUseAuthorization()
    manager.startUpdatingHeading()
  }

  func stop() {
    manager.stopUpdatingHeading()
  }

  func locationManager(_ manager: CLLocationManager, didUpdateHeading newHeading: CLHeading) {
    // One reading is enough — same "captured once near scan start" shape the
    // previous (third-party-app) workflow's meta.json already had.
    guard headingDegrees == nil else { return }
    headingDegrees = newHeading.trueHeading >= 0 ? newHeading.trueHeading : newHeading.magneticHeading
    stop()
  }
}
