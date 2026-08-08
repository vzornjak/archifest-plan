import SwiftUI

extension View {
  /// Removes the navigation title — and, inside a `DocumentGroup`, the
  /// document-name rename affordance that comes with it.
  ///
  /// Supplying a `.principal` toolbar item does NOT replace DocumentGroup's
  /// title (tried; the title kept showing alongside it) — this is the real
  /// API for it. Note the availability: `ToolbarDefaultItemKind` itself is
  /// documented as iOS 17+, but the `.title` case specifically is iOS 18+,
  /// which only the compiler tells you. The deployment target is iOS 17, so
  /// this stays conditional; on iOS 17 the title simply remains.
  @ViewBuilder
  func removingNavigationTitle() -> some View {
    if #available(iOS 18.0, *) {
      self.toolbar(removing: .title)
    } else {
      self
    }
  }
}
