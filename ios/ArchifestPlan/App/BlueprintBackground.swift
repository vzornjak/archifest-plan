// A light "blueprint" backdrop for the document launch screen (the Numbers-style
// screen DocumentGroupLaunchScene shows: app title, "Izradi dokument", the recent-
// document grid). Drawn entirely in SwiftUI with Canvas — no image asset — so it
// scales crisply to any screen and its lightness/colour is tunable right here in
// code (the owner asked for a blueprint look, "a touch lighter"). Kept deliberately
// pale so the system's own launch UI stays legible on top.
import SwiftUI

/// Logo iscrtan kao SwiftUI Shape, preveden iz Untitled_logo.svg.
/// Izvorni SVG je bio na canvasu 1024x1024, pa koordinate ovdje
/// koristimo kao "design" prostor koji se skalira na stvarnu veličinu view-a.
struct ArchifestLogoShape: Shape {

    // MARK: - Design canvas (izvorni SVG viewBox)
    private let designSize = CGSize(width: 1024, height: 1024)

    // Gornja "greda" slova A (kraći path)
    private let barPoints: [CGPoint] = [
        CGPoint(x: 453.28, y: 635.12),
        CGPoint(x: 657.85, y: 635.52),
        CGPoint(x: 737.14, y: 782.95),
        CGPoint(x: 369.49, y: 782.95)
    ]

    // Vanjski obris slova A (s "urezom" na vrhu)
    private let aPoints: [CGPoint] = [
        CGPoint(x: 490.00, y: 129.33),
        CGPoint(x: 136.15, y: 782.29),
        CGPoint(x: 278.67, y: 782.42),
        CGPoint(x: 491.73, y: 388.65),
        CGPoint(x: 726.26, y: 782.82),
        CGPoint(x: 887.88, y: 782.95)
    ]

    func path(in rect: CGRect) -> Path {
        let scaleX = rect.width / designSize.width
        let scaleY = rect.height / designSize.height

        func scaled(_ p: CGPoint) -> CGPoint {
            CGPoint(x: rect.minX + p.x * scaleX,
                     y: rect.minY + p.y * scaleY)
        }

        // Jedan Path objekt — obje podputanje (greda + noge slova A) se
        // dodaju u ISTI path i pune se nonzero pravilom, pa se vizualno
        // spajaju u jedan cjeloviti lik, bez rupa ili odvojenih dijelova.
        var path = Path()

        path.move(to: scaled(barPoints[0]))
        for p in barPoints.dropFirst() {
            path.addLine(to: scaled(p))
        }
        path.closeSubpath()

        path.move(to: scaled(aPoints[0]))
        for p in aPoints.dropFirst() {
            path.addLine(to: scaled(p))
        }
        path.closeSubpath()

        return path
    }
}

struct BlueprintBackground: View {
    // Darker blueprint tint (top → bottom) with richer blue for authentic technical drawing look.
    private let paperTop = Color(red: 0.40, green: 0.50, blue: 0.80)
    private let paperBottom = Color(red: 0.08, green: 0.14, blue: 0.28)
    private let ink = Color(red: 1.85, green: 1.92, blue: 2.0)       // Bright blueprint white-blue
    private let inkDim = Color(red: 1.50, green: 1.65, blue: 1.85)  // Dimmed for grid

    var body: some View {
        Canvas { context, size in
            paint(&context, size: size)
        }
        .ignoresSafeArea()
    }

    private func paint(_ context: inout GraphicsContext, size: CGSize) {
        let full = CGRect(origin: .zero, size: size)

        // Paper gradient - darker blueprint background.
        context.fill(
            Path(full),
            with: .linearGradient(
                Gradient(colors: [paperTop, paperBottom]),
                startPoint: .zero,
                endPoint: CGPoint(x: 0, y: size.height)))

        drawGrid(&context, size: size)
        
        // Technical corner brackets
        drawTechnicalAnnotations(&context, size: size)
    }

    // Fine minor grid with a heavier major line every fifth cell — the classic
    // drafting-paper feel.
    private func drawGrid(_ context: inout GraphicsContext, size: CGSize) {
        let step: CGFloat = 24

        var minor = Path()
        var major = Path()
        var i = 0
        var x: CGFloat = 0
        while x <= size.width {
            let line = { (p: inout Path) in
                p.move(to: CGPoint(x: x, y: 0))
                p.addLine(to: CGPoint(x: x, y: size.height))
            }
            if i % 5 == 0 { line(&major) } else { line(&minor) }
            x += step
            i += 1
        }
        i = 0
        var y: CGFloat = 0
        while y <= size.height {
            let line = { (p: inout Path) in
                p.move(to: CGPoint(x: 0, y: y))
                p.addLine(to: CGPoint(x: size.width, y: y))
            }
            if i % 5 == 0 { line(&major) } else { line(&minor) }
            y += step
            i += 1
        }

        context.stroke(minor, with: .color(inkDim.opacity(0.12)), lineWidth: 0.5)
        context.stroke(major, with: .color(inkDim.opacity(0.22)), lineWidth: 1.0)
    }
    
    private func drawTechnicalAnnotations(_ context: inout GraphicsContext, size: CGSize) {
        // Draw corner brackets and title block frame (pure geometry, no text)
        let bracketSize: CGFloat = 40
        let strokeColor = GraphicsContext.Shading.color(ink.opacity(0.25))
        
        // Upper left corner bracket
        var ulBracket = Path()
        ulBracket.move(to: CGPoint(x: 20 + bracketSize, y: 20))
        ulBracket.addLine(to: CGPoint(x: 20, y: 20))
        ulBracket.addLine(to: CGPoint(x: 20, y: 20 + bracketSize))
        context.stroke(ulBracket, with: strokeColor, lineWidth: 1.5)
        
        // Upper right corner bracket
        var urBracket = Path()
        urBracket.move(to: CGPoint(x: size.width - 20 - bracketSize, y: 20))
        urBracket.addLine(to: CGPoint(x: size.width - 20, y: 20))
        urBracket.addLine(to: CGPoint(x: size.width - 20, y: 20 + bracketSize))
        context.stroke(urBracket, with: strokeColor, lineWidth: 1.5)
    }
}

#Preview {
    BlueprintBackground()
}
