// CaptureScreen — the live RoomPlan capture UI.
//
// Flow: blur + "Priprema…" while camera permission is resolved -> a Start
// button (capture begins exactly on that tap, never before it) -> blur again
// briefly until RoomPlan itself confirms the session is live
// (RoomCaptureSessionDelegate.didStartWith, via CaptureCoordinator.isSessionReady)
// -> live view with two press-and-hold round buttons (Next/Stop) in the
// bottom-right quarter of the screen. No tap-then-dialog anywhere: holding
// Next fills the top room-count badge orange and advances to the next room
// once fully held; holding Stop fills it red and ends the session — the
// hold duration itself is the confirmation.
//
// No custom "Odustani"/Cancel button either — DocumentGroup already gives
// this screen a system back chevron (it's hosted inside DocumentGroup's own
// navigation bar, not a NavigationStack of our own), and leaving by any
// means (chevron tap, edge-swipe-back) triggers `.onDisappear`, which cancels
// the session the same way "Odustani" used to.
import SwiftUI
import RoomPlan
import AVFoundation

struct CaptureScreen: View {
  @StateObject private var coordinator = CaptureCoordinator()
  let projectName: String
  let onFinished: (_ scan: Data, _ meta: Data, _ name: String) -> Void

  @Environment(\.dismiss) private var dismiss

  private enum PermissionState { case checking, granted, denied }
  private enum Phase { case checkingPermission, permissionDenied, readyToStart, startingUp, live, merging }

  @State private var permissionState: PermissionState = .checking
  @State private var holdProgress: CGFloat = 0
  @State private var holdColor: Color = .orange
  @State private var originalBrightness: CGFloat?

  private let badgeWidth: CGFloat = 170

  private var phase: Phase {
    if coordinator.isMerging { return .merging }
    if coordinator.isCapturing { return coordinator.isSessionReady ? .live : .startingUp }
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
        .blur(radius: phase == .live ? 0 : 24)
        .animation(.easeOut(duration: 0.3), value: phase == .live)

      switch phase {
      case .checkingPermission, .startingUp:
        overlay { ProgressView("Priprema…").tint(.white) }
      case .permissionDenied:
        overlay { deniedContent }
      case .readyToStart:
        overlay { startButton }
      case .live:
        captureControls
      case .merging:
        overlay {
          ProgressView("Obrada snimke…")
            .padding()
            .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12))
        }
      }
    }
    .statusBarHidden()
    .toolbar {
      ToolbarItem(placement: .principal) { roomCountBadge }
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

  @ViewBuilder
  private func overlay<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
    VStack {
      Spacer()
      content().foregroundStyle(.white)
      Spacer()
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
    // Capture begins exactly here, not before — the blur/"Priprema…" state
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

  private var roomCountBadge: some View {
    ZStack(alignment: .leading) {
      Capsule().fill(.thinMaterial)
      Capsule()
        .fill(holdColor)
        .frame(width: badgeWidth * holdProgress)
      Text("Prostorija \(coordinator.capturedRoomCount + 1)")
        .font(.subheadline.weight(.medium))
        .frame(width: badgeWidth)
    }
    .frame(width: badgeWidth, height: 32)
    .clipShape(Capsule())
  }

  private var captureControls: some View {
    GeometryReader { geo in
      VStack(spacing: 16) {
        HoldButton(systemImage: "forward.fill", tint: .orange, duration: 2.5, progress: $holdProgress, activeColor: $holdColor) {
          holdProgress = 0
          coordinator.advanceToNextRoom()
        }
        HoldButton(systemImage: "stop.fill", tint: .red, duration: 3.5, progress: $holdProgress, activeColor: $holdColor) {
          holdProgress = 0
          coordinator.stopSession()
        }
      }
      // Bottom quarter of the screen, not flush in the corner; inset from
      // the trailing edge.
      .position(x: geo.size.width - 60, y: geo.size.height * 0.78)
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
  }
}

// A round button that must be pressed and HELD for `duration` to fire —
// releasing early cancels. No SwiftUI primitive does this, so it's hand-
// built: `DragGesture(minimumDistance: 0)` fires immediately on touch-down
// (unlike LongPressGesture's movement-threshold-free variant, this also
// tracks release cleanly); the visual fill is a plain linear animation over
// `duration`, and a parallel `Task.sleep` of the same length — cancelled on
// early release — is what actually decides whether the hold "completed".
private struct HoldButton: View {
  let systemImage: String
  let tint: Color
  let duration: Double
  @Binding var progress: CGFloat
  @Binding var activeColor: Color
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
    activeColor = tint
    withAnimation(.linear(duration: duration)) { progress = 1 }
    task = Task {
      try? await Task.sleep(for: .seconds(duration))
      guard !Task.isCancelled else { return }
      onConfirmed()
    }
  }

  private func cancel() {
    task?.cancel()
    task = nil
    withAnimation(.easeOut(duration: 0.15)) { progress = 0 }
  }
}
