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
eq('north = heading - refRot + 90', g.northBearingFrom(90.52, 89.56), 90.52 - 89.56 + 90, 1e-9);
eq('north wraps into [0,360)', g.northBearingFrom(10, 200), (10 - 200 + 90 + 360) % 360, 1e-9);
eq('north null without heading', g.northBearingFrom(null, 45), null);

// --- robustness ---
ok('string enums unwrapped', g.unwrap('wall').name === 'wall');
eq('degenerate polygon falls back to dims', g.computeArea({ polygonCorners: [[0,0,0],[1,0,0]], dimensions:[2,3,0] }), 6);
ok('esc neutralizes html', g.esc('<img onerror=x>') === '&lt;img onerror=x&gt;');

console.log('');
if (failures) { console.log(failures + ' FAILURE(S)'); process.exit(1); }
console.log('All tests passed.');
