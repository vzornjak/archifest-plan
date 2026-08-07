// CaptureScreen — the live RoomPlan capture UI.
//
// Capture starts the moment the screen appears. No Start button, no cover
// over the camera view, and NO BLUR, MATERIALS, OR BRIGHTNESS CHANGES
// anywhere — deliberately, all removed at the owner's request after they
// showed up on a real device. An earlier revision blurred the live
// RoomCaptureView, which forces SwiftUI to rasterize a live AR camera feed
// into an offscreen buffer every frame (hot, sluggish). Don't reintroduce
// `.blur`, `.thinMaterial`, `.shadow`, a full-screen scrim, or
// screen-brightness manipulation here.
//
// Two press-and-hold round buttons sit in the bottom-right quarter of the
// screen: holding Next fills the top room-count badge orange and advances
// to the next room; holding Stop fills it red and ends the session. The
// hold duration itself is the confirmation — no dialogs.
//
// The hold progress lives in its own ObservableObject rather than @State
// here for performance: animating it as view state re-ran this whole body —
// AR view subtree included — at animation framerate.
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

  @State private var cameraDenied = false

  var body: some View {
    ZStack {
      RoomCaptureRepresentable(view: coordinator.roomCaptureView)
        .ignoresSafeArea()

      if cameraDenied {
        deniedContent
      } else if coordinator.isMerging {
        ProgressView("Obrada snimke…")
          .tint(.white)
          .foregroundStyle(.white)
      } else if coordinator.isCapturing {
        captureControls
      }
    }
    .statusBarHidden()
    // Drops DocumentGroup's document name and rename chevron — see the
    // helper in ToolbarModifiers.swift for why a `.principal` item alone
    // doesn't do it and what the availability caveat is.
    .removingNavigationTitle()
    .toolbar {
      ToolbarItem(placement: .principal) {
        RoomCountBadge(hold: hold, roomNumber: coordinator.capturedRoomCount + 1)
      }
    }
    .onAppear {
      coordinator.projectName = projectName
      coordinator.onFinished = onFinished
      UIApplication.shared.isIdleTimerDisabled = true
      startIfPermitted()
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

  private var deniedContent: some View {
    VStack(spacing: 12) {
      Image(systemName: "camera.fill").font(.largeTitle)
      Text("Nema pristupa kameri — omogući u Postavkama da bi RoomPlan mogao snimati.")
        .multilineTextAlignment(.center)
        .font(.footnote)
    }
    .foregroundStyle(.white)
    .padding()
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

  /// Starts capture straight away. Only an already-denied camera permission
  /// stops it — the not-yet-asked case doesn't need handling here, because
  /// starting the session is itself what makes iOS show its own permission
  /// prompt.
  private func startIfPermitted() {
    switch AVCaptureDevice.authorizationStatus(for: .video) {
    case .denied, .restricted:
      cameraDenied = true
    default:
      coordinator.startRoom()
    }
  }
}

/// The room counter, doubling as the hold-progress meter. Sits in the
/// navigation bar's centre slot on real system Liquid Glass — not a
/// hand-rolled `.thinMaterial` imitation of it, which is what an earlier
/// pass used and what read as "more frosted" than the bar around it.
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
    .roomBadgeGlass()
  }
}

private extension View {
  /// Genuine Liquid Glass where the OS has it (iOS 26+, `glassEffect`),
  /// falling back to the closest pre-Liquid-Glass equivalent below that —
  /// the deployment target is still iOS 17, so this can't be unconditional.
  @ViewBuilder
  func roomBadgeGlass() -> some View {
    if #available(iOS 26.0, *) {
      self.glassEffect(.regular, in: Capsule())
    } else {
      self.background(.thinMaterial, in: Capsule())
    }
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
