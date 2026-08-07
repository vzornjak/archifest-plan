// CaptureScreen — the live RoomPlan capture UI: RoomCaptureView full-screen,
// a "Gotovo" button to stop the current room, then a choice to add another
// room (multi-room walkthrough) or finish and generate the report.
import SwiftUI
import RoomPlan

struct CaptureScreen: View {
  @StateObject private var coordinator = CaptureCoordinator()
  let projectName: String
  let onFinished: (_ scan: Data, _ meta: Data, _ name: String) -> Void

  @Environment(\.dismiss) private var dismiss

  var body: some View {
    ZStack {
      RoomCaptureRepresentable(view: coordinator.roomCaptureView)
        .ignoresSafeArea()

      VStack {
        HStack {
          Button("Odustani") {
            coordinator.cancelSession()
            dismiss()
          }
          .buttonStyle(.bordered)

          Spacer()

          Text("Prostorija \(coordinator.capturedRoomCount + 1)")
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(.thinMaterial, in: Capsule())
        }
        .padding()

        Spacer()

        if coordinator.isCapturing {
          Button("Gotovo") { coordinator.stopRoom() }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .padding(.bottom, 40)
        }

        if coordinator.isMerging {
          ProgressView("Obrada snimke…")
            .padding()
            .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12))
            .padding(.bottom, 40)
        }
      }
    }
    .statusBarHidden()
    .onAppear {
      coordinator.projectName = projectName
      coordinator.startRoom()
    }
    .confirmationDialog(
      "Prostorija snimljena",
      isPresented: $coordinator.showRoomFinishedPrompt,
      titleVisibility: .visible
    ) {
      Button("Dodaj još jednu prostoriju") { coordinator.startRoom() }
      Button("Završi i generiraj izvještaj") {
        coordinator.finish { result in
          onFinished(result.scan, result.meta, result.name)
        }
      }
      Button("Odustani", role: .cancel) {
        coordinator.cancelSession()
        dismiss()
      }
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
}
