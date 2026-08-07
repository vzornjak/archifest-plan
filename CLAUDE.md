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
  is false there — confirmed, `HomeView` correctly shows the "not supported"
  message instead of a broken capture button). Everything else is tested in
  the Simulator against the bundled synthetic fixture in `ios/**/Fixtures/`.
- Simulator needs no code signing. An Apple ID is only needed for device
  deployment, a paid account only for the App Store.

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

## Known, deliberately not fixed

- Dimension labels overlap on the plan around short walls, and the RoomPlan
  section label (`Unidentified`) collides with them.
- Classification votes by furniture, so an open-plan space with an oven, a
  fridge and three sofas comes out "Dnevni boravak" — the kitchen is lost.
- Single storey only.
- No prices, no line items, no export beyond the browser print dialog. This is
  the biggest gap between the tool and an actual *troškovnik*.
