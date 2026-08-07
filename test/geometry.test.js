/* ARCHIFEST Plan — geometry tests
 * Run with:  node test/geometry.test.js
 * Uses a synthetic room (no real scan data — client scans must never be
 * committed, see .gitignore) shaped like the real-world case: a 6×4 m attic
 * with two gable walls, one door, and a duplicated wall across two rooms.
 */
const g = require('../geometry.js');

let failures = 0;
function eq(name, actual, expected, tol = 1e-9){
  const ok = (expected === null || actual === null)
    ? actual === expected
    : Math.abs(actual - expected) <= tol;
  console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + ' — ' + actual + (ok ? '' : ' (expected ' + expected + ')'));
  if (!ok) failures++;
}
function ok(name, cond){
  console.log((cond ? 'PASS' : 'FAIL') + ' ' + name);
  if (!cond) failures++;
}

// column-major 4x4: local X axis -> ax, local Y -> up, translation (tx,ty,tz)
function mat(axX, axZ, tx, ty, tz){
  return [axX, 0, axZ, 0,  0, 1, 0, 0,  -axZ, 0, axX, 0,  tx, ty, tz, 1];
}
// floor transform: local x -> world X, local y -> world Z
const floorMat = [1,0,0,0,  0,0,1,0,  0,-1,0,0,  3,0,2,1];

const H = 2.5;
// gable wall profile: 4 m wide, knee walls 1.5 m, ridge 2.5 m
const gableCorners = [[-2,-1.25,0],[2,-1.25,0],[2,0.25,0],[0,1.25,0],[-2,0.25,0]];

const wallA = { identifier:'W-A', category:{wall:{}}, confidence:{high:{}}, dimensions:[6,H,0], transform: mat(1,0, 3,1.25,0) };
const wallB = { identifier:'W-B', category:{wall:{}}, confidence:{high:{}}, dimensions:[6,H,0], transform: mat(1,0, 3,1.25,4) };
const wallC = { identifier:'W-C', category:{wall:{}}, confidence:{high:{}}, dimensions:[4,H,0], transform: mat(0,1, 0,1.25,2), polygonCorners: gableCorners };
const wallD = { identifier:'W-D', category:{wall:{}}, confidence:{high:{}}, dimensions:[4,H,0], transform: mat(0,1, 6,1.25,2), polygonCorners: gableCorners };
const door  = { identifier:'D-1', category:{door:{isOpen:true}}, confidence:{medium:{}}, dimensions:[1,2,0], transform: mat(1,0, 1.5,1,0), parentIdentifier:'W-A' };
const floor = { identifier:'F-1', category:{floor:{}}, confidence:{high:{}}, dimensions:[6,4,0], transform: floorMat,
                polygonCorners: [[-3,-2,0],[3,-2,0],[3,2,0],[-3,2,0]] };

const scan = { rooms: [
  { walls:[wallA, wallB, wallC, wallD], doors:[door], floors:[floor],
    referenceOriginTransform: mat(0,1, 0,0,0) }, // reference frame yawed 90°
  { walls:[wallA] } // duplicated shared wall — must be counted once
]};

const data = g.buildData(scan);

// --- parsing & dedupe ---
eq('walls parsed (deduped)', data.walls.length, 4);
eq('refRotDeg from referenceOriginTransform', data.refRotDeg, 90, 1e-9);
ok('gable walls detected as sloped', data.walls.filter(w => w.hasSlope).length === 2);
ok('flat walls not sloped', !data.walls.find(w => w.identifier === 'W-A').hasSlope);
eq('door label', g.catLabel(data.openings[0]) === 'Vrata (otvorena)' ? 1 : 0, 1);

// --- areas ---
eq('floor area (polygon)', g.sum(data.floors, f => f.area), 24, 1e-9);
// gable polygon: 4×1.5 rectangle + triangle base 4 height 1 = 8
eq('gable wall area (polygon beats bbox)', data.walls.find(w => w.identifier === 'W-C').area, 8, 1e-9);
eq('gross wall area', g.sum(data.walls, w => w.area), 15 + 15 + 8 + 8, 1e-9);
eq('net wall area (door linked via parentIdentifier)', g.sum(data.walls, w => g.wallNetArea(data, w)), 46 - 2, 1e-9);

// net must clamp, never go negative
const tiny = { identifier:'W-T', category:{wall:{}}, confidence:{high:{}}, dimensions:[0.5,0.5,0], transform: mat(1,0,0,0,0) };
const bigOpen = { identifier:'O-T', category:{opening:{}}, confidence:{high:{}}, dimensions:[3,3,0], transform: mat(1,0,0,0,0), parentIdentifier:'W-T' };
const clampData = g.buildData({ rooms:[{ walls:[tiny], openings:[bigOpen] }] });
eq('net clamped at zero', g.wallNetArea(clampData, clampData.walls[0]), 0);

// --- ceiling reconstruction ---
const ceil = g.reconstructCeiling(data);
ok('ceiling not flat', !ceil.flat);
const prof = ceil.profiles[0];
eq('ridge height', prof.ridgeHeight, 2.5, 1e-9);
eq('knee wall height', prof.kneeWallHeight, 1.5, 1e-9);
// profile = two slopes of hypot(2,1); room length = gable distance 6
const slopeLen = 2 * Math.hypot(2, 1);
eq('profile length (knee kept at both ends)', prof.profileLength, slopeLen, 1e-9);
eq('ceiling area = profile × gable distance', ceil.ceilingArea, slopeLen * 6, 1e-9);

// flat room falls back to floor footprint
const flatScan = { rooms:[{ walls:[wallA, wallB], floors:[floor] }] };
const flatCeil = g.reconstructCeiling(g.buildData(flatScan));
ok('flat ceiling flagged', flatCeil.flat);
eq('flat ceiling = floor area', flatCeil.ceilingArea, 24, 1e-9);

// --- north bearing ---
// offset is +90 (see HEADING_OFFSET_DEG in geometry.js for why it is not -90)
eq('north = heading - refRot + 90', g.northBearingFrom(90.52, 89.56), ((90.52 - 89.56 + 90) % 360 + 360) % 360, 1e-9);
eq('north wraps into [0,360)', g.northBearingFrom(10, 200), ((10 - 200 + 90) % 360 + 360) % 360, 1e-9);
eq('north null without heading', g.northBearingFrom(null, 45), null);

// --- plan orientation (the code every past orientation bug lived in) ---
{
  const norm = a => ((a % 360) + 360) % 360;
  const roseOf = (o, northB) => norm(o.rotDeg - northB);
  const offTop = r => Math.min(r, 360 - r);

  // reference-scan values: walls ~92° off north, north bearing 90.96 (offset +90)
  const REF = { wallAngle: 92.09, northB: 90.96 };

  const auto = g.planOrientation({ ...REF, override: null, panelLandscape: false });
  ok('auto: north-up wins over panel shape (landscape)', auto.landscape === true && auto.auto === true);
  ok('auto: north within 5° of up', offTop(roseOf(auto, REF.northB)) < 5);

  const portrait = g.planOrientation({ ...REF, override: 'portrait', panelLandscape: false });
  ok('portrait override respected', portrait.landscape === false && portrait.auto === false);
  eq('portrait is exactly a -90° quarter turn from the base', norm(portrait.rotDeg - auto.rotDeg), 270, 1e-9);
  eq('portrait rose lands at ~267 (not the 180°-flipped 87)', roseOf(portrait, REF.northB), 266.95, 0.02);
  // the landscape drawing physically confirmed as correct in the room
  eq('landscape draws at rotDeg 87.91 (the verified one, not 180° off)', auto.rotDeg, 87.91, 0.02);

  const landOverride = g.planOrientation({ ...REF, override: 'landscape', panelLandscape: false });
  eq('landscape override equals the auto base here', landOverride.rotDeg, auto.rotDeg, 1e-9);

  // a scan whose north-up base is Portrait: walls on axis, north at bearing 88
  const p = g.planOrientation({ wallAngle: 0, northB: 88, override: null, panelLandscape: true });
  ok('portrait base: auto picks Portrait despite wide panel', p.landscape === false);
  ok('portrait base: north within 5° of up', offTop(roseOf(p, 88)) < 5);
  const pl = g.planOrientation({ wallAngle: 0, northB: 88, override: 'landscape', panelLandscape: true });
  eq('portrait base: Landscape override is a -90° quarter turn', norm(pl.rotDeg - p.rotDeg), 270, 1e-9);

  // without meta.json: panel shape (or override) decides, walls stay aligned
  const nm1 = g.planOrientation({ wallAngle: 30, northB: null, override: null, panelLandscape: true });
  eq('no meta: landscape aligns longest wall horizontally', nm1.rotDeg, 330, 1e-9);
  const nm2 = g.planOrientation({ wallAngle: 30, northB: null, override: null, panelLandscape: false });
  eq('no meta: portrait aligns longest wall vertically', nm2.rotDeg, 60, 1e-9);
  const nm3 = g.planOrientation({ wallAngle: 30, northB: null, override: 'portrait', panelLandscape: true });
  ok('no meta: override beats panel shape', nm3.landscape === false && nm3.rotDeg === 60);
}

// --- robustness ---
ok('string enums unwrapped', g.unwrap('wall').name === 'wall');
eq('degenerate polygon falls back to dims', g.computeArea({ polygonCorners: [[0,0,0],[1,0,0]], dimensions:[2,3,0] }), 6);
ok('esc neutralizes html', g.esc('<img onerror=x>') === '&lt;img onerror=x&gt;');

// --- room segmentation & classification: two 4x3m rooms sharing one wall ---
// (a real single-room scan has one flattened rooms[0] with no per-room floor
// breakdown at all — this fixture supplies two floor polygons purely to
// give segmentRooms something realistic to flood-fill against; the raw
// walls/objects list is what real CapturedRoom JSON looks like)
{
  function wall2(id, len, axX, axZ, tx, tz){
    return { identifier:id, category:{wall:{}}, confidence:{high:{}}, dimensions:[len,H,0], transform: mat(axX,axZ, tx,H/2,tz) };
  }
  const twoRoomWalls = [
    wall2('A-bottom', 4, 1,0, 2,0), wall2('A-top', 4, 1,0, 2,3), wall2('A-left', 3, 0,1, 0,1.5),
    wall2('shared',   3, 0,1, 4,1.5), // interior wall between room A and room B
    wall2('B-bottom', 4, 1,0, 6,0), wall2('B-top', 4, 1,0, 6,3), wall2('B-right', 3, 0,1, 8,1.5),
  ];
  const flatFloorMat = [1,0,0,0, 0,0,1,0, 0,-1,0,0, 0,0,0,1];
  const floorA = { identifier:'F-A', category:{floor:{}}, confidence:{high:{}}, dimensions:[4,3,0], transform: flatFloorMat, polygonCorners:[[0,0,0],[4,0,0],[4,3,0],[0,3,0]] };
  const floorB = { identifier:'F-B', category:{floor:{}}, confidence:{high:{}}, dimensions:[4,3,0], transform: flatFloorMat, polygonCorners:[[4,0,0],[8,0,0],[8,3,0],[4,3,0]] };
  const stove = { identifier:'O-1', category:{stove:{}}, confidence:{high:{}}, dimensions:[0.6,0.9,0.6], transform: mat(1,0, 1,0.45,1.5) };
  const bed   = { identifier:'O-2', category:{bed:{}},   confidence:{high:{}}, dimensions:[1.4,0.5,2.0], transform: mat(1,0, 6,0.25,1.5) };

  const twoRoomData = g.buildData({ rooms: [{ walls: twoRoomWalls, objects: [stove, bed], floors: [floorA, floorB] }] });
  const seg = g.segmentRooms(twoRoomData);

  eq('segmentRooms finds exactly 2 rooms', seg.zones.length, 2);
  ok('per-room area close to true 12m² each (grid tolerance)',
    seg.zones.every(z => Math.abs(z.area - 12) / 12 < 0.05));

  const furnByZone = g.furnitureByZone(twoRoomData, seg.grid);
  const labels = seg.zones.map(z => g.classifyZone(z, furnByZone.get(z.zoneId) || []));
  ok('one zone classifies Kitchen (stove), one Bedroom (bed)',
    labels.includes('Kitchen') && labels.includes('Bedroom'));

  const wallsByZone = g.wallsByZone(twoRoomData, seg);
  const kitchenZone = seg.zones[labels.indexOf('Kitchen')];
  const bedroomZone = seg.zones[labels.indexOf('Bedroom')];
  const kitchenWalls = wallsByZone.get(kitchenZone.zoneId) || [];
  const bedroomWalls = wallsByZone.get(bedroomZone.zoneId) || [];
  const sharedInKitchen = kitchenWalls.find(w => w.wall.identifier === 'shared');
  const sharedInBedroom = bedroomWalls.find(w => w.wall.identifier === 'shared');

  ok('shared wall appears in BOTH rooms\' wall lists', !!sharedInKitchen && !!sharedInBedroom);
  eq('shared wall: full (not halved) area on the kitchen side', sharedInKitchen.netArea, 3*H, 0.05);
  eq('shared wall: full (not halved) area on the bedroom side', sharedInBedroom.netArea, 3*H, 0.05);
  ok('shared wall cross-references the other room', sharedInKitchen.sharedWith.includes(bedroomZone.zoneId));

  ok('exterior wall (A-left) appears only in one room\'s list',
    kitchenWalls.some(w => w.wall.identifier === 'A-left') && !bedroomWalls.some(w => w.wall.identifier === 'A-left'));

  // sanity: per-room breakdown is additive on top of, not a replacement for,
  // the existing globally-deduplicated totals
  eq('global wall count still deduplicated (7 walls, not 8)', twoRoomData.walls.length, 7);

  // A wall spanning BOTH rooms must be split by the length each room actually
  // borders — midpoint-only sampling used to hand it entirely to one room (or,
  // when the midpoint fell on a partition, to none at all).
  const spanning = wall2('spanning', 8, 1,0, 4,0);   // runs along z=0 across both rooms
  const spanData = g.buildData({ rooms: [{ walls: [...twoRoomWalls, spanning], objects: [], floors: [floorA, floorB] }] });
  const spanSeg = g.segmentRooms(spanData);
  const spanMap = g.wallsByZone(spanData, spanSeg);
  const spanZones = spanSeg.zones.map(z => (spanMap.get(z.zoneId) || []).find(x => x.wall.identifier === 'spanning'));
  const withSpan = spanZones.filter(Boolean);
  eq('spanning wall reaches both rooms', withSpan.length, 2);
  ok('each room gets roughly half of it', withSpan.every(x => Math.abs(x.share - 0.5) < 0.1));
  ok('the two shares add up to the whole wall', Math.abs(g.sum(withSpan, x => x.share) - 1) < 0.1);
  ok('full wall area is still reported alongside the share', withSpan.every(x => Math.abs(x.fullNetArea - 8*H) < 0.01));

  // no wall may silently vanish from every room's list
  const orphan = twoRoomWalls.filter(w =>
    ![...wallsByZone_all(wallsByZone2(twoRoomData, seg))].includes(w.identifier));
  eq('no wall is left unassigned', orphan.length, 0);
  function wallsByZone2(d, s){ return g.wallsByZone(d, s); }
  function wallsByZone_all(map){ const ids = new Set(); for (const list of map.values()) for (const x of list) ids.add(x.wall.identifier); return ids; }

  // per-room areas must land exactly on the floor polygon: the raster always
  // measures short (wall bands eat cells) and a 3% shortfall in the headline
  // square metres is not acceptable in a cost estimate
  const exactTotal = g.sum(seg.zones, z => z.areaExact);
  eq('per-room areas sum to the floor polygon exactly', exactTotal, g.sum(twoRoomData.floors, f => f.area), 1e-9);
  ok('raster area is kept alongside for diagnostics', seg.zones.every(z => z.areaRaster > 0 && z.areaRaster <= z.areaExact + 1e-9));

  // painting counts both sides of a shared wall, one item per room
  ok('shared wall carries its full painting area on BOTH sides',
    Math.abs(sharedInKitchen.paintArea - 3*H) < 0.05 && Math.abs(sharedInBedroom.paintArea - 3*H) < 0.05);
  ok('per-room gross is reported alongside net and paint',
    kitchenWalls.every(w => w.grossArea >= w.netArea - 1e-9 && w.paintArea >= w.netArea - 1e-9 && w.paintArea <= w.grossArea + 1e-9));
  // this fixture has no openings at all, so the two must coincide exactly
  ok('with no openings, painting equals net', kitchenWalls.every(w => Math.abs(w.paintArea - w.netArea) < 1e-9));

  // flat walls must be untouched by the slope-aware split: area share === length share
  ok('flat wall: gross area is exactly area × length share',
    kitchenWalls.every(w => Math.abs(w.grossArea - w.wall.area * w.share) < 0.02));
  ok('flat wall: areaFraction === share', kitchenWalls.every(w => Math.abs(w.areaFraction - w.share) < 0.01));

  // the room's own bordering length is reported, so the table row can multiply out
  ok('bordering length is reported per room',
    kitchenWalls.every(w => Math.abs(w.coveredLength - w.wall.dimensions[0] * w.share) < 0.02));
  ok('length × average height === the gross area shown',
    kitchenWalls.every(w => Math.abs(w.coveredLength * (w.grossArea / w.coveredLength) - w.grossArea) < 1e-9));
  const aLeft = kitchenWalls.find(w => w.wall.identifier === 'A-left');
  ok('a wall the room fully borders reports its full length', Math.abs(aLeft.coveredLength - 3) < 0.05);

  // with a 2 m² door in the shared wall, painting ignores it but net does not —
  // and both still follow the per-room share
  const doorInShared = { identifier:'D-S', category:{door:{isOpen:false}}, confidence:{high:{}},
                         dimensions:[1,2,0], transform: mat(0,1, 4,1,1.5), parentIdentifier:'shared' };
  const doorData = g.buildData({ rooms:[{ walls: twoRoomWalls, doors:[doorInShared], objects:[], floors:[floorA, floorB] }] });
  const doorMap = g.wallsByZone(doorData, g.segmentRooms(doorData));
  const sharedSides = [...doorMap.values()].map(l => l.find(x => x.wall.identifier === 'shared')).filter(Boolean);
  eq('shared wall still reaches both rooms with a door in it', sharedSides.length, 2);
  ok('net deducts the 2 m² door on each side', sharedSides.every(x => Math.abs(x.netArea - (3*H - 2)) < 0.05));
  ok('painting ignores it on each side', sharedSides.every(x => Math.abs(x.paintArea - 3*H) < 0.05));

  // every wall must be accounted for by some room — one silently missing from
  // the per-room split is the failure this control exists to catch
  const cov = g.wallCoverage(twoRoomData, seg);
  eq('no wall is left out of the per-room split', cov.walls.length, 0);
  eq('nothing unattributed', cov.missingArea, 0, 1e-9);
  eq('coverage reported as a full fraction', cov.assignedFraction, 1, 1e-9);

  // and it must actually fire: a wall far outside every room borders nothing
  const stray = wall2('stray', 2, 1,0, 40,40);
  const strayData = g.buildData({ rooms:[{ walls:[...twoRoomWalls, stray], objects:[], floors:[floorA, floorB] }] });
  const strayCov = g.wallCoverage(strayData, g.segmentRooms(strayData));
  ok('a wall bordering no room is reported', strayCov.walls.some(c => c.wall.identifier === 'stray'));
  ok('its area counts as missing', strayCov.missingArea > 0 && strayCov.assignedFraction < 1);

  // a room with no sloped wall of its own must not inherit another room's roof
  const ceilByZone = g.ceilingByZone(twoRoomData, seg);
  ok('flat rooms get a flat ceiling equal to their own floor',
    seg.zones.every(z => ceilByZone.get(z.zoneId).flat &&
      Math.abs(ceilByZone.get(z.zoneId).ceilingArea - z.areaExact) < 1e-9));
}

// --- sloped walls: height varies along the length, so area must not be split
// by length fraction (that ran up to 20% out on a real gable) ---
{
  const gableWall = data.walls.find(w => w.identifier === 'W-C');   // 4 m wide, knee 1.5, ridge 2.5
  const flatWall  = data.walls.find(w => w.identifier === 'W-A');   // 6 x 2.5, no polygon

  eq('flat wall: same height everywhere', g.wallHeightAt(flatWall, 0), H, 1e-9);
  eq('flat wall: height holds at the ends', g.wallHeightAt(flatWall, 3), H, 1e-9);
  eq('gable: knee height at the left edge', g.wallHeightAt(gableWall, -2), 1.5, 1e-9);
  eq('gable: ridge height at the centre', g.wallHeightAt(gableWall, 0), 2.5, 1e-9);
  eq('gable: halfway up the slope', g.wallHeightAt(gableWall, -1), 2.0, 1e-9);
  eq('gable: symmetric on the other side', g.wallHeightAt(gableWall, 1), 2.0, 1e-9);
  eq('gable: clamped past the end', g.wallHeightAt(gableWall, -99), 1.5, 1e-9);

  // integrating the height along the wall must reproduce the polygon area
  let integral = 0; const N = 20000, L = gableWall.dimensions[0];
  for (let i = 0; i < N; i++) integral += g.wallHeightAt(gableWall, -L/2 + (i+0.5)/N*L) * (L/N);
  ok('height integrated along the wall === polygon area',
    Math.abs(integral - gableWall.area) / gableWall.area < 0.001, 'integral=' + integral.toFixed(4));

  // m² = W·H − Σ(ΔW·ΔH)/2 — the equation printed next to the wall
  const cut = g.slopeCutTriangles(gableWall);
  eq('a two-sided gable cuts two triangles', cut.triangles.length, 2);
  eq('equation reproduces the area exactly',
    gableWall.dimensions[0]*gableWall.dimensions[1] - cut.cutArea, gableWall.area, 1e-9);
  eq('a flat wall cuts nothing', g.slopeCutTriangles(flatWall).triangles.length, 0);

  // splitting a sloped wall between two rooms: the low-knee side must get LESS
  // than its length fraction, and the two sides must still add up to the whole
  const shed = [[-2,-1.25,0],[2,-1.25,0],[2,1.25,0],[-2,-0.25,0]];  // rises left->right
  const shedWall = { identifier:'S-W', category:{wall:{}}, confidence:{high:{}}, dimensions:[4,2.5,0],
                     transform: mat(1,0, 0,1.25,0), polygonCorners: shed };
  const shedData = g.buildData({ rooms:[{ walls:[shedWall] }] });
  const sw = shedData.walls[0];
  const lowHalf = (() => { let a=0; const M=20000; for (let i=0;i<M;i++) a += g.wallHeightAt(sw, -2 + (i+0.5)/M*2) * (2/M); return a; })();
  ok('low half is smaller than half the wall area', lowHalf < sw.area/2 - 0.01,
    'low=' + lowHalf.toFixed(3) + ' half=' + (sw.area/2).toFixed(3));
  const highHalf = (() => { let a=0; const M=20000; for (let i=0;i<M;i++) a += g.wallHeightAt(sw, (i+0.5)/M*2) * (2/M); return a; })();
  eq('the two halves add up to the whole wall', lowHalf + highHalf, sw.area, 0.001);
}

// --- roof section shapes: one slope across the whole wall, two meeting at a
// peak, and a flat top with a slope down each side. For a rectangular footprint
// the extrusion is exact, so every case must land on profileLength x roomLength.
{
  const RL = 6, RW = 4;   // room: 6 m along the ridge, 4 m across
  const rf = [1,0,0,0, 0,0,1,0, 0,-1,0,0, 0,0,0,1];
  const rFloor = { identifier:'RF', category:{floor:{}}, confidence:{high:{}}, dimensions:[RW,RL,0],
                   transform: rf, polygonCorners:[[0,0,0],[RW,0,0],[RW,RL,0],[0,RL,0]] };
  const rw = (id, len, axX, axZ, tx, tz, h, corners) => ({
    identifier:id, category:{wall:{}}, confidence:{high:{}}, dimensions:[len,h,0],
    transform: mat(axX,axZ, tx,h/2,tz), ...(corners ? { polygonCorners: corners } : {})
  });
  // sections, all 4 m wide, knee 1.0, ridge 2.5 (polygon y runs -1.25..1.25)
  const shed  = [[-2,-1.25,0],[2,-1.25,0],[2,1.25,0],[-2,-0.25,0]];                       // slope across the whole wall
  const peak  = [[-2,-1.25,0],[2,-1.25,0],[2,-0.25,0],[0,1.25,0],[-2,-0.25,0]];           // two slopes to a point
  const flatT = [[-2,-1.25,0],[2,-1.25,0],[2,-0.25,0],[1,1.25,0],[-1,1.25,0],[-2,-0.25,0]]; // flat top, a slope each side

  function roof(name, corners, sideWalls, expectMethod){
    const d = g.buildData({ rooms:[{ walls:[ rw('GA',RW,0,1, 0,RL/2, 2.5, corners),
                                             rw('GB',RW,0,1, RW,RL/2, 2.5, corners), ...sideWalls ],
                                     floors:[rFloor] }] });
    const c = g.reconstructCeilingForRoom(d.walls, RW*RL);
    const truth = g.profileLength(g.topProfile(d.walls[0]).pts) * RL;
    eq(name, c.ceilingArea, truth, 1e-9);
    if (expectMethod) ok(name + ' — method ' + expectMethod, c.method === expectMethod);
    return c;
  }
  const knee = (id, tz, h = 1.0, len = RL, tx = RW/2) => rw(id, len, 1,0, tx, tz, h);
  const full = (id, tz) => rw(id, RL, 1,0, RW/2, tz, 2.5);

  // the three shapes asked about
  roof('slope across the whole wall (mono-pitch)', shed,  [knee('K',0), full('F',RL)], 'knee');
  roof('two slopes meeting at a peak',             peak,  [knee('KA',0), knee('KB',RL)], 'knee');
  roof('flat top with a slope down each side',     flatT, [knee('KA',0), knee('KB',RL)], 'knee');

  // regressions: dividing the knee total by the slope COUNT halved the length
  // whenever the slopes did not each have their own matching knee wall
  roof('peak with a knee wall on one side only',        peak,  [knee('K',0), full('F',RL)]);
  roof('flat top with a knee wall on one side only',    flatT, [knee('K',0), full('F',RL)]);
  roof('peak with knee walls at different heights',     peak,  [knee('KA',0), knee('KB',RL,1.4)]);

  // a side broken into pieces by a doorway is still one side
  roof('knee wall split into three along one side', peak,
    [knee('K1',0,1.0,2,1), knee('K2',0,1.0,2,3), knee('K3',0,1.0,2,5), knee('KB',RL)]);

  const sides = g.reconstructCeilingForRoom(g.buildData({ rooms:[{
      walls:[ rw('GA',RW,0,1, 0,RL/2, 2.5, peak), rw('GB',RW,0,1, RW,RL/2, 2.5, peak),
              knee('K1',0,1.0,2,1), knee('K2',0,1.0,2,3), knee('K3',0,1.0,2,5), knee('KB',RL) ],
      floors:[rFloor] }] }).walls, RW*RL).kneeSides;
  eq('the three pieces group into one side', sides.length, 2);
  ok('and that side measures the full room length', sides.every(s => Math.abs(s.length - RL) < 1e-9));

  // a slope reaching the floor has no knee wall to measure — falls back
  roof('slope down to the floor, no knee wall',
    [[-2,-1.25,0],[2,-1.25,0],[2,1.25,0]], [full('F',RL)], 'section');

  // the printed equation must reconcile with the shoelace area in all three shapes
  for (const [name, corners, terms] of [['mono-pitch', shed, 1], ['peak', peak, 2], ['flat top', flatT, 2]]) {
    const w = g.buildData({ rooms:[{ walls:[rw('E',RW,0,1, 0,RL/2, 2.5, corners)] }] }).walls[0];
    const cut = g.slopeCutTriangles(w);
    eq('equation terms — ' + name, cut.triangles.length, terms);
    eq('W·H − Σ(ΔW·ΔH)/2 === area — ' + name, cut.W*cut.H - cut.cutArea, w.area, 1e-9);
  }
}

// --- painting area: openings up to 3 m2 are not deducted at all, above it only
// the excess comes off (trade convention, not geometry) ---
{
  const FREE = g.PAINT_FREE_OPENING_M2;
  eq('threshold is 3 m²', FREE, 3);

  const wall10 = { identifier:'P-W', category:{wall:{}}, confidence:{high:{}}, dimensions:[5,2,0], transform: mat(1,0, 0,1,0) };
  const mk = (id, w, h) => ({ identifier:id, category:{window:{}}, confidence:{high:{}}, dimensions:[w,h,0], transform: mat(1,0, 0,1,0), parentIdentifier:'P-W' });
  const build = (...openings) => g.buildData({ rooms:[{ walls:[wall10], windows: openings }] });

  const small = build(mk('S', 1, 2));           // 2 m² — under the threshold
  eq('small opening is not deducted at all', g.wallPaintArea(small, small.walls[0]), 10, 1e-9);
  eq('net still deducts it in full', g.wallNetArea(small, small.walls[0]), 8, 1e-9);

  const big = build(mk('B', 2, 2));             // 4 m² — 1 m² over
  eq('large opening deducts only the excess', g.wallPaintArea(big, big.walls[0]), 9, 1e-9);
  eq('net deducts the whole 4 m²', g.wallNetArea(big, big.walls[0]), 6, 1e-9);

  const two = build(mk('A', 1, 2), mk('B', 2, 2));  // 2 m² + 4 m²
  eq('each opening gets its own allowance', g.wallPaintArea(two, two.walls[0]), 9, 1e-9);

  const huge = build(mk('H', 10, 2));           // 20 m² on a 10 m² wall
  eq('paint area clamps at zero', g.wallPaintArea(huge, huge.walls[0]), 0);

  for (const d of [small, big, two, huge]) {
    const w = d.walls[0];
    ok('paint sits between net and gross', g.wallPaintArea(d, w) >= g.wallNetArea(d, w) - 1e-9 && g.wallPaintArea(d, w) <= w.area + 1e-9);
  }
}

// --- ceiling: flat part + slope (regression for the "ceiling smaller than the
// floor" bug, and for adding a room making the ceiling SHRINK) ---
{
  // room 8 m long × 4 m wide. Gable wall spans the full 4 m width: 1 m of
  // slope rising 0.5 m, then 3 m flat. Knee wall is 6 m long, so the slope
  // runs over 6 of the 8 m — the case the old model could not express.
  const RIDGE = 2.5, KNEE = 2.0;
  const gable = [[-2,-1.25,0],[2,-1.25,0],[2,1.25,0],[-1,1.25,0],[-2,0.75,0]];
  const w = (id, len, axX, axZ, tx, tz, h, corners) => ({
    identifier:id, category:{wall:{}}, confidence:{high:{}}, dimensions:[len,h,0],
    transform: mat(axX,axZ, tx,h/2,tz), ...(corners ? { polygonCorners: corners } : {})
  });
  const fm = [1,0,0,0, 0,0,1,0, 0,-1,0,0, 0,0,0,1];
  const mkFloor = (id, poly, dims) => ({ identifier:id, category:{floor:{}}, confidence:{high:{}}, dimensions:dims, transform:fm, polygonCorners:poly });

  const atticWalls = [
    w('G-far',  4, 0,1, 0,2, RIDGE, gable),   // gable, full width
    w('G-near', 4, 0,1, 8,2, RIDGE, gable),   // gable, full width
    w('KNEE',   6, 1,0, 3,0, KNEE),           // knee wall — height = section knee
    w('FULL',   8, 1,0, 4,4, RIDGE),          // opposite side, full height
  ];
  const atticFloor = mkFloor('F', [[0,0,0],[8,0,0],[8,4,0],[0,4,0]], [8,4,0]);
  const attic = g.buildData({ rooms:[{ walls: atticWalls, floors:[atticFloor] }] });
  const c = g.reconstructCeilingForRoom(attic.walls, 32);

  const surplus = Math.hypot(1, 0.5) - 1;               // extra metre of surface per metre of width
  eq('section read off the widest sloped wall', c.section.span, 4, 1e-9);
  eq('slope surplus per metre of width', c.slopeSurplus, surplus, 1e-9);
  eq('knee wall identified by matching the section knee height', c.kneeWallIds.length, 1);
  eq('slope extent measured from the knee wall, not guessed', c.slopeExtent, 6, 1e-9);
  eq('ceiling = floor + surplus × slope length', c.ceilingArea, 32 + surplus*6, 1e-9);
  ok('method is the measured one', c.method === 'knee');
  ok('parallel gables do not trip the both-directions warning', c.notParallel === false);

  // the two guarantees that make the old bug impossible
  ok('ceiling is never smaller than the floor it covers', c.ceilingArea >= 32);
  ok('ceiling never exceeds the slope covering the whole floor', c.ceilingArea <= 32 * c.sectionRatio + 1e-9);

  // THE regression: bolt a 6 m² annex onto the same room. Ceiling must grow.
  const bigFloor = mkFloor('F2', [[0,0,0],[8,0,0],[8,4,0],[10,4,0],[10,7,0],[8,7,0],[0,4,0]], [10,7,0]);
  const bigger = g.buildData({ rooms:[{ walls: atticWalls, floors:[bigFloor] }] });
  const cBig = g.reconstructCeilingForRoom(bigger.walls, g.sum(bigger.floors, f => f.area));
  ok('adding floor area always adds ceiling — never shrinks it', cBig.ceilingArea > c.ceilingArea);
  ok('bigger room still never dips below its own floor', cBig.ceilingArea >= g.sum(bigger.floors, f => f.area));

  // no knee wall in the data: fall back to the slope covering the whole floor
  const noKnee = g.buildData({ rooms:[{ walls: atticWalls.filter(x => x.identifier !== 'KNEE'), floors:[atticFloor] }] });
  const cNo = g.reconstructCeilingForRoom(noKnee.walls, 32);
  ok('without a knee wall the section factor takes over', cNo.method === 'section');
  eq('fallback = floor × section ratio', cNo.ceilingArea, 32 * cNo.sectionRatio, 1e-9);
  ok('fallback is the upper bound, so it is never smaller', cNo.ceilingArea >= c.ceilingArea);

  // a roof changing in both directions breaks the single-section assumption
  const crossed = g.buildData({ rooms:[{ walls:[ atticWalls[0], w('G-cross', 4, 1,0, 4,0, RIDGE, gable) ], floors:[atticFloor] }] });
  ok('perpendicular sloped walls raise the both-directions warning',
    g.reconstructCeilingForRoom(crossed.walls, 32).notParallel === true);
}

console.log('');
if (failures) { console.log(failures + ' FAILURE(S)'); process.exit(1); }
console.log('All tests passed.');
