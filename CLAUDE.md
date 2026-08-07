# ARCHIFEST Plan — working notes

Turns Apple RoomPlan (LiDAR) scans into the square metres a Croatian renovation
quote (*troškovnik*) is built from: floor, ceiling and walls **per room**.

Built to replace a Polycam subscription, and to do the one thing Polycam does
not — sloped attic ceilings, per room, with the trade conventions a painter
actually bills by.

The owner communicates in Croatian and the UI is Croatian. Code, comments and
commit messages are English. Keep it that way.

## Hard rules

1. **Never commit client scan data.** Real scans are people's homes. `.gitignore`
   blocks scan/meta-shaped JSON — do not weaken it, and do not commit a real
   scan "just to test". Tests use synthetic fixtures built in the test file.
2. **Zero network calls.** No CDN, no fonts, no analytics, no geocoding, no maps.
   A CSP in `index.html` (`connect-src 'none'`) makes the browser enforce this.
   The scan never leaves the device. If a change would add a request, don't.
3. **No dependencies, no build step.** Four files served as-is. This is why
   maintenance is near zero and why it works offline off a `file://` URL.
4. `geometry.js` must stay DOM-free — it is loaded in Node by the tests and will
   be loaded by the iOS app. `app.js` owns all DOM.

## Layout

| File | What |
|---|---|
| `geometry.js` | all the maths — parsing, areas, segmentation, ceiling, painting. No DOM. |
| `app.js` | DOM, panels, SVG floor plan, compass rose |
| `index.html` | markup + CSP |
| `style.css` | screen theme + print palette |
| `test/geometry.test.js` | synthetic fixtures, no runner, plain `node` |

## Verify

```bash
node --check app.js && node --check geometry.js
node test/geometry.test.js          # prints PASS/FAIL, exits non-zero on failure
```

Browser checks use Playwright against a tiny local static server; drive it with
the real scan the owner supplies (kept outside the repo). Always assert: no JS
errors, `scrollWidth - clientWidth === 0` at 390px **and** 1280px, and **zero
external requests**.

## Release ritual

Bump **`APP_VERSION`** in `geometry.js` **and** the three `?v=` strings in
`index.html` together. Mobile Safari otherwise serves stale JS after a deploy —
this has repeatedly caused fixes to be "tested" against old code. The version is
printed in the report header so a phone can be checked at a glance.

## Git

Work on `claude/new-session-sv70i7`, restart it from `origin/main` before staging
(`git checkout -B claude/new-session-sv70i7 origin/main`) because PRs are
squash-merged and the old branch history no longer applies. Push with
`--force-with-lease`. Open a PR, merge it, confirm the Pages deploy succeeded.

## Domain decisions, and why

Each of these was wrong once. The reasoning matters more than the code.

**The room is the unit of the report, not RoomPlan's structure.** A whole scan
arrives as a single `rooms[0]` entry, so RoomPlan's `roomCount` means "one
capture", not "one room". Rooms are found by rasterising the floor (2 cm grid)
and flood-filling. Split only where walls actually enclose space — an open-plan
kitchen/living stays one room.

**Per-room areas are rescaled onto the floor polygon.** The raster measures
topology well but always under-measures area (wall bands eat cells) — 3% short
on a real scan. That polygon matches `meta.json` to six decimals and is the
strongest correctness anchor there is, so the room areas are normalised to sum
to it exactly.

**Ceiling = the room's floor + what the slope adds above its own footprint.**
The flat part is already known exactly, so only the slope length is estimated —
and it is *measured*, from the knee wall, identified by its height matching the
knee read off the section. Knee walls are grouped by roof **side** and the
longest side wins; dividing by the number of slopes was wrong whenever a slope
had no knee wall of its own (10–14% short). Guarantees, covered by tests:
ceiling is never below the floor, and adding floor area never subtracts ceiling.
The old model produced 25.54 m² of ceiling over a 33.34 m² floor, and *shrank*
when a hallway was added.

**A sloped wall is split between rooms by height, not by length.** Its height
varies along its length; apportioning area by length fraction ran up to 20% out
at a quarter-point cut. `wallHeightAt` reads the top edge off the polygon.

**Painting area ≠ net area.** Trade convention: an opening up to
`PAINT_FREE_OPENING_M2` (3 m²) is not deducted at all — the time saved on the
hole goes into its reveals, corners and masking — and above that only the excess
comes off. Net stays the geometrically honest number and is what cross-checks
against `meta.json`; painting is what goes in the quote. Painting sums **per
room**, so a shared wall counts on both faces.

**Two controls, printed small under the Overview.** Floor: per-room areas and
their sum against `meta.json`. Walls: `gross − openings` against `meta.json`'s
net, plus how much wall was assigned to no room at all (that one found a real
gap). A third — room perimeter from the raster against summed wall lengths — was
written and **dropped**: it runs 8–11% low on every scan because the grid
staircases around angled walls, and a control that always cries wolf devalues
the ones that work.

## iOS app

Built (in `ios/`), compiles, and runs in Simulator against the bundled sample
— see `ios/README.md` for how to build it. What's actually verified vs. still
open:

- **Same repo, `ios/` subfolder.** `geometry.js` is the app's engine; two repos
  means two versions of the truth.
- The web files are **not copied by hand** into `ios/`. `project.yml`'s
  `preBuildScripts` entry ("Copy web report files") copies them from the repo
  root into the bundle on every build and **fails the build** if one's
  missing, so the app can never ship stale maths.
- **Xcode project is generated, not hand-written.** `ios/project.yml` +
  `xcodegen generate` produces `ArchifestPlan.xcodeproj` — a hand-authored
  `.pbxproj` was considered and rejected as too easy to silently corrupt.
  Regenerate after adding/removing source files (`cd ios && xcodegen generate`).
  One real trap already hit: xcodegen has **no top-level `resources:` target
  key** — resource files (Assets.xcassets, the Fixtures JSON) must live under
  `sources:` tagged `buildPhase: resources`, or xcodegen silently drops them
  and the app crashes on launch reaching for a bundle resource that was never
  copied in.
- `CapturedRoom` (iOS 16+) and `CapturedStructure`/`StructureBuilder` (iOS 17+,
  the merge class is called `StructureBuilder`, not `CapturedStructureBuilder`)
  — verified against Apple's current docs at implementation time, not memory.
  `CapturedStructure` has its own top-level `rooms: [CapturedRoom]`, so
  encoding it directly is already the shape `geometry.js` reads.
- **Deployment target is iOS 17.0**, chosen for `StructureBuilder`. No real
  cost: every LiDAR-capable device (iPhone 12 Pro+, iPad Pro 2020+) already
  supports iOS 17+.
- `RoomCaptureViewDelegate` unexpectedly inherits from **`NSCoding`**
  (confirmed against Apple's docs, still surprising for a delegate protocol)
  — a conforming type needs `init?(coder:)`/`encode(with:)` stubs, and under
  Swift 6 strict concurrency those must be `nonisolated` on an `@MainActor`
  type. The isolated-conformance shorthand (`extension X: @MainActor SomeProto`)
  worked for `CLLocationManagerDelegate` but not `RoomCaptureViewDelegate` in
  this Xcode (26.6) — fell back to `nonisolated` delegate methods hopping to
  the main actor via `Task { @MainActor in … }` for that one.
- **Entry points**: `applyScan(name, json)` and `applyMeta(json, scanFollows)`
  in `app.js` are called via `WKWebView.callAsyncJavaScript(_:arguments:...)`
  (typed arguments, not string-concatenated JSON) from `ios/.../ReportWebView.swift`,
  replicating `handleFiles`'s classification order exactly. Confirmed working
  end-to-end in Simulator against the bundled fixture (2-room scan, sloped
  wall, shared identifiers) — report rendered with the right wall/opening/
  furniture counts and "Pravi sjever iz meta.json".
- `window.print()` is overridden by an injected `WKUserScript` (not by editing
  app.js) to call native `webView.pdf(configuration:)` + a share sheet — the
  override itself is verified injected; the actual print/share tap has **not**
  been exercised (no UI-automation tap available in this environment).
- Use Apple's RoomPlan sample as a **reference**, don't paste it in. The repo is
  MIT; Apple's sample carries its own licence and copying it makes that claim
  untrue.
- **RoomPlan does not run in the Simulator** (`RoomCaptureSession.isSupported`
  is false there — confirmed, `ArchifestDocumentScene` correctly shows the
  "not supported" message instead of a broken capture button). Everything
  else is tested in the Simulator against the bundled synthetic fixture in
  `ios/**/Fixtures/`.
- Simulator needs no code signing. An Apple ID is only needed for device
  deployment, a paid account only for the App Store.

### Document-based app: own file format, iCloud folder, opens other files

Owner asked (pointing at Numbers as the reference) for scans to become real,
named files — browsable/reopenable from a history screen, saved into the
app's own iCloud Drive folder, and able to open a loose `scan.json`/
`meta.json` too. Built:

- **`.archifp` is a real zip**, not an Apple-style file package — asked for
  explicitly (renaming it to `.zip` and opening with any unzip tool must
  work). iOS has **no public API to write a real zip** (confirmed by
  research — even Files app's own "Compress" uses a private framework
  third-party apps can't call), so `ArchifestZip.swift` hand-rolls a minimal
  reader/writer instead of adding a dependency — this project's "no
  dependencies" rule is a hard rule for the web app and the owner explicitly
  chose to keep it for iOS too, over the convenience of a library like
  ZIPFoundation. Deliberately narrow scope: store only (no DEFLATE — these
  files are a few KB, compression isn't worth the risk of subtly wrong raw-
  deflate framing), a handful of named entries, no Zip64/encryption. Verified
  independent of Xcode: compiles as a plain `swiftc` command-line tool
  (needs nothing iOS-only), round-tripped against macOS's real `zip`/`unzip`
  CLI both directions, plus a corrupted-archive and a DEFLATE-entry-rejection
  case (confirms it fails loud, not silently, on input outside its scope).
- **`ArchifestDocument: FileDocument`** handles both the app's own
  `hr.archifest.plan.document` UTType and plain `public.json` (a loose
  scan/meta file) in one type — classifies loose json by shape, the same
  rule `app.js`'s `isMeta()` (app.js:72) uses. Tracks its own source kind so
  a document opened from a loose `.json` is never rewritten into a zip on
  save — defensive, since nothing in the app actually edits a document in
  place anyway.
- **App root is `DocumentGroup`, not `WindowGroup`** — `HomeView.swift` is
  gone. The system's own document browser (its "+" and file grid) replaces
  it entirely; confirmed in Simulator it renders correctly, in Croatian,
  visually matching the Numbers reference the owner pointed at ("Izradi
  dokument" / "Povijest" / "Bez nedavnih stavki"). A freshly-created empty
  document goes straight to `CaptureScreen` (or, where RoomPlan isn't
  supported, the same "Učitaj uzorak" fallback) — no separate "new scan"
  button or name-entry step; that **is** the new-document flow now.
- **iCloud needs a paid Apple Developer account — and isn't merely inert on a
  free one, it breaks signing.** First pass declared the capability in
  `ArchifestPlan.entitlements` anyway, reasoning it'd stay harmless until
  upgraded; that was wrong, and the owner hit it directly in Xcode: *"Personal
  development teams... do not support the iCloud capability... Provisioning
  profile... doesn't include the com.apple.developer.icloud-container-
  identifiers... entitlements."* Device builds failed outright, not just
  "iCloud doesn't work." Fixed by removing the iCloud keys from the
  entitlements file entirely (exact keys to restore are commented in-file) —
  confirmed both `xcodebuild ... -destination 'platform=iOS Simulator...'`
  and, more to the point, `-destination 'generic/platform=iOS'` (the real
  device-signing path, resolves an actual signing identity + provisioning
  profile) now succeed clean. `project.yml` also now pins
  `DEVELOPMENT_TEAM: KT5643BW7L` — without it, `xcodegen generate` silently
  drops whatever Xcode's GUI last configured, which is what surfaced as
  "Signing requires a development team" the first time this was checked.
  See `ios/README.md` for the exact Xcode steps once there's a paid
  membership.
- **Confirmed, not just built**: the OS's own LaunchServices/UTI resolution
  correctly identifies the app as owner of `.archifp` (real evidence the
  `UTExportedTypeDeclarations`/`CFBundleDocumentTypes` registration works) —
  `xcrun simctl openurl` on a `file://` URL routed it through Safari's
  download flow and staged it into the app's own `Documents/Inbox`. What
  that **can't** confirm without a human tap: the final "Open in ARCHIFEST
  Plan" hand-off that would actually exercise
  `ArchifestDocument.init(configuration:)` live. Same category of gap as the
  print button and live RoomPlan capture — flagged, not assumed working.

### What RoomPlan actually lets you configure

Asked to check for scan-processing options (beautify, wall straightening,
corner alignment, noise cleanup, "more detailed model"). Checked the
complete public member lists, not guessed:

- **`RoomBuilder.ConfigurationOptions`** (also what `StructureBuilder`'s
  `options:` takes) has exactly **one** case: `.beautifyObjects` —
  furniture only ("realigns chairs around a table"). Already used in
  `CaptureCoordinator.finishSession()`.
- **Wall straightening, corner alignment, noise cleanup are not
  configurable at all** — not a missing toggle, there genuinely isn't one.
  `RoomCaptureSession.Configuration`'s only member besides `init()` is
  `isCoachingEnabled: Bool` (now set explicitly, though `true` was already
  the default). Nothing sets mesh/scan detail level either. This is simply
  the entire configurable surface RoomPlan exposes.
- **Multi-room, without losing AR tracking between rooms**:
  `RoomCaptureSession.stop(pauseARSession: false)` ends the current room's
  capture but leaves the underlying `ARSession` running, so walking through
  a doorway into the next room stays in the same coordinate space. This is
  Apple's own documented technique (WWDC23, "Explore enhancements to
  RoomPlan", session 10192), not a workaround — confirmed before building
  `CaptureCoordinator.advanceToNextRoom()`/`stopSession()` around it.
- **No pause/resume of an in-progress room capture exists** —
  `RoomCaptureSession`'s complete method list is `run`/`stop`/
  `stop(pauseARSession:)`, checked directly. A "Pause" button was considered
  and dropped for exactly this reason (owner's call, after seeing there was
  nothing real for it to control).

### Capture controls: hold-to-confirm Next/Stop, not tap-then-dialog

Replaced the old "Gotovo" button + confirmation-dialog flow. Now:
`CaptureScreen` shows two round buttons (Next, Stop) in the bottom-right
quarter of the screen, each requiring a **press-and-hold** — holding Next
fills the top room-count badge orange over ~2.5s and advances to the next
room; holding Stop fills it red over ~3.5s and ends the session. No SwiftUI
primitive does hold-with-progress, so it's hand-built (`HoldButton` in
`CaptureScreen.swift`): a `DragGesture(minimumDistance: 0)` for immediate
touch-down detection, a `withAnimation(.linear(duration:))` driving the
visual fill, and a parallel `Task.sleep` of the same duration — cancelled on
early release — deciding whether the hold actually completed.

Also: capture no longer starts the instant the screen appears. It now
blurs while camera permission is resolved, reveals an explicit **Start**
button, and `coordinator.startRoom()` is called only on that tap — real
capture data never collects before the user consciously starts it. A second
brief blur covers the gap between the Start tap and RoomPlan's own
`RoomCaptureSessionDelegate.didStartWith` callback (`isSessionReady`).
`UIApplication.isIdleTimerDisabled` is set while the screen is visible so
the screen never auto-locks mid-scan; screen brightness is dimmed modestly
and restored on disappear — worth being honest that this only helps a
little, the dominant heat/battery cost of a RoomPlan scan is the LiDAR
sensor and ARKit/ML processing, not the backlight.

### Navigation chrome: DocumentGroup already provides one bar, don't add a second

Real bug, found by the owner: opening a report showed **two** stacked
navigation bars. Root cause — `DocumentGroup` wraps its editor content in a
navigation bar of its own (confirmed, documented behavior, not a bug in
DocumentGroup); `ReportScreen` was *also* wrapping in its own
`NavigationStack` with its own title/toolbar. Fixed by removing that inner
`NavigationStack` entirely from both `ReportScreen` and `CaptureScreen` —
`.navigationTitle`/`.toolbar` applied directly now attach to DocumentGroup's
one real bar. The "Zatvori" and "Odustani" buttons are gone with it — the
system-provided back chevron in that single bar already does both (leaving
`CaptureScreen` via any means — chevron tap, edge-swipe — triggers
`.onDisappear`, which calls `cancelSession()`, guarded so it's a no-op if
`stopSession()` already ran cleanly). The room-count badge moved into that
same toolbar too, so it gets the native iOS 26 Liquid Glass toolbar styling
for free instead of a hand-rolled `.thinMaterial` capsule approximating it.

Also added there: a trailing (`.primaryAction` — the standard far-right
slot) Share menu with two options — the real `.archifp` file
(`ShareLink(item:)` off `FileDocumentConfiguration.fileURL`, which `URL`
supports natively) and a PDF, which reuses `ReportWebView`'s existing,
already-working `exportAndSharePDF` pipeline via a second trigger path
(`pdfExportTrigger` binding) rather than a separate implementation. The
in-report "Ispis / PDF" button is unchanged, still calls the same code.

### Bug fixed: opening a file with no scan data used to auto-launch capture

`ArchifestDocumentScene` branched only on `document.scan == nil` to decide
whether to show the capture flow — but `scan` is `nil` for two unrelated
reasons: a genuinely new empty document (correct to capture), *and* an
**opened existing file that just has no scan data** (a standalone
`meta.json` shared without its `scan.json`, or a broken `.archifp`) — both
looked identical to that one `if`, so opening either silently started
RoomPlan. Fixed by branching on `(document.source, document.scan)` together
— `document.source` (`new`/`ownArchive`/`looseJSON`) already existed for
the "never rewrite an opened loose json into a zip" guard, it just wasn't
consulted here too. Only `.new` reaches capture now; the other two get a
`NoScanDataView` instead (showing whatever meta info is present, e.g. a
lone heading, rather than nothing). **Verified rendered, not just reasoned
about** — via a temporary debug harness swapping `ArchifestPlanApp`'s scene
to render `ArchifestDocumentScene` directly against the exact
`(source: .looseJSON, scan: nil)` shape (screenshotted, then reverted before
committing) — needed because the real end-to-end path (open an external
file) hits the same "stops at a human tap" limit noted above.

**That fix immediately regressed new-document capture** — the owner hit it
on a real device: creating a brand-new document also started showing
`NoScanDataView` instead of capture. Cause: `DocumentGroup` round-trips a
freshly-created document through disk — writes `.empty`'s zero-entry zip,
then reads it straight back via `init(configuration:)`, the same read path
an opened file takes. That path always tagged anything of our own UTType as
`source = .ownArchive` regardless of content, so a brand-new document and a
genuinely broken opened one became indistinguishable — exactly the bug the
`source` field exists to prevent, just one layer further in than the first
pass caught. Fixed in `init(configuration:)`: an **empty** archive (zero
entries — exactly what `.empty` serializes to) now sets `source = .new`
instead of `.ownArchive`; a non-empty one missing `scan.json` (a real
partial/broken file) still correctly gets `.ownArchive`. Verified the load-
bearing fact directly — `ArchifestZip.data(for: [])` round-trips through
`ArchifestZip.read` as zero entries (22-byte EOCD-only archive, checked with
the same standalone `swiftc` harness the zip module itself was verified
with) — but **the specific interaction that triggers this (tapping "+" in
the document browser) can't be simulated in this environment any more than
opening a shared file can**; the fix is reasoned through and the underlying
zip-level signal is concretely checked, but the owner's real-device tap is
still what actually confirms it end-to-end. Said so plainly rather than
claim more than was actually verified.

### Performance: what made the capture screen hot and sluggish

The owner reported the app slow and crashing after the capture redesign.
Root-caused by auditing what that change introduced (the symptom itself
can't be reproduced here — it only shows during live capture, which needs a
LiDAR device). Four real defects, all self-inflicted by the previous commit:

- **`.blur()` on the live `RoomCaptureView` — the main culprit.** Blurring a
  live AR camera feed forces SwiftUI to rasterize that view into an
  offscreen buffer *every frame*. On top of RoomPlan's already-heavy LiDAR +
  ARKit load, that's exactly the "hot and sluggish" profile, and sustained
  memory-bandwidth pressure like that is also a plausible jetsam kill (which
  reads as a crash). It bought nothing either: before Start the session
  isn't running, so there was no camera image to blur. Replaced with a plain
  opaque scrim. **Don't put `.blur`, `.shadow`, or any offscreen-rendering
  modifier on a live camera/AR view.**
- **Hold-progress animation re-rendered the entire screen at 60fps.** The
  progress value was `@State` on `CaptureScreen`, so animating it 0→1 over
  2.5–3.5s re-evaluated that whole body — AR view subtree included — every
  frame, for the length of every hold. Moved into its own small
  `HoldProgress: ObservableObject` that only the badge observes.
- **`roomCaptureView.captureSession.delegate = self` stole the delegate
  `RoomCaptureView` uses internally** to drive its own live wireframe and
  coaching UI. It was set only to learn when the session became ready, to
  drive the (now removed) blur — real risk of degrading the capture view for
  a purely cosmetic detail. Removed along with `isSessionReady`.
- **Brightness ratchet**: `dimBrightnessSlightly()` stored "the original
  brightness" on every `onAppear`, so a second appearance stored the
  already-dimmed value and the screen stepped darker with no way back. Now
  captured once and cleared on restore.

### Crash: a corrupt `.archifp` used to trap, not throw

Separate from the above, found while auditing: every offset in
`ArchifestZip.read` comes from *inside the file being parsed*, and `Data`'s
subscript/`subdata` **trap on an out-of-range index rather than throwing**.
A truncated or hand-edited archive — entirely possible for a document type
users can receive from anywhere — was a hard crash, not a catchable error.
All such reads now go through bounds checks that throw
`ArchifestZipError.invalidArchive`. Verified with the standalone `swiftc`
harness: valid and empty archives still read correctly, while four
truncation points and a corrupted central-directory offset all throw
cleanly instead of crashing.

### Still needs a real LiDAR device (not verifiable from this environment)

- **The multi-room `StructureBuilder` merge** — built, compiles, but never run
  against an actual multi-room walkthrough.
- **`HEADING_OFFSET_DEG = 90` in `geometry.js`** was calibrated against a
  different app's heading convention and a landscape-at-scan-start assumption
  RoomPlan doesn't share. `HeadingReader` hands back a plain compass reading;
  whether the existing offset still lines up needs an on-device check
  (rotate in a room until the plan matches, same method the original README
  calibration used).
- Live capture UX (coaching overlay, session recovery, real-world accuracy).
- The print button's actual PDF export/share sheet.
- Actually installing/running on the device — code-signing itself is now
  confirmed clean (`generic/platform=iOS` build resolves a real signing
  identity and provisioning profile), but this environment has no physical
  device attached to install onto.

## Known, deliberately not fixed

- Dimension labels overlap on the plan around short walls, and the RoomPlan
  section label (`Unidentified`) collides with them.
- Classification votes by furniture, so an open-plan space with an oven, a
  fridge and three sofas comes out "Dnevni boravak" — the kitchen is lost.
- Single storey only.
- No prices, no line items, no export beyond the browser print dialog. This is
  the biggest gap between the tool and an actual *troškovnik*.
