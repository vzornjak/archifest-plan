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
// offset is -90, physically re-calibrated (see HEADING_OFFSET_DEG in geometry.js)
eq('north = heading - refRot - 90', g.northBearingFrom(90.52, 89.56), ((90.52 - 89.56 - 90) % 360 + 360) % 360, 1e-9);
eq('north wraps into [0,360)', g.northBearingFrom(10, 200), ((10 - 200 - 90) % 360 + 360) % 360, 1e-9);
eq('north null without heading', g.northBearingFrom(null, 45), null);

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
  eq('shared wall: full (not halved) area on the kitchen side', sharedInKitchen.netArea, 3*H, 1e-6);
  eq('shared wall: full (not halved) area on the bedroom side', sharedInBedroom.netArea, 3*H, 1e-6);
  eq('shared wall cross-references the other room', sharedInKitchen.sharedWith, bedroomZone.zoneId);

  ok('exterior wall (A-left) appears only in one room\'s list',
    kitchenWalls.some(w => w.wall.identifier === 'A-left') && !bedroomWalls.some(w => w.wall.identifier === 'A-left'));

  // sanity: per-room breakdown is additive on top of, not a replacement for,
  // the existing globally-deduplicated totals
  eq('global wall count still deduplicated (7 walls, not 8)', twoRoomData.walls.length, 7);
}

console.log('');
if (failures) { console.log(failures + ' FAILURE(S)'); process.exit(1); }
console.log('All tests passed.');
