/* ARCHIFEST Plan — geometry.js
 * Pure logic: parsing, geometry and area math for RoomPlan (CapturedRoom) JSON.
 * No DOM access — loadable in Node (module.exports below) for direct testing.
 */

function esc(s){
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function unwrap(obj){
  if (!obj) return { name: null, detail: null };
  if (typeof obj === 'string') return { name: obj, detail: null };
  const key = Object.keys(obj)[0];
  return { name: key, detail: obj[key] };
}

function shoelace2D(pts){
  const n = pts.length;
  let area = 0;
  for (let i=0;i<n;i++){
    const [x1,y1] = pts[i];
    const [x2,y2] = pts[(i+1)%n];
    area += x1*y2 - x2*y1;
  }
  return Math.abs(area)/2;
}

function reshapeMatrix(flat){
  return [flat.slice(0,4), flat.slice(4,8), flat.slice(8,12), flat.slice(12,16)];
}

function localToWorld(lx, ly, lz, rows){
  const [r0,r1,r2,r3] = rows;
  return [
    lx*r0[0] + ly*r1[0] + lz*r2[0] + r3[0],
    lx*r0[1] + ly*r1[1] + lz*r2[1] + r3[1],
    lx*r0[2] + ly*r1[2] + lz*r2[2] + r3[2],
  ];
}

function computeArea(el){
  if (el.polygonCorners && el.polygonCorners.length >= 3) {
    return shoelace2D(el.polygonCorners.map(p => [p[0], p[1]]));
  }
  if (el.dimensions && el.dimensions.length >= 2) return el.dimensions[0] * el.dimensions[1];
  return 0;
}

// upper envelope of the wall polygon: for each x keep the highest point —
// keeps knee points even when the slope reaches floor level
function topProfile(el){
  const ys = el.polygonCorners.map(p => p[1]);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const byX = new Map();
  for (const p of el.polygonCorners) {
    const k = Math.round(p[0]*100);
    if (!byX.has(k) || p[1] > byX.get(k)[1]) byX.set(k, [p[0], p[1]]);
  }
  const pts = [...byX.values()].sort((a,b) => a[0]-b[0]);
  return { minY, maxY, pts };
}

// slope = the top edge actually varies in height; a polygon alone isn't enough
// (a wall can be non-rectangular because of an angled side edge, with a flat top)
function topEdgeSloped(el){
  if (!el.polygonCorners || el.polygonCorners.length < 3) return false;
  const { pts } = topProfile(el);
  if (pts.length < 2) return false;
  const hs = pts.map(p => p[1]);
  return (Math.max(...hs) - Math.min(...hs)) > 0.05;
}

function profileLength(pts){
  let len = 0;
  for (let i=0;i<pts.length-1;i++){
    const [x1,y1] = pts[i], [x2,y2] = pts[i+1];
    len += Math.hypot(x2-x1, y2-y1);
  }
  return len;
}

function wallSegment(w){
  const rows = reshapeMatrix(w.transform);
  const half = w.dimensions[0]/2;
  const p1 = localToWorld(-half, 0, 0, rows);
  const p2 = localToWorld(half, 0, 0, rows);
  return { p1: [p1[0], p1[2]], p2: [p2[0], p2[2]], len: w.dimensions[0] };
}

function furnitureRect(o){
  const rows = reshapeMatrix(o.transform);
  const hw = o.dimensions[0]/2, hd = o.dimensions[2]/2;
  const corners = [
    localToWorld(-hw,0,-hd,rows), localToWorld(hw,0,-hd,rows),
    localToWorld(hw,0,hd,rows), localToWorld(-hw,0,hd,rows)
  ].map(p => [p[0], p[2]]);
  return corners;
}

function floorPolygon(f){
  const rows = reshapeMatrix(f.transform);
  return f.polygonCorners.map(p => {
    const w = localToWorld(p[0], p[1], p[2], rows);
    return [w[0], w[2]];
  });
}

const CONF_LEVELS = ['high','medium','low'];

function annotate(el, kind, roomIdx){
  const cat = unwrap(el.category);
  const conf = unwrap(el.confidence);
  return Object.assign({}, el, {
    kind,
    roomIdx,
    catName: cat.name,
    catDetail: cat.detail,
    confLevel: CONF_LEVELS.includes(conf.name) ? conf.name : 'medium',
    hasSlope: kind === 'wall' && topEdgeSloped(el),
    area: computeArea(el)
  });
}

function buildData(json){
  const walls = [], openings = [], furniture = [], floors = [], sections = [];
  // rooms in a multi-room scan can share elements — count each identifier once,
  // otherwise areas double and shared openings get subtracted twice
  const seen = new Set();
  const push = (arr, el) => {
    if (el.identifier != null) {
      if (seen.has(el.identifier)) return;
      seen.add(el.identifier);
    }
    arr.push(el);
  };

  // yaw of the reference (session) origin frame in room coordinates
  let refRotDeg = null;
  const refT = json.rooms[0] && json.rooms[0].referenceOriginTransform;
  if (refT && refT.length === 16) {
    refRotDeg = Math.atan2(refT[2], refT[0]) * 180/Math.PI;
  }

  json.rooms.forEach((room, roomIdx) => {
    (room.walls || []).forEach(w => push(walls, annotate(w, 'wall', roomIdx)));
    (room.doors || []).forEach(o => push(openings, annotate(o, 'door', roomIdx)));
    (room.windows || []).forEach(o => push(openings, annotate(o, 'window', roomIdx)));
    (room.openings || []).forEach(o => push(openings, annotate(o, 'opening', roomIdx)));
    (room.objects || []).forEach(o => push(furniture, annotate(o, 'object', roomIdx)));
    (room.floors || []).forEach(f => push(floors, annotate(f, 'floor', roomIdx)));
    (room.sections || []).forEach(s => sections.push(Object.assign({ roomIdx }, s)));
  });

  return { walls, openings, furniture, floors, sections, roomCount: json.rooms.length, refRotDeg };
}

function catLabel(el){
  const map = { wall:'Zid', floor:'Pod', window:'Prozor', opening:'Otvor', object: el.catName };
  if (el.kind === 'door') {
    const open = el.catDetail && el.catDetail.isOpen;
    return 'Vrata' + (open === true ? ' (otvorena)' : open === false ? ' (zatvorena)' : '');
  }
  return map[el.kind] || el.catName || '—';
}

// net wall area: gross minus openings linked via parentIdentifier, clamped so
// bad data (opening bigger than its wall) can't produce a negative area
function wallNetArea(data, w){
  const openA = sum(data.openings.filter(o => o.parentIdentifier === w.identifier), o => o.area);
  return Math.max(0, w.area - Math.min(openA, w.area));
}

function reconstructCeilingForRoom(walls){
  if (!walls.length) return null;
  const profileWalls = walls.filter(w => w.hasSlope);
  const flatWalls = walls.filter(w => !w.hasSlope);

  if (!profileWalls.length) {
    // no sloped top edge on any wall — flat ceiling = floor footprint
    return { flat: true, profiles: [] };
  }

  // room depth for profile extrusion: distance between the gable (sloped) walls
  // when we have at least two; otherwise fall back to the longest flat wall
  let roomLength = null;
  if (profileWalls.length >= 2) {
    const centers = profileWalls.map(w => [w.transform[12], w.transform[14]]);
    for (let i=0;i<centers.length;i++){
      for (let j=i+1;j<centers.length;j++){
        const d = Math.hypot(centers[i][0]-centers[j][0], centers[i][1]-centers[j][1]);
        if (roomLength === null || d > roomLength) roomLength = d;
      }
    }
  }
  if (roomLength === null && flatWalls.length) {
    roomLength = Math.max(...flatWalls.map(w => w.dimensions[0]));
  }

  const profiles = profileWalls.map(w => {
    const { minY, maxY, pts } = topProfile(w);
    const len = profileLength(pts);
    const segments = [];
    for (let i=0;i<pts.length-1;i++){
      const [x1,y1] = pts[i], [x2,y2] = pts[i+1];
      const run = Math.abs(x2-x1), rise = Math.abs(y2-y1);
      const isSlope = rise > 0.02;
      const angleDeg = !isSlope ? 0 : (run > 0.001 ? Math.atan(rise/run)*180/Math.PI : 90);
      segments.push({ run, rise, isSlope, angleDeg, length: Math.hypot(run,rise) });
    }
    const heights = pts.map(p => p[1] - minY);
    const kneeWallHeight = heights.length ? Math.min(...heights) : (maxY-minY);
    return { wallId: w.identifier, ridgeHeight: maxY-minY, kneeWallHeight, minY, maxY, segments, profileLength: len };
  });

  const avgProfileLen = profiles.reduce((a,p) => a+p.profileLength, 0) / profiles.length;
  const ceilingArea = roomLength ? avgProfileLen * roomLength : null;

  return { flat: false, profiles, roomLength, avgProfileLen, ceilingArea };
}

// reconstruct per room — mixing gable profiles of one room with wall lengths
// of another produces nonsense in multi-room scans
function reconstructCeiling(data){
  if (!data.walls.length) return null;
  const roomIdxs = [...new Set(data.walls.map(w => w.roomIdx))];
  const rooms = [];
  let total = 0, anySloped = false, unknown = false;
  for (const r of roomIdxs) {
    const part = reconstructCeilingForRoom(data.walls.filter(w => w.roomIdx === r));
    if (!part) continue;
    part.roomIdx = r;
    if (part.flat) {
      part.ceilingArea = sum(data.floors.filter(f => f.roomIdx === r), f => f.area);
    } else {
      anySloped = true;
    }
    if (part.ceilingArea != null) total += part.ceilingArea; else unknown = true;
    rooms.push(part);
  }
  if (!rooms.length) return null;
  return {
    flat: !anySloped,
    rooms,
    profiles: rooms.flatMap(p => p.profiles || []),
    ceilingArea: unknown ? null : total
  };
}

// true-north bearing of world -Z, derived from meta.json heading combined with
// the room's referenceOriginTransform yaw (RoomPlan realigns coordinates to the
// walls; that transform remembers the original session orientation).
// The +90 offset is calibrated against a physically compass-verified scan:
// the app records raw CLHeading, which measures the top of the device, not the
// camera direction — held in landscape at scan start that reads facing - 90.
const HEADING_OFFSET_DEG = 90;
function northBearingFrom(headingDegrees, refRotDeg){
  if (headingDegrees == null) return null;
  return ((headingDegrees - (refRotDeg || 0) + HEADING_OFFSET_DEG) % 360 + 360) % 360;
}

function sum(arr, fn){ return arr.reduce((a, x) => a + fn(x), 0); }

function fmt(n){ if (n === null || n === undefined || isNaN(n)) return '—'; return n.toFixed(2); }

function fmtArea(n){ if (n === null || n === undefined || isNaN(n)) return '—'; return n.toFixed(2) + ' m²'; }

const APPLE_EPOCH_MS = 978307200000; // 2001-01-01 UTC — Apple/Core Data reference date

// Node test hook — ignored in the browser
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    esc, unwrap, shoelace2D, reshapeMatrix, localToWorld, computeArea,
    topProfile, topEdgeSloped, profileLength, wallSegment, furnitureRect,
    floorPolygon, CONF_LEVELS, annotate, buildData, catLabel, wallNetArea,
    reconstructCeilingForRoom, reconstructCeiling, northBearingFrom,
    sum, fmt, fmtArea, APPLE_EPOCH_MS, HEADING_OFFSET_DEG
  };
}
