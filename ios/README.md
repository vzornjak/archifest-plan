# ARCHIFEST Plan — iOS

Native wrapper: RoomPlan capture in, the same web report (`../index.html`,
`app.js`, `geometry.js`, `style.css` at the repo root, unmodified) out. A
document-based app (SwiftUI `DocumentGroup`) — each scan is a real file, its
own type (`.archifp`, a real zip — see `ArchifestZip.swift`), browsable and
reopenable from the system's own Numbers-style document browser; it can also
open a loose `scan.json`/`meta.json`, the shape the web app's drag-and-drop
already accepts. See the "iOS app" section of `../CLAUDE.md` for the design
decisions and what's still unverified.

## Requirements

- Xcode 15+ (this project targets iOS 17.0, for RoomPlan's multi-room
  `StructureBuilder`/`CapturedStructure` merge).
- [xcodegen](https://github.com/yonaskolb/XcodeGen) to (re)generate the
  `.xcodeproj` — `brew install xcodegen`.
- A LiDAR-equipped device (iPhone 12 Pro or later, iPad Pro with LiDAR) to
  actually capture a room. RoomPlan does **not** run in Simulator — build and
  run there to test everything else (the document browser, the report, the JS
  bridge) against the bundled sample scan ("Učitaj uzorak" on a new, empty
  document — the only path reachable without a LiDAR device).

## iCloud needs a paid Apple Developer account

`ArchifestPlan.entitlements` declares the iCloud Documents capability so
scans save into the app's own iCloud Drive folder, matching Numbers. **This
does nothing on a free "Personal Team"** — confirmed, Apple blocks the iCloud
capability outright on free accounts, no error, it's just unavailable. To
actually enable it once there's a paid membership: Xcode → target →
Signing & Capabilities → confirm "iCloud" is ticked with "iCloud Documents"
under Services, pick the real Team, and Xcode will provision the
`iCloud.hr.archifest.plan` container (or generate its own — update the
entitlements file to match if so). Until then the app works correctly with
on-device storage only, no crash.

## Build

```bash
cd ios
xcodegen generate
open ArchifestPlan.xcodeproj
```

Or from the command line:

```bash
xcodebuild -project ArchifestPlan.xcodeproj -scheme ArchifestPlan \
  -destination 'platform=iOS Simulator,name=<a simulator>' build
```

**Regenerate the project (`xcodegen generate`) whenever you add or remove a
source file** — `project.yml` lists folders, not individual files, but
`xcodegen` still needs to be re-run to pick up new/removed ones; it isn't
watched live like SwiftPM's synchronized groups.

## What copies the web files in

`project.yml`'s `preBuildScripts` entry ("Copy web report files") copies
`index.html`/`app.js`/`geometry.js`/`style.css` from the repo root into the
app bundle on every build, and **fails the build** if one is missing. This is
the guarantee that the app can never ship maths that's out of sync with the
web report — see CLAUDE.md's release ritual for why that's mattered before.

## The zip format (`.archifp`)

`ArchifestZip.swift` is a hand-rolled zip reader/writer — no third-party
library, deliberately narrow (store only, a handful of small JSON entries,
no Zip64/encryption/directories). Verified independently of Xcode: it
compiles as a plain `swiftc` command-line tool (the `Compression`-free STORE
approach needs nothing iOS-only), round-tripped against macOS's real
`zip`/`unzip` CLI in both directions, including a corrupted-archive and a
DEFLATE-entry rejection case. Do not add compression without re-running that
kind of check — raw DEFLATE framing is exactly where a hand-rolled zip tends
to go subtly wrong.

## Known-unverified (needs a real device, or a human tap)

- The multi-room merge (`StructureBuilder.capturedStructure(from:)`) hasn't
  been checked against a real multi-room walkthrough.
- `HEADING_OFFSET_DEG = 90` in `geometry.js` was calibrated against a
  different app's heading convention and a landscape-at-scan-start
  assumption RoomPlan doesn't share — the compass on the floor plan may be
  off until this is checked against a known direction on-device.
- **Opening a file via "Open in ARCHIFEST Plan"** (from Files/Mail/Share
  sheet): confirmed the OS correctly resolves our app as the owner of
  `.archifp` (via `UTExportedTypeDeclarations`/`CFBundleDocumentTypes`) and
  stages the file into the app's `Documents/Inbox` — that's real, observed
  evidence the type registration works. The last step, actually tapping
  "Open" to hand the file to `ArchifestDocument.init(configuration:)`, needs
  a human tap; `xcrun simctl openurl` routes a `file://` through Safari's
  download flow, which stops at that same tap. Same category of limitation
  as the print button and live RoomPlan capture.
- Real iCloud sync, for the reason above (no paid account here).
