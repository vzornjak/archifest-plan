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

## iOS app (planned, not started)

Decisions already taken:

- **Same repo, `ios/` subfolder.** `geometry.js` is the app's engine; two repos
  means two versions of the truth.
- The web files are **not copied** into `ios/`. An Xcode Run Script build phase
  copies them from the repo root into the bundle, so the app can never ship
  stale maths.
- `CapturedRoom` (iOS 16+) and `CapturedStructure` (iOS 17+) are both `Codable`
  — verified against Apple's docs, not memory. `JSONEncoder` output is exactly
  the format this tool already reads.
- **Entry points already exist**: `applyScan(name, json)` and
  `applyMeta(json, scanFollows)` are globals in `app.js`. Native side calls them
  via `evaluateJavaScript`. `app.js:90` already unwraps a bare `CapturedRoom`,
  and the `rooms[]` loop already handles a merged `CapturedStructure` — though
  whether a *merged* structure yields correct numbers needs a real merged scan
  to confirm, not an assumption.
- Use Apple's RoomPlan sample as a **reference**, don't paste it in. The repo is
  MIT; Apple's sample carries its own licence and copying it makes that claim
  untrue.
- **RoomPlan does not run in the Simulator** (`isSupported` is false — no LiDAR).
  Test everything else in the Simulator against a bundled synthetic fixture in
  `ios/**/Fixtures/`; live capture has to be checked on a device.
- Simulator needs no code signing. An Apple ID is only needed for device
  deployment, a paid account only for the App Store.
- `window.print()` needs replacing with native print/PDF inside a WKWebView.

## Known, deliberately not fixed

- Dimension labels overlap on the plan around short walls, and the RoomPlan
  section label (`Unidentified`) collides with them.
- Classification votes by furniture, so an open-plan space with an oven, a
  fridge and three sofas comes out "Dnevni boravak" — the kitchen is lost.
- Single storey only.
- No prices, no line items, no export beyond the browser print dialog. This is
  the biggest gap between the tool and an actual *troškovnik*.
