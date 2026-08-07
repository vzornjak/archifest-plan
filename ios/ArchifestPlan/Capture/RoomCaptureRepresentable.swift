// RoomCaptureRepresentable — thin SwiftUI host for RoomPlan's own capture UI.
// RoomCaptureView already draws the live wireframe/coaching overlay itself;
// this just puts it on screen. All state lives in CaptureCoordinator, which
// owns the view instance so it survives SwiftUI re-renders.
import SwiftUI
import RoomPlan

struct RoomCaptureRepresentable: UIViewRepresentable {
  let view: RoomCaptureView

  func makeUIView(context: Context) -> RoomCaptureView { view }
  func updateUIView(_ uiView: RoomCaptureView, context: Context) {}
}
