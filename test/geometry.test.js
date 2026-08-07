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
}

console.log('');
if (failures) { console.log(failures + ' FAILURE(S)'); process.exit(1); }
console.log('All tests passed.');
