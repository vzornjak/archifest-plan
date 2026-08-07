// CaptureScreen — the live RoomPlan capture UI.
//
// Flow: a Start button (capture begins exactly on that tap, never before
// it) -> live view with two press-and-hold round buttons (Next/Stop) in the
// bottom-right quarter of the screen. No tap-then-dialog anywhere: holding
// Next fills the top room-count badge orange and advances to the next room
// once fully held; holding Stop fills it red and ends the session — the
// hold duration itself is the confirmation.
//
// NO BLUR, NO MATERIALS, NO BRIGHTNESS CHANGES anywhere in this screen —
// deliberately. An earlier revision blurred the live RoomCaptureView and
// dimmed the screen during capture; the blur forced SwiftUI to rasterize a
// live AR camera feed into an offscreen buffer every frame (hot, sluggish),
// and both were removed at the owner's request after that showed up on a
// real device. Plain opaque colors only. Don't reintroduce `.blur`,
// `.thinMaterial`, `.shadow` or screen-brightness manipulation here.
//
// The hold progress lives in its own ObservableObject rather than @State
// here for the same performance reason: animating it as view state re-ran
// this whole body — AR view subtree included — at animation framerate.
//
// No custom "Odustani"/Cancel button — DocumentGroup already gives this
// screen a system back chevron (it's hosted inside DocumentGroup's own
// navigation bar, not a NavigationStack of our own), and leaving by any
// means (chevron tap, edge-swipe-back) triggers `.onDisappear`, which
// cancels the session the same way "Odustani" used to.
import SwiftUI
import RoomPlan
import AVFoundation

@MainActor
final class HoldProgress: ObservableObject {
  @Published var value: CGFloat = 0
  @Published var color: Color = .orange
}

struct CaptureScreen: View {
  @StateObject private var coordinator = CaptureCoordinator()
  @StateObject private var hold = HoldProgress()
  let projectName: String
  let onFinished: (_ scan: Data, _ meta: Data, _ name: String) -> Void

  @Environment(\.dismiss) private var dismiss

  private enum PermissionState { case checking, granted, denied }
  private enum Phase { case checkingPermission, permissionDenied, readyToStart, live, merging }

  @State private var permissionState: PermissionState = .checking

  private var phase: Phase {
    if coordinator.isMerging { return .merging }
    if coordinator.isCapturing { return .live }
    switch permissionState {
    case .checking: return .checkingPermission
    case .denied: return .permissionDenied
    case .granted: return .readyToStart
    }
  }

  var body: some View {
    ZStack {
      RoomCaptureRepresentable(view: coordinator.roomCaptureView)
        .ignoresSafeArea()

      switch phase {
      case .checkingPermission:
        cover { ProgressView("Priprema…").tint(.white) }
      case .permissionDenied:
        cover { deniedContent }
      case .readyToStart:
        cover { startButton }
      case .live:
        captureControls
      case .merging:
        cover { ProgressView("Obrada snimke…").tint(.white) }
      }
    }
    .statusBarHidden()
    .toolbar {
      // Replaces the navigation title entirely — which is also what removes
      // DocumentGroup's rename popup (the title + chevron) from this screen.
      ToolbarItem(placement: .principal) {
        RoomCountBadge(hold: hold, roomNumber: coordinator.capturedRoomCount + 1)
      }
    }
    .onAppear {
      coordinator.projectName = projectName
      coordinator.onFinished = onFinished
      UIApplication.shared.isIdleTimerDisabled = true
      Task { await checkPermission() }
    }
    .onDisappear {
      coordinator.cancelSession()
      UIApplication.shared.isIdleTimerDisabled = false
    }
    .alert(
      "Greška pri snimanju",
      isPresented: Binding(
        get: { coordinator.errorMessage != nil },
        set: { if !$0 { coordinator.errorMessage = nil } }
      )
    ) {
      Button("OK") { dismiss() }
    } message: {
      Text(coordinator.errorMessage ?? "")
    }
  }

  /// Plain opaque cover for every non-live state. Deliberately a flat color,
  /// not a blur or a material — see the note at the top of this file.
  @ViewBuilder
  private func cover<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
    ZStack {
      Color.black.ignoresSafeArea()
      content().foregroundStyle(.white)
    }
  }

  private var deniedContent: some View {
    VStack(spacing: 12) {
      Image(systemName: "camera.fill").font(.largeTitle)
      Text("Nema pristupa kameri — omogući u Postavkama da bi RoomPlan mogao snimati.")
        .multilineTextAlignment(.center)
        .font(.footnote)
    }
    .padding()
  }

  private var startButton: some View {
    // Capture begins exactly here, not before — the state above this is only
    // ever camera-permission resolution, never RoomPlan quietly running.
    Button {
      coordinator.startRoom()
    } label: {
      Label("Start", systemImage: "play.fill")
        .font(.title3.bold())
        .padding(.horizontal, 32)
        .padding(.vertical, 14)
    }
    .buttonStyle(.borderedProminent)
    .controlSize(.large)
  }

  private var captureControls: some View {
    VStack {
      Spacer()
      HStack {
        Spacer()
        VStack(spacing: 16) {
          HoldButton(systemImage: "forward.fill", tint: .orange, duration: 1.5, hold: hold) {
            coordinator.advanceToNextRoom()
          }
          HoldButton(systemImage: "stop.fill", tint: .red, duration: 2.5, hold: hold) {
            coordinator.stopSession()
          }
        }
        .padding(.trailing, 24)
      }
      // Bottom quarter of the screen, not flush in the corner.
      .padding(.bottom, 80)
    }
  }

  private func checkPermission() async {
    switch AVCaptureDevice.authorizationStatus(for: .video) {
    case .authorized:
      permissionState = .granted
    case .notDetermined:
      let granted = await withCheckedContinuation { continuation in
        AVCaptureDevice.requestAccess(for: .video) { granted in
          continuation.resume(returning: granted)
        }
      }
      permissionState = granted ? .granted : .denied
    default:
      permissionState = .denied
    }
  }
}

/// The room counter, doubling as the hold-progress meter. Sits in the
/// navigation bar's centre slot and is styled to match it — no material
/// background of its own, which is what made it read as "more frosted" than
/// the toolbar around it (the toolbar already provides that treatment; a
/// second layer on top just double-frosts).
///
/// Observes `HoldProgress` on its own so an in-flight hold animation
/// re-renders only this small view, not the whole capture screen (and with
/// it the live AR view subtree) at animation framerate.
private struct RoomCountBadge: View {
  @ObservedObject var hold: HoldProgress
  let roomNumber: Int

  private let width: CGFloat = 150

  var body: some View {
    ZStack(alignment: .leading) {
      Capsule()
        .fill(hold.color.opacity(0.55))
        .frame(width: width * hold.value)
      Text("Prostorija \(roomNumber)")
        .font(.headline)
        .frame(width: width)
    }
    .frame(width: width, height: 30)
    .clipShape(Capsule())
  }
}

// A round button that must be pressed and HELD for `duration` to fire —
// releasing early cancels. No SwiftUI primitive does this, so it's hand-
// built: `DragGesture(minimumDistance: 0)` fires immediately on touch-down,
// the visual fill is a plain linear animation over `duration`, and a
// parallel `Task.sleep` of the same length — cancelled on early release —
// is what actually decides whether the hold "completed".
private struct HoldButton: View {
  let systemImage: String
  let tint: Color
  let duration: Double
  @ObservedObject var hold: HoldProgress
  let onConfirmed: () -> Void

  @State private var task: Task<Void, Never>?

  var body: some View {
    Image(systemName: systemImage)
      .font(.title2.weight(.semibold))
      .foregroundStyle(.white)
      .frame(width: 56, height: 56)
      .background(tint, in: Circle())
      // Tap target noticeably larger than the visible circle.
      .frame(width: 80, height: 80)
      .contentShape(Rectangle())
      .gesture(
        DragGesture(minimumDistance: 0)
          .onChanged { _ in start() }
          .onEnded { _ in cancel() }
      )
  }

  private func start() {
    guard task == nil else { return }
    hold.color = tint
    withAnimation(.linear(duration: duration)) { hold.value = 1 }
    task = Task {
      try? await Task.sleep(for: .seconds(duration))
      guard !Task.isCancelled else { return }
      hold.value = 0
      task = nil
      onConfirmed()
    }
  }

  private func cancel() {
    guard let running = task else { return }
    running.cancel()
    task = nil
    withAnimation(.easeOut(duration: 0.15)) { hold.value = 0 }
  }
}
