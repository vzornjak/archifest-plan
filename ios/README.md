# ARCHIFEST Plan — iOS

Native wrapper: RoomPlan capture in, the same web report (`../index.html`,
`app.js`, `geometry.js`, `style.css` at the repo root, unmodified) out, in a
`WKWebView`. See the "iOS app" section of `../CLAUDE.md` for the design
decisions and what's still unverified.

## Requirements

- Xcode 15+ (this project targets iOS 17.0, for RoomPlan's multi-room
  `StructureBuilder`/`CapturedStructure` merge).
- [xcodegen](https://github.com/yonaskolb/XcodeGen) to (re)generate the
  `.xcodeproj` — `brew install xcodegen`.
- A LiDAR-equipped device (iPhone 12 Pro or later, iPad Pro with LiDAR) to
  actually capture a room. RoomPlan does **not** run in Simulator — build and
  run there to test everything else (the app shell, the report, the JS
  bridge) against the bundled sample scan ("Učitaj uzorak" on the home
  screen).

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

## Known-unverified (needs a real device)

- The multi-room merge (`StructureBuilder.capturedStructure(from:)`) hasn't
  been checked against a real multi-room walkthrough.
- `HEADING_OFFSET_DEG = 90` in `geometry.js` was calibrated against a
  different app's heading convention and a landscape-at-scan-start
  assumption RoomPlan doesn't share — the compass on the floor plan may be
  off until this is checked against a known direction on-device.
