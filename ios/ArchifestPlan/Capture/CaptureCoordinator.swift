// CaptureCoordinator — owns the RoomCaptureView/RoomCaptureSession lifecycle
// for a multi-room walkthrough: capture a room, ask "add another or finish",
// repeat; on finish, wrap a single CapturedRoom directly or merge several via
// StructureBuilder (RoomPlan's multi-room merge API — see ScanExport.swift).
//
// Multi-room merge correctness is explicitly UNVERIFIED here — no LiDAR
// device is available in the environment this was written in, and RoomPlan
// does not run in Simulator. See CLAUDE.md's iOS section.
import Foundation
import RoomPlan

@MainActor
final class CaptureCoordinator: NSObject, ObservableObject {
  struct Result {
    let scan: Data
    let meta: Data
    let name: String
  }

  let roomCaptureView = RoomCaptureView(frame: .zero)
  let heading = HeadingReader()

  @Published var isCapturing = false
  @Published var showRoomFinishedPrompt = false
  @Published var isMerging = false
  @Published var errorMessage: String?
  @Published private(set) var capturedRoomCount = 0

  private var capturedRooms: [CapturedRoom] = []
  var projectName = ""

  override init() {
    super.init()
    roomCaptureView.delegate = self
  }

  // RoomCaptureViewDelegate : NSCoding (verified against Apple's current
  // RoomPlan docs — an unexpected inheritance for a delegate protocol, but
  // real). We don't support state restoration, so these are stubs; RoomPlan
  // never calls them for a delegate assigned programmatically like this one.
  required nonisolated init?(coder: NSCoder) {
    fatalError("CaptureCoordinator does not support NSCoding-based restoration")
  }

  nonisolated func encode(with coder: NSCoder) {}

  func startRoom() {
    if capturedRooms.isEmpty { heading.start() }
    roomCaptureView.captureSession.run(configuration: RoomCaptureSession.Configuration())
    isCapturing = true
    showRoomFinishedPrompt = false
  }

  func stopRoom() {
    roomCaptureView.captureSession.stop()
  }

  func cancelSession() {
    roomCaptureView.captureSession.stop(pauseARSession: true)
    heading.stop()
  }

  func finish(onDone: @escaping (Result) -> Void) {
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
        onDone(Result(scan: payload, meta: metaData, name: name.isEmpty ? "snimka" : name))
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
  nonisolated func captureView(shouldPresent roomDataForProcessing: CapturedRoomData, error: (any Error)?) -> Bool {
    true
  }

  nonisolated func captureView(didPresent processedResult: CapturedRoom, error: (any Error)?) {
    let message = error?.localizedDescription
    Task { @MainActor in
      if let message {
        self.errorMessage = message
        self.isCapturing = false
        return
      }
      self.capturedRooms.append(processedResult)
      self.capturedRoomCount = self.capturedRooms.count
      self.isCapturing = false
      self.showRoomFinishedPrompt = true
    }
  }
}
