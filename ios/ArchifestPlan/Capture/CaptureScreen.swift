// CaptureScreen — the live RoomPlan capture UI.
//
// Flow: dark scrim + "Priprema…" while camera permission is resolved -> a
// Start button (capture begins exactly on that tap, never before it) ->
// live view with two press-and-hold round buttons (Next/Stop) in the
// bottom-right quarter of the screen. No tap-then-dialog anywhere: holding
// Next fills the top room-count badge orange and advances to the next room
// once fully held; holding Stop fills it red and ends the session — the
// hold duration itself is the confirmation.
//
// PERFORMANCE, learned the hard way: an earlier revision put `.blur()` on
// the RoomCaptureView itself to soften the pre-start state. Blurring a live
// AR camera feed forces SwiftUI to rasterize that view into an offscreen
// buffer every single frame — the app got hot and sluggish. There is also
// nothing to blur before Start (the session isn't running yet), so the
// blur was pure cost for no benefit. It's a plain opaque scrim now.
//
// Same reason the hold progress lives in its own ObservableObject rather
// than @State here: animating it as view state re-ran this whole body —
// AR view subtree included — ~60x/second for the length of every hold.
//
// No custom "Odustani"/Cancel button either — DocumentGroup already gives
// this screen a system back chevron (it's hosted inside DocumentGroup's own
// navigation bar, not a NavigationStack of our own), and leaving by any
// means (chevron tap, edge-swipe-back) triggers `.onDisappear`, which cancels
// the session the same way "Odustani" used to.
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
  @State private var originalBrightness: CGFloat?

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
        scrim { ProgressView("Priprema…").tint(.white) }
      case .permissionDenied:
        scrim { deniedContent }
      case .readyToStart:
        scrim { startButton }
      case .live:
        captureControls
      case .merging:
        scrim {
          ProgressView("Obrada snimke…")
            .padding()
            .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12))
        }
      }
    }
    .statusBarHidden()
    .toolbar {
      ToolbarItem(placement: .principal) {
        RoomCountBadge(hold: hold, roomNumber: coordinator.capturedRoomCount + 1)
      }
    }
    .onAppear {
      coordinator.projectName = projectName
      coordinator.onFinished = onFinished
      UIApplication.shared.isIdleTimerDisabled = true
      dimBrightnessSlightly()
      Task { await checkPermission() }
    }
    .onDisappear {
      coordinator.cancelSession()
      UIApplication.shared.isIdleTimerDisabled = false
      restoreBrightness()
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

  /// Opaque cover for every non-live state. Deliberately not a blur of the
  /// camera feed — see the note at the top of this file.
  @ViewBuilder
  private func scrim<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
    ZStack {
      Color.black.opacity(0.92).ignoresSafeArea()
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
    // Capture begins exactly here, not before — the scrim/"Priprema…" state
    // above this is only ever camera-permission resolution, never RoomPlan
    // quietly already running.
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
          HoldButton(systemImage: "forward.fill", tint: .orange, duration: 2.5, hold: hold) {
            coordinator.advanceToNextRoom()
          }
          HoldButton(systemImage: "stop.fill", tint: .red, duration: 3.5, hold: hold) {
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

  private func dimBrightnessSlightly() {
    // Only ever capture the pre-dim value once. onAppear can fire more than
    // once for the same screen; without this guard each pass would store the
    // already-dimmed value as "original" and ratchet the screen darker with
    // no way back.
    guard originalBrightness == nil else { return }
    guard let screen = (UIApplication.shared.connectedScenes.first as? UIWindowScene)?.screen else { return }
    originalBrightness = screen.brightness
    // Modest reduction, not a forced minimum — helps a little with heat and
    // battery, but the dominant cost of a RoomPlan scan is the LiDAR sensor
    // and ARKit/ML processing, not the backlight. Not framed as a real fix.
    screen.brightness = max(0.15, screen.brightness - 0.2)
  }

  private func restoreBrightness() {
    guard
      let original = originalBrightness,
      let screen = (UIApplication.shared.connectedScenes.first as? UIWindowScene)?.screen
    else { return }
    screen.brightness = original
    originalBrightness = nil
  }
}

/// The room counter, doubling as the hold-progress meter. Observes
/// `HoldProgress` on its own so an in-flight hold animation re-renders only
/// this small view, not the whole capture screen (and with it the live AR
/// view subtree) at animation framerate.
private struct RoomCountBadge: View {
  @ObservedObject var hold: HoldProgress
  let roomNumber: Int

  private let width: CGFloat = 170

  var body: some View {
    ZStack(alignment: .leading) {
      Capsule().fill(.thinMaterial)
      Capsule()
        .fill(hold.color)
        .frame(width: width * hold.value)
      Text("Prostorija \(roomNumber)")
        .font(.subheadline.weight(.medium))
        .frame(width: width)
    }
    .frame(width: width, height: 32)
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
