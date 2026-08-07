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

// Trade convention, not geometry: when painting, an opening up to this size is
// not deducted at all — the time saved on the hole is spent right back on its
// reveals, corners and masking. Above it, only the excess comes off (a 4 m²
// opening deducts 1 m²). Net area stays the geometrically honest number and is
// what cross-checks against meta.json; this is the one that goes in a quote.
const PAINT_FREE_OPENING_M2 = 3;

function wallPaintArea(data, w){
  const deduct = sum(data.openings.filter(o => o.parentIdentifier === w.identifier),
                     o => Math.max(0, o.area - PAINT_FREE_OPENING_M2));
  return Math.max(0, w.area - Math.min(deduct, w.area));
}

// ---------- Room segmentation (raster/flood-fill, no external geometry library) ----------
//
// Raw RoomPlan JSON gives one floor polygon for the whole level and no per-room
// wall/floor breakdown at all (only coarse `sections` center-points). To get
// real per-room floor area, furniture membership, and — critically — which
// room(s) each wall borders (an interior wall needs painting on BOTH sides,
// each counted in full, not split in half), we rasterize the floor into a
// fine grid and flood-fill the free space. This avoids pulling in a general
// polygon union/difference library (turf.js + its polygon-clipping dependency
// is ~30-45KB gzip even trimmed to the needed modules) and is naturally
// robust to T-junctions and near-touching walls that break exact vector
// clipping — nothing here can "fail to clip", worst case is a slightly
// blocky boundary at the chosen cell resolution.

const CELL_M = 0.02;              // grid resolution
// Wall centerlines sit right at the floor polygon boundary in real scans, so
// ANY band width eats that much off each room's raster-measured floor area —
// this is purely a flood-fill connectivity guard (stop leaking through a
// wall line at grid resolution), not a wall-thickness estimate, so it's kept
// to the minimum that reliably blocks a CELL_M grid (~1.5 cells) rather than
// a plausible physical thickness. Does not affect any reported wall/paint
// area — those still come from dimensions/polygonCorners, never from the grid.
const WALL_BAND_HALF_M = CELL_M * 1.5;
const MIN_ZONE_AREA_M2 = 0.3;     // below this, treat as rasterization noise, not a room
const MAX_GRID_CELLS = 4_000_000; // adaptive cell growth keeps this bounded

function pointSegDist(px, pz, x1, z1, x2, z2){
  const dx = x2-x1, dz = z2-z1;
  const len2 = dx*dx + dz*dz;
  let t = len2 > 0 ? ((px-x1)*dx + (pz-z1)*dz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1+t*dx), pz - (z1+t*dz));
}

function markBand(occ, gw, gh, p1, p2, halfWidth, minX, minZ, cell){
  const minCX = Math.max(0, Math.floor((Math.min(p1[0],p2[0])-halfWidth-minX)/cell));
  const maxCX = Math.min(gw-1, Math.ceil((Math.max(p1[0],p2[0])+halfWidth-minX)/cell));
  const minCZ = Math.max(0, Math.floor((Math.min(p1[1],p2[1])-halfWidth-minZ)/cell));
  const maxCZ = Math.min(gh-1, Math.ceil((Math.max(p1[1],p2[1])+halfWidth-minZ)/cell));
  for (let cz=minCZ; cz<=maxCZ; cz++){
    for (let cx=minCX; cx<=maxCX; cx++){
      const wx = minX + (cx+0.5)*cell, wz = minZ + (cz+0.5)*cell;
      if (pointSegDist(wx, wz, p1[0], p1[1], p2[0], p2[1]) <= halfWidth) occ[cz*gw+cx] = 1;
    }
  }
}

// standard even-odd scanline polygon fill — marks grid cells whose center
// falls inside the polygon
function markPolygonInside(inside, gw, gh, poly, minX, minZ, cell){
  const n = poly.length;
  if (n < 3) return;
  for (let cz=0; cz<gh; cz++){
    const wz = minZ + (cz+0.5)*cell;
    const xs = [];
    for (let i=0;i<n;i++){
      const [x1,z1] = poly[i], [x2,z2] = poly[(i+1)%n];
      if ((z1 <= wz && z2 > wz) || (z2 <= wz && z1 > wz)) {
        xs.push(x1 + (wz-z1)/(z2-z1)*(x2-x1));
      }
    }
    xs.sort((a,b)=>a-b);
    for (let i=0;i+1<xs.length;i+=2){
      const cxStart = Math.max(0, Math.ceil((xs[i]-minX)/cell - 0.5));
      const cxEnd = Math.min(gw-1, Math.floor((xs[i+1]-minX)/cell - 0.5));
      for (let cx=cxStart; cx<=cxEnd; cx++) inside[cz*gw+cx] = 1;
    }
  }
}

// segmentRooms: floods free (non-wall) space into connected components =
// candidate rooms. zoneId here is unrelated to `roomIdx` elsewhere in this
// file (roomIdx is just the index into the JSON's rooms[] array — almost
// always 0, since a real scan is one rooms[0] entry with `sections` inside,
// not a real per-room breakdown). zoneId is the actual physical room found
// by this segmentation.
function segmentRooms(data){
  if (!data.walls.length) return { zones: [], grid: null };
  const xs = [], zs = [];
  for (const w of data.walls) { const s = wallSegment(w); xs.push(s.p1[0], s.p2[0]); zs.push(s.p1[1], s.p2[1]); }
  for (const f of data.floors) { for (const p of floorPolygon(f)) { xs.push(p[0]); zs.push(p[1]); } }
  if (!xs.length) return { zones: [], grid: null };

  const pad = 0.3;
  const minX = Math.min(...xs)-pad, maxX = Math.max(...xs)+pad;
  const minZ = Math.min(...zs)-pad, maxZ = Math.max(...zs)+pad;
  const spanX = maxX-minX, spanZ = maxZ-minZ;

  let cell = CELL_M;
  let gw = Math.max(1, Math.ceil(spanX/cell)), gh = Math.max(1, Math.ceil(spanZ/cell));
  while (gw*gh > MAX_GRID_CELLS) { cell *= 1.5; gw = Math.max(1, Math.ceil(spanX/cell)); gh = Math.max(1, Math.ceil(spanZ/cell)); }

  const occ = new Uint8Array(gw*gh);
  for (const w of data.walls) { const s = wallSegment(w); markBand(occ, gw, gh, s.p1, s.p2, WALL_BAND_HALF_M, minX, minZ, cell); }

  // constrain to inside the floor polygon(s) so padding/outside space never
  // forms a bogus "room"; without a floor polygon (rare) this constraint is
  // skipped and a stray outside sliver is possible — known limitation
  let inside = null;
  if (data.floors.length) {
    inside = new Uint8Array(gw*gh);
    for (const f of data.floors) markPolygonInside(inside, gw, gh, floorPolygon(f), minX, minZ, cell);
  }
  const free = i => !occ[i] && (!inside || inside[i]);

  const label = new Int32Array(gw*gh).fill(-1);
  const zones = [];
  let nextId = 0;

  for (let cz=0; cz<gh; cz++){
    for (let cx=0; cx<gw; cx++){
      const i = cz*gw+cx;
      if (!free(i) || label[i] !== -1) continue;
      const zoneId = nextId++;
      const comp = [i];
      label[i] = zoneId;
      let head = 0, minCX=cx, maxCX=cx, minCZ=cz, maxCZ=cz;
      while (head < comp.length) {
        const cur = comp[head++];
        const curCZ = (cur / gw) | 0, curCX = cur % gw;
        if (curCX<minCX) minCX=curCX; if (curCX>maxCX) maxCX=curCX;
        if (curCZ<minCZ) minCZ=curCZ; if (curCZ>maxCZ) maxCZ=curCZ;
        const cands = [];
        if (curCX>0) cands.push(cur-1);
        if (curCX<gw-1) cands.push(cur+1);
        if (curCZ>0) cands.push(cur-gw);
        if (curCZ<gh-1) cands.push(cur+gw);
        for (const n of cands) {
          if (label[n] !== -1 || !free(n)) continue;
          label[n] = zoneId;
          comp.push(n);
        }
      }
      const areaM2 = comp.length * cell * cell;
      if (areaM2 < MIN_ZONE_AREA_M2) {
        for (const c of comp) label[c] = -2; // discarded noise, not a room, not "outside" either
        continue;
      }
      zones.push({
        zoneId, cells: comp.length, areaRaster: areaM2, area: areaM2,
        bboxW: (maxCX-minCX+1)*cell, bboxH: (maxCZ-minCZ+1)*cell,
        center: [minX+(minCX+maxCX+1)/2*cell, minZ+(minCZ+maxCZ+1)/2*cell]
      });
    }
  }

  // The raster measures TOPOLOGY well (which cell belongs to which room) but
  // always under-measures AREA: every cell the wall band covers is lost, so
  // the zone areas sum short of the true floor polygon — 32.30 vs 33.34 m²
  // (3.1%) on a real scan. That polygon area matches meta.json's
  // floorAreaSquareMetres to six decimals and is the strongest correctness
  // anchor the tool has, so per-room areas are rescaled to land on it exactly.
  // Everything reported to the user uses areaExact; areaRaster is kept only
  // for diagnostics. A finer fix (handing wall-band cells to the nearest
  // room instead of scaling) would change the split slightly but not the sum.
  const floorTotal = sum(data.floors, f => f.area);
  const rasterTotal = zones.reduce((a, z) => a + z.areaRaster, 0);
  const scale = (floorTotal > 0 && rasterTotal > 0) ? floorTotal / rasterTotal : 1;
  for (const z of zones) { z.areaExact = z.areaRaster * scale; z.area = z.areaExact; }

  return { zones, grid: { label, gw, gh, minX, minZ, cell }, areaScale: scale, floorTotal };
}

function zoneIdAt(grid, x, z){
  if (!grid) return null;
  const cx = Math.floor((x - grid.minX)/grid.cell), cz = Math.floor((z - grid.minZ)/grid.cell);
  if (cx<0 || cx>=grid.gw || cz<0 || cz>=grid.gh) return null;
  const id = grid.label[cz*grid.gw+cx];
  return (id === -1 || id === -2) ? null : id;
}

// ---------- Room classification — furniture-category voting + geometric vetoes ----------
// Adapted from room_classifier.js (no turf.js — area/bboxW/bboxH come from segmentRooms)

const OBJECT_VOTES = {
  stove: 'Kitchen', oven: 'Kitchen', refrigerator: 'Kitchen', dishwasher: 'Kitchen',
  toilet: 'Bathroom', bathtub: 'Bathroom', sink: 'Bathroom', // sink alone is ambiguous — see kitchen-anchor override below
  washerDryer: 'Laundry',
  bed: 'Bedroom',
  sofa: 'LivingRoom', television: 'LivingRoom', fireplace: 'LivingRoom',
  stairs: 'Hallway',
};

const ZONE_LABELS_HR = {
  Kitchen: 'Kuhinja', Bathroom: 'Kupaonica', Laundry: 'Praonica', Bedroom: 'Spavaća soba',
  LivingRoom: 'Dnevni boravak', Hallway: 'Hodnik', Closet: 'Ormar', Other: 'Ostalo',
};

function classifyZone(zone, objectsInside){
  const votes = {};
  for (const o of objectsInside) {
    const label = OBJECT_VOTES[o.catName];
    if (label) votes[label] = (votes[label] || 0) + 1;
  }
  // sink is unreliable alone — RoomPlan doesn't distinguish kitchen/bathroom sinks;
  // if a kitchen anchor is also present, sink votes count toward Kitchen instead
  const hasKitchenAnchor = objectsInside.some(o => ['stove','oven','refrigerator'].includes(o.catName));
  if (votes['Bathroom'] && hasKitchenAnchor) {
    votes['Kitchen'] = (votes['Kitchen'] || 0) + votes['Bathroom'];
    delete votes['Bathroom'];
  }
  let winner = Object.keys(votes).sort((a,b) => votes[b]-votes[a])[0] || null;

  const aspectRatio = Math.max(zone.bboxW, zone.bboxH) / Math.max(0.01, Math.min(zone.bboxW, zone.bboxH));
  const narrow = Math.min(zone.bboxW, zone.bboxH);

  if (zone.area < 1.5 && !winner) return 'Closet';
  if (narrow < 1.3 && aspectRatio > 2.5 && !winner) return 'Hallway';
  if (winner === 'Bathroom' && zone.area > 15) winner = null; // stray sink in a big room

  return winner || 'Other';
}

function furnitureByZone(data, grid){
  const map = new Map();
  for (const f of data.furniture) {
    const zid = zoneIdAt(grid, f.transform[12], f.transform[14]);
    if (zid == null) continue;
    if (!map.has(zid)) map.set(zid, []);
    map.get(zid).push(f);
  }
  return map;
}

// ---------- Walls per room, including shared and partly-shared walls ----------
// Walks ALONG each wall in small steps, sampling both sides against the zone
// grid, and credits every room the length it actually borders. A room's share
// of that wall is coveredLength / wallLength, applied to the wall's net area.
//
// Sampling only the midpoint (as this did originally) is wrong on any real
// floor plan, because walls routinely span several rooms: a single long
// exterior wall would be credited in full to whichever room happened to sit at
// its midpoint, and rooms further along it got nothing. Measured on a 12x8 m
// five-room flat, per-room wall area came out between 29% and 146% of the true
// value, and one wall whose midpoint landed exactly on a partition was
// credited to no room at all. Since these figures drive painting/tiling
// quotes, that made them unusable.
//
// An interior wall dividing two rooms is still credited in FULL to each of
// them (each face needs its own coat) — that falls out naturally, since both
// sides are sampled over the wall's whole length. Overall gross/net totals
// elsewhere stay globally deduplicated; this is a separate, additive breakdown.
const WALL_SAMPLE_OFFSET_M = 0.15; // how far off the centerline to probe
const WALL_SAMPLE_STEP_M = 0.1;    // resolution along the wall

function wallsByZone(data, segmentation){
  const { grid } = segmentation;
  const map = new Map();
  if (!grid) return map;

  for (const w of data.walls) {
    const s = wallSegment(w);
    const dx = s.p2[0]-s.p1[0], dz = s.p2[1]-s.p1[1];
    const len = Math.hypot(dx, dz);
    if (!(len > 0)) continue;
    const nx = -dz/len, nz = dx/len;
    const steps = Math.max(1, Math.ceil(len / WALL_SAMPLE_STEP_M));
    const segLen = len / steps;

    const coveredByZone = new Map();  // zoneId -> border length along this wall
    const neighbours = new Map();     // zoneId -> Set of zones facing it across the wall
    for (let i = 0; i < steps; i++) {
      const t = (i + 0.5) / steps;
      const px = s.p1[0] + dx*t, pz = s.p1[1] + dz*t;
      const zA = zoneIdAt(grid, px + nx*WALL_SAMPLE_OFFSET_M, pz + nz*WALL_SAMPLE_OFFSET_M);
      const zB = zoneIdAt(grid, px - nx*WALL_SAMPLE_OFFSET_M, pz - nz*WALL_SAMPLE_OFFSET_M);
      for (const [zid, other] of [[zA, zB], [zB, zA]]) {
        if (zid == null) continue;
        coveredByZone.set(zid, (coveredByZone.get(zid) || 0) + segLen);
        if (other != null && other !== zid) {
          if (!neighbours.has(zid)) neighbours.set(zid, new Set());
          neighbours.get(zid).add(other);
        }
      }
    }

    const fullNet = wallNetArea(data, w);
    const fullPaint = wallPaintArea(data, w);
    for (const [zid, covered] of coveredByZone) {
      // share can legitimately exceed 1 (up to 2) when BOTH faces of a wall
      // belong to the same room — a partition or nook divider jutting into it.
      // Both faces get painted, so both are counted; clamping here used to
      // silently drop the second face.
      const share = covered / len;
      if (!map.has(zid)) map.set(zid, []);
      map.get(zid).push({
        wall: w,
        grossArea: w.area * share,
        netArea: fullNet * share,
        paintArea: fullPaint * share,
        fullNetArea: fullNet,
        fullPaintArea: fullPaint,
        share,
        sharedWith: [...(neighbours.get(zid) || [])]
      });
    }
  }
  return map;
}

// Control: how much wall never made it into ANY room's list. A wall silently
// vanishing from the per-room breakdown is a real failure mode (it was the bug
// behind 29-146% per-room errors before length-walking replaced midpoint
// sampling), and unlike the floor there is no external figure to compare the
// split against — so completeness is what gets watched instead.
// Shares above 1 (both faces of a partition in one room) are capped here: this
// asks "was the whole wall seen?", not "how many faces were counted?".
const WALL_COVERAGE_MIN = 0.98;
function wallCoverage(data, segmentation){
  const byWall = new Map();
  for (const list of wallsByZone(data, segmentation).values()) {
    for (const e of list) byWall.set(e.wall.identifier, (byWall.get(e.wall.identifier) || 0) + Math.min(e.share, 1));
  }
  const walls = [];
  let missingArea = 0, totalArea = 0;
  for (const w of data.walls) {
    const assigned = Math.min(byWall.get(w.identifier) || 0, 1);
    totalArea += w.area;
    if (assigned < WALL_COVERAGE_MIN) {
      missingArea += w.area * (1 - assigned);
      walls.push({ wall: w, assigned });
    }
  }
  return { walls, missingArea, totalArea, assignedFraction: totalArea > 0 ? 1 - missingArea/totalArea : 1 };
}

// A knee wall's top edge sits exactly at the roof section's knee, so matching
// wall height against the knee height read off the section identifies it
// outright rather than by heuristic: on a real scan the knee wall measured
// 1.649 m and the section's knee came out 1.649 m, while every other wall in
// the room stood at the 2.483 m ridge height.
const KNEE_MATCH_TOL_M = 0.06;
// two sloped walls count as facing the same way (one extrusion direction)
// when their headings agree modulo 180°
const SLOPE_PARALLEL_TOL_DEG = 15;

// Ceiling area = the floor it covers, PLUS the surplus each roof slope adds
// over its own horizontal projection.
//
// The earlier model was `average profile × distance between the sloped walls`,
// which had to guess a length for the WHOLE section — including its flat part,
// whose area is already known exactly from the floor polygon. Guessing a known
// quantity is pure loss, and the guess was wrong whenever a sloped wall was not
// an end gable: on a real scan a 2.42 m stub wall beside a hallway put the two
// "gables" 7.83 m apart in an 11.93 m room, and averaging its profile with the
// 3.60 m gable's invented a cross-section that exists nowhere. The result came
// out 25.54 m² against a 33.34 m² floor — a ceiling smaller than the room it
// covers — and adding the hallway made it SHRINK (30.19 → 25.54).
//
// Splitting the section into flat and sloped parts leaves only one thing to
// estimate, the length over which the slope runs, and that is measured rather
// than guessed: it is the knee wall's length. Everything else comes from the
// floor polygon, which matches meta.json to six decimals.
//
// Two guarantees fall out of the decomposition and are covered by tests:
// the surplus can never be negative, so ceiling >= floor always; and the
// surplus can never exceed a slope covering the entire footprint, so
// ceiling <= floor × sectionRatio. Adding floor area always adds ceiling.
function reconstructCeilingForRoom(walls, floorArea){
  if (!walls.length) return null;
  const profileWalls = walls.filter(w => w.hasSlope);
  const flatWalls = walls.filter(w => !w.hasSlope);

  if (!profileWalls.length) {
    // no sloped top edge on any wall — flat ceiling = floor footprint
    return { flat: true, profiles: [] };
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
    // horizontal span and surplus both read off THIS polygon, so the ratio
    // between them stays self-consistent (dimensions[0] deliberately unused)
    const span = segments.reduce((a,s) => a + s.run, 0);
    const surplus = segments.reduce((a,s) => a + (s.isSlope ? s.length - s.run : 0), 0);
    return { wallId: w.identifier, ridgeHeight: maxY-minY, kneeWallHeight, minY, maxY,
             segments, profileLength: len, span, surplus };
  });

  // The widest sloped wall sees most of the room's cross-section; blending it
  // with a narrow stub wall's partial view is what produced the phantom
  // section before, so the widest one alone is the section of record.
  const section = profiles.reduce((a, p) => p.span > a.span ? p : a);
  const sectionRatio = section.span > 0 ? section.profileLength / section.span : 1;
  const upperBound = floorArea > 0 ? floorArea * sectionRatio : null;

  // A roof that changes in BOTH directions breaks the single-section
  // assumption entirely; sloped walls facing different ways are the signal.
  const dirs = profileWalls.map(w => {
    const s = wallSegment(w);
    return ((Math.atan2(s.p2[1]-s.p1[1], s.p2[0]-s.p1[0]) * 180/Math.PI) % 180 + 180) % 180;
  });
  const notParallel = dirs.some(a => dirs.some(b => {
    const d = Math.abs(a-b) % 180;
    return Math.min(d, 180-d) > SLOPE_PARALLEL_TOL_DEG;
  }));

  // Length the slope runs for, measured from the knee walls. Knee walls on
  // opposite sides of one room span the same length, so their total divided
  // by the number of slopes recovers that length (and stays right when the
  // two sides differ, as long as their pitches are alike).
  const kneeWalls = flatWalls.filter(w =>
    Math.abs(w.dimensions[1] - section.kneeWallHeight) <= KNEE_MATCH_TOL_M &&
    w.dimensions[1] < section.ridgeHeight - KNEE_MATCH_TOL_M);
  const slopeCount = section.segments.filter(s => s.isSlope).length;
  const slopeExtent = (kneeWalls.length && slopeCount > 0)
    ? kneeWalls.reduce((a, w) => a + w.dimensions[0], 0) / slopeCount
    : null;

  let ceilingArea = null, method = null, roomLength = null;
  if (floorArea > 0 && slopeExtent != null) {
    // clamped: the slope cannot add more than it would covering the whole floor
    ceilingArea = Math.min(floorArea + section.surplus * slopeExtent, upperBound);
    method = 'knee';
  } else if (upperBound != null) {
    // no knee wall found — assume the slope runs the full footprint
    ceilingArea = upperBound;
    method = 'section';
  } else {
    // no floor polygon for this room at all: last resort, the old extrusion
    if (profileWalls.length >= 2) {
      const centers = profileWalls.map(w => [w.transform[12], w.transform[14]]);
      for (let i=0;i<centers.length;i++){
        for (let j=i+1;j<centers.length;j++){
          const d = Math.hypot(centers[i][0]-centers[j][0], centers[i][1]-centers[j][1]);
          if (roomLength === null || d > roomLength) roomLength = d;
        }
      }
    }
    if (roomLength === null && flatWalls.length) roomLength = Math.max(...flatWalls.map(w => w.dimensions[0]));
    ceilingArea = roomLength ? section.profileLength * roomLength : null;
    method = 'extrusion';
  }

  return {
    flat: false, profiles, section, sectionRatio, floorArea: floorArea || null,
    slopeSurplus: section.surplus, slopeExtent, slopeCount,
    kneeWallIds: kneeWalls.map(w => w.identifier),
    ceilingArea, method, notParallel, roomLength
  };
}

// reconstruct per room — mixing gable profiles of one room with wall lengths
// of another produces nonsense in multi-room scans
function reconstructCeiling(data){
  if (!data.walls.length) return null;
  const roomIdxs = [...new Set(data.walls.map(w => w.roomIdx))];
  const rooms = [];
  let total = 0, anySloped = false, unknown = false;
  for (const r of roomIdxs) {
    const roomFloor = sum(data.floors.filter(f => f.roomIdx === r), f => f.area);
    const part = reconstructCeilingForRoom(data.walls.filter(w => w.roomIdx === r), roomFloor);
    if (!part) continue;
    part.roomIdx = r;
    if (part.flat) {
      part.ceilingArea = roomFloor;
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

// Ceiling per SEGMENTED room — the unit that actually matters. RoomPlan's own
// grouping is one CapturedRoom for the whole scan, so reconstructCeiling above
// runs once over everything and smears one roof section across rooms that do
// not share it: on a real scan that pushed a hallway's flat ceiling up to the
// living room's pitch (35.73 m² instead of 35.31 m²). Here each zone brings
// only its own walls, so a zone with no sloped wall of its own simply gets a
// flat ceiling equal to its floor.
function ceilingByZone(data, segmentation){
  const map = new Map();
  if (!segmentation || !segmentation.zones.length) return map;
  const byZone = wallsByZone(data, segmentation);
  for (const zone of segmentation.zones) {
    const walls = (byZone.get(zone.zoneId) || []).map(e => e.wall);
    const floorArea = zone.areaExact != null ? zone.areaExact : zone.area;
    const part = walls.length ? reconstructCeilingForRoom(walls, floorArea) : null;
    if (!part || part.flat) {
      map.set(zone.zoneId, { flat: true, profiles: [], floorArea, ceilingArea: floorArea, method: 'flat' });
    } else {
      part.zoneId = zone.zoneId;
      map.set(zone.zoneId, part);
    }
  }
  return map;
}

// true-north bearing of world -Z, derived from meta.json heading combined with
// the room's referenceOriginTransform yaw (RoomPlan realigns coordinates to the
// walls; that transform remembers the original session orientation).
// The +90 offset is calibrated against a physically verified scan: the app
// records raw CLHeading, which measures the top of the device, not the camera
// direction — held in landscape at scan start that reads facing - 90.
//
// History worth keeping, because this constant was flipped to -90 once and it
// was the wrong call. A reading of "needle at 180deg when the plan looked
// aligned" was taken in PORTRAIT, where the real fault was the portrait
// orientation pick (fixed separately by deriving portrait as a fixed quarter
// turn from the landscape base). Applying that portrait-only observation to
// this global constant flipped LANDSCAPE too — which had always been correct.
//
// Note the rose angle comes out identical for either sign (the wall-alignment
// step absorbs it), so the rose is not the thing to check: what differs is the
// plan DRAWING, which rotates a full 180deg. Verify by facing true north with
// the plan in its automatic (landscape) orientation — the drawing must match
// the room and the live needle must sit at the top of the rose.
const HEADING_OFFSET_DEG = 90;
function northBearingFrom(headingDegrees, refRotDeg){
  if (headingDegrees == null) return null;
  return ((headingDegrees - (refRotDeg || 0) + HEADING_OFFSET_DEG) % 360 + 360) % 360;
}

// ---------- Plan orientation ----------
// Pure decision logic for how the floor plan is rotated on screen — extracted
// out of the DOM layer because every orientation bug this project has had
// (offset sign, inverted rotation sense, the Portrait 180° flip) lived here
// while it was untestable inside renderPlan.
//
// Inputs:
//   wallAngle      — screen angle (deg) of the longest wall's segment, from atan2
//   northB         — true-north bearing of world -Z (northBearingFrom), or null
//   override       — 'landscape' | 'portrait' | null (user's manual toggle)
//   panelLandscape — fallback preference when north is unknown (panel wider than tall)
// Returns: { rotDeg, landscape, auto }
//
// Rules, in order:
// 1. All four axis-aligned rotations keep the walls straight; when north is
//    known, the base is whichever of the four puts true north closest to the
//    top of the screen — that also decides Portrait/Landscape, because a 90°
//    step swaps them (Portrait alone can never reach north-up when the walls
//    run ~90° off north, as on the reference scan: 87°/93° vs Landscape's 3°).
// 2. The OTHER orientation is a fixed -90° quarter turn from that base, never
//    an independent "north closest to up" pick: in the non-north-up
//    orientation both candidates sit ~90° from the top, so that criterion is
//    decided by a few degrees of wall angle yet flips the drawing by 180° —
//    physically verified to land the wrong way round.
// 3. Without meta.json north is unknown; orientation is just the panel shape
//    (or the manual override) and rotation aligns the longest wall.
function planOrientation(opts){
  const { wallAngle, northB, override, panelLandscape } = opts;
  const norm = a => ((a % 360) + 360) % 360;
  if (northB != null) {
    const offsetFor = step => {
      const rose = norm(-wallAngle + step - northB);
      return Math.abs(rose > 180 ? rose - 360 : rose);
    };
    let base = 0;
    for (const step of [90, 180, 270]) if (offsetFor(step) < offsetFor(base)) base = step;
    const baseLandscape = base % 180 === 0;
    const landscape = override != null ? override === 'landscape' : baseLandscape;
    return {
      rotDeg: norm(-wallAngle + base + (landscape === baseLandscape ? 0 : -90)),
      landscape,
      auto: override == null
    };
  }
  const landscape = override != null ? override === 'landscape' : !!panelLandscape;
  return { rotDeg: norm(-wallAngle + (landscape ? 0 : 90)), landscape, auto: override == null };
}

function sum(arr, fn){ return arr.reduce((a, x) => a + fn(x), 0); }

function fmt(n){ if (n === null || n === undefined || isNaN(n)) return '—'; return n.toFixed(2); }

function fmtArea(n){ if (n === null || n === undefined || isNaN(n)) return '—'; return n.toFixed(2) + ' m²'; }

// Shown in the report header so it is always obvious which build is running.
// Bump together with the ?v= query strings in index.html when shipping —
// mobile Safari otherwise keeps serving stale JS after a deploy, which has
// repeatedly led to fixes being tested against old code.
const APP_VERSION = '2026-08-07f';

const APPLE_EPOCH_MS = 978307200000; // 2001-01-01 UTC — Apple/Core Data reference date

// Node test hook — ignored in the browser
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    esc, unwrap, shoelace2D, reshapeMatrix, localToWorld, computeArea,
    topProfile, topEdgeSloped, profileLength, wallSegment, furnitureRect,
    floorPolygon, CONF_LEVELS, annotate, buildData, catLabel, wallNetArea, wallPaintArea, PAINT_FREE_OPENING_M2,
    reconstructCeilingForRoom, reconstructCeiling, northBearingFrom, planOrientation,
    sum, fmt, fmtArea, APPLE_EPOCH_MS, APP_VERSION, HEADING_OFFSET_DEG,
    segmentRooms, zoneIdAt, classifyZone, furnitureByZone, wallsByZone, ceilingByZone, wallCoverage,
    OBJECT_VOTES, ZONE_LABELS_HR,
    CELL_M, WALL_BAND_HALF_M, MIN_ZONE_AREA_M2
  };
}
