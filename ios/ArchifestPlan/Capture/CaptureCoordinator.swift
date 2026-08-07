// CaptureCoordinator — owns the RoomCaptureView/RoomCaptureSession lifecycle
// for a multi-room walkthrough. On finish, wraps a single CapturedRoom
// directly or merges several via StructureBuilder (see ScanExport.swift).
//
// Multi-room merge correctness is explicitly UNVERIFIED here — no LiDAR
// device is available in the environment this was written in, and RoomPlan
// does not run in Simulator. See CLAUDE.md's iOS section.
import Foundation
import RoomPlan

@MainActor
final class CaptureCoordinator: NSObject, ObservableObject {
  private enum PendingAction {
    case nextRoom
    case finish
  }

  let roomCaptureView = RoomCaptureView(frame: .zero)
  let heading = HeadingReader()

  @Published var isCapturing = false
  @Published var isMerging = false
  @Published var errorMessage: String?
  @Published private(set) var capturedRoomCount = 0

  private var capturedRooms: [CapturedRoom] = []
  private var pendingAction: PendingAction = .nextRoom
  private var hasEnded = false

  var projectName = ""
  /// Called once, with the finished export, when the session ends
  /// successfully. A stored property rather than a completion closure per
  /// call — the coordinator itself decides when a session is done (the
  /// Stop button, via `stopSession()`), so it's the one that should invoke
  /// it, not something the screen has to orchestrate.
  var onFinished: ((_ scan: Data, _ meta: Data, _ name: String) -> Void)?

  override init() {
    super.init()
    roomCaptureView.delegate = self
    // Deliberately NOT setting `roomCaptureView.captureSession.delegate`:
    // RoomCaptureView installs itself there to drive its own live wireframe
    // and coaching UI, so taking that slot means taking it away from the
    // view. An earlier revision did exactly that, purely to learn when the
    // session became ready for a start-up blur — a lot of risk for a
    // cosmetic detail, and the blur itself turned out to be the main
    // performance problem (see CaptureScreen). Both are gone.
  }

  // RoomCaptureViewDelegate : NSCoding (verified against Apple's current
  // RoomPlan docs — an unexpected inheritance for a delegate protocol, but
  // real). We don't support state restoration, so these are stubs; RoomPlan
  // never calls them for a delegate assigned programmatically like this one.
  // Returns nil rather than calling fatalError: this initializer is failable
  // precisely so a type can decline to be decoded, and "decline" is the
  // honest answer here — we don't support state restoration. A fatalError
  // would crash the app outright if anything ever did attempt it.
  required nonisolated init?(coder: NSCoder) {
    return nil
  }

  nonisolated func encode(with coder: NSCoder) {}

  func startRoom() {
    if capturedRooms.isEmpty { heading.start() }
    var configuration = RoomCaptureSession.Configuration()
    // Already the default — set explicitly so it's not an invisible fact.
    // RoomPlan's own "move closer / slow down" coaching overlay is what
    // this turns on; there is no other capture-time quality/detail option
    // in RoomPlan's public API (checked the complete member list of both
    // RoomCaptureSession.Configuration and RoomBuilder.ConfigurationOptions
    // — beautifyObjects, used below in finishSession(), is the only one
    // that exists at all, and it only affects furniture placement).
    configuration.isCoachingEnabled = true
    roomCaptureView.captureSession.run(configuration: configuration)
    isCapturing = true
  }

  /// "Next" — ends this room's capture but keeps AR world tracking running
  /// (stop(pauseARSession: false)) so walking into the next room stays in
  /// the same coordinate space, then immediately captures the next room
  /// with no prompt. This is Apple's own documented technique for exactly
  /// this scenario (WWDC23 "Explore enhancements to RoomPlan", session
  /// 10192: "stop(pauseARSession: false) ... reuse the same
  /// roomCaptureSession instance for subsequent scans... the ARSession
  /// remains running across all scans") — not a workaround, the
  /// recommended one.
  func advanceToNextRoom() {
    guard isCapturing else { return }
    pendingAction = .nextRoom
    roomCaptureView.captureSession.stop(pauseARSession: false)
  }

  /// "Stop" — ends the whole session: finishes this room, fully pauses AR
  /// tracking, and moves to merge + report once the room finishes
  /// processing (see `captureView(didPresent:)` below).
  func stopSession() {
    guard isCapturing else { return }
    pendingAction = .finish
    roomCaptureView.captureSession.stop(pauseARSession: true)
  }

  /// Leaving the capture screen by any means (system back chevron, edge
  /// swipe) ends up here via `.onDisappear` — guarded so it's a no-op if
  /// `stopSession()` already cleanly finished the session.
  func cancelSession() {
    guard !hasEnded else { return }
    hasEnded = true
    roomCaptureView.captureSession.stop(pauseARSession: true)
    heading.stop()
  }

  private func finishSession() {
    hasEnded = true
    isMerging = true
    let rooms = capturedRooms
    let name = projectName
    let headingValue = heading.headingDegrees
    Task {
      do {
        let payload: Data
        if rooms.count <= 1, let only = rooms.first {
          payload = try ScanExport.payload(fromSingle: only)
        } else {
          // Verified against Apple's current RoomPlan docs at implementation
          // time (StructureBuilder.init(options:), capturedStructure(from:)
          // async throws -> CapturedStructure), not from memory.
          let structure = try await StructureBuilder(options: [.beautifyObjects])
            .capturedStructure(from: rooms)
          payload = try ScanExport.payload(fromStructure: structure)
        }
        let meta = ScanExport.makeMeta(
          headingDegrees: headingValue ?? 0,
          name: name.isEmpty ? nil : name,
          rooms: rooms
        )
        let metaData = try JSONEncoder().encode(meta)
        self.isMerging = false
        self.onFinished?(payload, metaData, name.isEmpty ? "snimka" : name)
      } catch {
        self.isMerging = false
        self.errorMessage = error.localizedDescription
      }
    }
  }
}

// Left nonisolated + hopping to the main actor via Task, rather than an
// isolated conformance (`extension ...: @MainActor RoomCaptureViewDelegate`)
// — that form hit an unrelated NSCoding conformance error from the compiler
// for this particular @objc protocol; this is the well-established pattern.
extension CaptureCoordinator: RoomCaptureViewDelegate {
  /// Returns **false** — deliberately. Per Apple's docs, returning `true`
  /// makes RoomCaptureView "display the scanned room in a 3D rendition that
  /// the user can inspect using touch gestures" before you can continue.
  /// That review is exactly what we don't want: Next is meant to walk
  /// straight into the next room, and Stop goes straight to the report,
  /// which is itself the review.
  ///
  /// The cost of skipping it is that `captureView(didPresent:)` is then
  /// never called, so we process the raw data ourselves with `RoomBuilder`
  /// (the documented path for exactly this). For Next that's a bonus: the
  /// finished room processes in the background while the next room is
  /// already being captured.
  nonisolated func captureView(shouldPresent roomDataForProcessing: CapturedRoomData, error: (any Error)?) -> Bool {
    let message = error?.localizedDescription
    Task { @MainActor in
      await self.processCapturedRoom(roomDataForProcessing, errorMessage: message)
    }
    return false
  }
}

private extension CaptureCoordinator {
  func processCapturedRoom(_ data: CapturedRoomData, errorMessage message: String?) async {
    if let message {
      self.errorMessage = message
      isCapturing = false
      return
    }

    // Start the next room *before* awaiting the build: with
    // stop(pauseARSession: false) the AR session is still tracking, and the
    // owner walking through a doorway shouldn't have to wait for the
    // previous room to finish processing.
    let action = pendingAction
    isCapturing = false
    if action == .nextRoom {
      startRoom()
    } else {
      // Show "Obrada snimke…" for the whole wait, not just the merge that
      // follows it — otherwise the screen sits blank while RoomBuilder works.
      isMerging = true
    }

    do {
      // Same option as the multi-room merge in finishSession() — the only
      // one RoomPlan exposes (furniture placement).
      let room = try await RoomBuilder(options: [.beautifyObjects]).capturedRoom(from: data)
      capturedRooms.append(room)
      capturedRoomCount = capturedRooms.count
      if action == .finish { finishSession() }
    } catch {
      self.errorMessage = error.localizedDescription
    }
  }
}
