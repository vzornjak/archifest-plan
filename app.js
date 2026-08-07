/* ARCHIFEST Plan — app.js
 * DOM wiring and rendering: file loading, report panels, SVG floor plan,
 * compass rose. Pure math lives in geometry.js.
 */

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const statusEl = document.getElementById('status');
const reportEl = document.getElementById('report');
const printBtn = document.getElementById('printBtn');
const furnToggle = document.getElementById('furnToggle');
const furnPanel = document.getElementById('furnPanel');

dropzone.addEventListener('click', () => fileInput.click());
['dragenter','dragover'].forEach(ev => dropzone.addEventListener(ev, e => { e.preventDefault(); dropzone.classList.add('drag'); }));
['dragleave','drop'].forEach(ev => dropzone.addEventListener(ev, e => { e.preventDefault(); dropzone.classList.remove('drag'); }));
dropzone.addEventListener('drop', e => { handleFiles([...e.dataTransfer.files]); });
// reset value so picking the same (possibly corrected) file re-triggers change
fileInput.addEventListener('change', e => { handleFiles([...e.target.files]); e.target.value = ''; });
printBtn.addEventListener('click', () => window.print());
furnToggle.addEventListener('change', () => {
  furnPanel.classList.toggle('hidden-panel', !furnToggle.checked);
  if (window.__lastData) renderPlan(window.__lastData, furnToggle.checked);
});

const landToggle = document.getElementById('landToggle');
let orientationOverride = null; // null = auto (fit room's long side to the panel's long side)
landToggle.addEventListener('change', () => {
  orientationOverride = landToggle.checked ? 'landscape' : 'portrait';
  if (window.__lastData) renderPlan(window.__lastData, furnToggle.checked);
});

// DIO B: when orientation is auto (no manual toggle), re-run the auto pick on
// an actual physical screen rotation — previously this only ran at load time,
// so rotating the phone after opening a report left the drawing stale.
function debounce(fn, ms){
  let t = null;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
window.addEventListener('resize', debounce(() => {
  if (window.__lastData && orientationOverride === null) renderPlan(window.__lastData, furnToggle.checked);
}, 150));

// Visible on the upload screen too, before any file is loaded — so it is always
// possible to tell at a glance whether the phone is running the current build
// or a cached older one.
(function showVersion(){
  const el = document.getElementById('verLine');
  if (el) el.textContent = 'verzija ' + APP_VERSION;
})();

function setStatus(msg, cls){ statusEl.textContent = msg; statusEl.className = cls || ''; }

// Files are classified up front so a whole selection (scan + meta together, in
// either order) is applied as one unit. Crucially: loading a NEW scan without
// its own meta.json clears the previous project's meta — otherwise the old
// project's name, address, coordinates and north heading would silently carry
// over into the new report (verified bug: a different room inherited the
// previous scan's address and a bogus north).
async function handleFiles(files){
  if (!files.length) return;
  const items = [];
  for (const f of files) {
    try {
      items.push({ name: f.name, json: JSON.parse(await f.text()) });
    } catch (err) {
      console.error(err);
      setStatus('Greška pri čitanju ' + f.name + ': ' + err.message, 'err');
      return;
    }
  }
  const isMeta = j => j.headingDegrees != null && !j.rooms && !j.walls;
  const metas = items.filter(i => isMeta(i.json));
  const scans = items.filter(i => !isMeta(i.json));
  if (scans.length && !metas.length) window.__meta = null; // new scan, no meta of its own
  for (const m of metas) applyMeta(m.json, scans.length > 0);
  for (const s of scans) applyScan(s.name, s.json);
}

function applyMeta(json, scanFollows){
  window.__meta = json;
  setStatus('meta.json učitan — kompasni smjer poznat (heading ' + json.headingDegrees.toFixed(1) + '°).', 'ok');
  // re-render only when no fresh scan is coming in the same batch — otherwise
  // the old project's data would flash briefly with the new project's meta
  if (!scanFollows && window.__lastData) render(window.__lastData, window.__lastName);
}

function applyScan(name, json){
  // some apps export the CapturedRoom itself, without a "rooms" wrapper
  if (!json.rooms && json.walls) json = { rooms: [json] };
  if (!json.rooms || !json.rooms.length) {
    setStatus('JSON ne sadrži "rooms" ni "walls" polje — ovo ne izgleda kao CapturedRoom export.', 'err');
    return;
  }
  try {
    const data = buildData(json);
    setStatus('Učitano — ' + data.walls.length + ' zidova, ' + data.openings.length + ' otvora, ' + data.furniture.length + ' komada namještaja.' + (window.__meta ? ' Pravi sjever iz meta.json.' : ''), 'ok');
    window.__lastData = data;
    window.__lastName = name;
    orientationOverride = null; // back to auto orientation for a new scan
    render(data, name);
  } catch (err) {
    console.error(err);
    setStatus('Greška pri obradi: ' + err.message, 'err');
  }
}

// current north bearing from loaded meta.json + scan (see geometry.js)
function northBearingDeg(){
  if (!window.__meta) return null;
  const data = window.__lastData;
  return northBearingFrom(window.__meta.headingDegrees, data && data.refRotDeg != null ? data.refRotDeg : 0);
}

/* ---------- Rendering ---------- */

function render(data, filename){
  // Rooms are segmented ONCE here and threaded through every panel. RoomPlan's
  // own grouping is not a room breakdown — a whole scan arrives as a single
  // rooms[0] entry, so its roomCount says "one capture", not "one room". The
  // report is built from the rooms we find, and every panel must agree on the
  // same set of them.
  const seg = segmentRooms(data);
  const zoneCount = seg.zones.length;

  document.getElementById('projTitle').textContent =
    (window.__meta && window.__meta.name) ? window.__meta.name : filename.replace(/\.json$/i, '');
  document.getElementById('projSub').textContent = 'CapturedRoom JSON · ' +
    (zoneCount ? zoneCount + (zoneCount === 1 ? ' prostorija' : ' prostorije') : data.roomCount + ' prostorija') +
    ' · parsirano lokalno · v' + APP_VERSION;
  reportEl.classList.add('show');
  printBtn.style.display = 'inline-block';
  furnPanel.classList.toggle('hidden-panel', !furnToggle.checked);

  const grossWallArea = sum(data.walls, w => w.area);
  const openingArea = sum(data.openings, o => o.area);
  // total net must agree with the walls table: same per-wall parentIdentifier linkage
  const netWallArea = sum(data.walls, w => wallNetArea(data, w));
  const floorArea = sum(data.floors, f => f.area);

  // Per-room figures — the ones that go into a cost estimate. Floor sums to the
  // polygon exactly by construction; walls sum HIGHER than the deduplicated
  // total because a shared wall needs painting on both sides, one item per room.
  const wallMap = wallsByZone(data, seg);
  const ceilMap = ceilingByZone(data, seg);
  const roomFloor = sum(seg.zones, z => z.areaExact);
  const roomCeiling = sum(seg.zones, z => ceilMap.get(z.zoneId).ceilingArea);
  let wallFaces = 0, roomWallNet = 0;
  for (const list of wallMap.values()) { wallFaces += list.length; roomWallNet += sum(list, w => w.netArea); }

  const wallIds = new Set(data.walls.map(w => w.identifier));
  const unlinkedOpenings = data.openings.filter(o => !wallIds.has(o.parentIdentifier));
  const unlinkedArea = sum(unlinkedOpenings, o => o.area);
  document.getElementById('unlinkedNote').innerHTML = unlinkedArea > 0.005
    ? ' <span class="warn">Upozorenje: ' + unlinkedOpenings.length + ' otvora (' + fmt(unlinkedArea) + ' m²) nije povezano ni s jednim zidom pa nisu odbijeni od neto površine.</span>'
    : '';

  const ceilingArea = zoneCount ? roomCeiling : null;
  const podArea = zoneCount ? roomFloor : floorArea;

  const northB = northBearingDeg();
  document.getElementById('metaStrip').innerHTML =
    metaChip('Zidova', data.walls.length + (wallFaces ? ' (' + wallFaces + ' lica)' : '')) +
    metaChip('Otvora', data.openings.length) + metaChip('Namještaja', data.furniture.length) +
    metaChip('Prostorija', zoneCount || data.roomCount) +
    (northB != null ? metaChip('Sjever', 'meta ✓') : '');

  const statsObj = {
    'Površina poda': fmtArea(podArea),
    'Strop (rekonstruirano)': fmtArea(ceilingArea),
    'Zidovi (bruto)': fmtArea(grossWallArea),
    'Zidovi (neto)': fmtArea(netWallArea),
    'Zidovi po sobama': zoneCount ? fmtArea(roomWallNet) : '—',
    'Otvori ukupno': fmtArea(openingArea),
    'Strop − pod': (ceilingArea != null && podArea ? (ceilingArea-podArea >= 0 ? '+' : '') + fmtArea(ceilingArea-podArea) : '—'),
  };
  renderStats(statsObj);
  renderFloorCheck(seg, floorArea);

  renderMetaPanel();
  renderZones(data, seg);
  renderWallsTable(data);
  renderCeilingPanel(data, seg);
  renderOpeningsTable(data);
  renderFurnitureTable(data.furniture);
  renderPlan(data, furnToggle.checked);

  document.getElementById('footnote').textContent =
    'Sve mjere izvučene izravno iz CapturedRoom JSON strukture (dimensions / transform / polygonCorners po elementu). ' +
    'RoomPlan-ova podjela se ne koristi kao struktura izvještaja — cijeli sken dolazi kao jedan rooms[0] zapis, pa njegov roomCount znači "jedno snimanje", ne jedna prostorija. ' +
    'Prostorije se pronalaze segmentacijom tlocrta, i pod, strop i zidovi računaju se po svakoj takvoj prostoriji zasebno. ' +
    'Površine soba normaliziraju se na poligon poda, pa im je zbroj točno jednak ukupnom podu (mreža sama po sebi mjeri nešto manje). ' +
    'Neto površina zidova koristi parentIdentifier za povezivanje otvora s pravim zidom; ukupni "Zidovi (neto)" broje svaki zid jednom, a "Zidovi po sobama" dijeljeni zid s obje strane (broj za premaz). ' +
    'Strop nije izravno skeniran (RoomPlan nema "ceiling" kategoriju) — računa se kao pod te prostorije uvećan za višak koji kosina dodaje iznad svoje tlocrtne projekcije. ' +
    'Ravni dio stropa je time točno poznat, a procjenjuje se samo dužina kosine — i ona se mjeri iz koljenastog zida, prepoznatog po visini koja odgovara koljenu iz presjeka. ' +
    'Pretpostavka je isti poprečni presjek kroz cijelu prostoriju (jednostavan jednostrešni/dvostrešni krov); za krovove koji se mijenjaju u oba smjera metoda nije pouzdana i to se ispisuje uz prostoriju. ' +
    'Orijentacija: pravi sjever = meta.json heading − referenceOriginTransform rotacija + 90° ' +
    '(RoomPlan interno poravnava koordinate sa zidovima, a korekcija od +90° je kalibrirana fizičkom provjerom u prostoriji: ' +
    'app bilježi sirovi CLHeading koji mjeri vrh uređaja, ne smjer kamere). ' +
    'Bez meta.json orijentacija je proizvoljna po sesiji skeniranja — kompas tada prati pretpostavljeni sjever. ' +
    'Tlocrt je poravnat s najdužim zidom (uvijek ravan); sjever pokazuje kompasna ruža u legendi. Kad je sjever poznat, od četiri osne rotacije ' +
    '(sve jednako ravne, isti tlocrt) bira se ona gdje je sjever najbliže gore — time se ujedno određuje Portrait/Landscape, jer rotacija od 90° mijenja i to. ' +
    'Ručnim prekidačem se to nadjačava, ali tada sjever u pravilu ostaje ~90° od gore. ' +
    'Simbol otvaranja vrata (krilo + luk) je konvencija — sken ne bilježi stranu šarki ni smjer otvaranja. ' +
    'Alat ne radi nijedan mrežni poziv: nema CDN-a, fontova, karata, geokodiranja ni analitike. Sve — uključujući koordinate iz meta.json — ostaje na uređaju.';
}

function metaChip(label, value){ return '<div>' + label + '<span>' + value + '</span></div>'; }

/* ---------- Scan metadata panel (meta.json) ---------- */

function renderMetaPanel(){
  const panel = document.getElementById('metaPanel');
  const m = window.__meta;
  if (!m) { panel.style.display = 'none'; return; }
  panel.style.display = '';
  const rows = [];
  if (m.name) rows.push(['Naziv', esc(m.name)]);
  if (m.createdAt != null) {
    rows.push(['Datum', new Date(APPLE_EPOCH_MS + m.createdAt*1000).toLocaleString('hr-HR', { dateStyle: 'medium', timeStyle: 'short' })]);
  }
  // Coordinates are shown as plain, selectable text. No map link and no
  // reverse geocoding: this app makes ZERO network requests by design, so
  // nothing about the scanned property — not even its coordinates — ever
  // leaves the device.
  if (m.latitude != null && m.longitude != null) {
    rows.push(['Koordinate', m.latitude.toFixed(6) + ', ' + m.longitude.toFixed(6)]);
  }
  if (m.headingDegrees != null) rows.push(['Heading', m.headingDegrees.toFixed(1) + '°']);
  // labelled as RoomPlan's own count so it cannot be mistaken for the number of
  // rooms in the report — RoomPlan counts capture sessions, not rooms
  if (m.roomCount != null) rows.push(['Prostorija (RoomPlan)', String(m.roomCount)]);
  document.getElementById('metaContent').innerHTML =
    '<table><tbody>' + rows.map(r => '<tr><th style="width:32%;">' + r[0] + '</th><td>' + r[1] + '</td></tr>').join('') + '</tbody></table>';
}

// One small line, nothing more: the per-room floor areas and their sum, so a
// scan that looks suspicious can be checked by hand against a measurement.
// Deliberately floor-only — RoomPlan reports a shared wall as a single entity,
// so there is no independent figure to check our per-room wall split against.
function renderFloorCheck(seg, floorArea){
  const el = document.getElementById('floorCheck');
  if (!el) return;
  if (!seg || !seg.zones.length) { el.textContent = ''; el.style.display = 'none'; return; }
  const parts = orderedZones(seg).map(z => fmt(z.areaExact));
  const total = sum(seg.zones, z => z.areaExact);
  const metaFloor = window.__meta && window.__meta.floorAreaSquareMetres;
  el.textContent = 'kontrola poda: ' + parts.join(' + ') + ' = ' + fmt(total) + ' m²' +
    (metaFloor != null ? ' · meta ' + metaFloor.toFixed(3) + (Math.abs(total - metaFloor) < 0.01 ? ' ✓' : ' ⚠') : '') +
    (Math.abs(total - floorArea) < 0.01 ? '' : ' · tlocrt ' + fmt(floorArea) + ' ⚠');
  el.style.display = '';
}

function renderStats(obj){
  const grid = document.getElementById('statsGrid');
  grid.innerHTML = Object.entries(obj).map(([label, value]) => {
    const hl = label.includes('Strop') ? ' hl' : '';
    return '<div class="stat' + hl + '"><div class="label">' + label + '</div><div class="value">' + value + '</div></div>';
  }).join('');
}

// Real per-room segmentation (flood-fill grid, geometry.js) replaces the old
// nearest-point heuristic whenever it finds actual rooms. Falls back to the
// coarse RoomPlan `sections` display (no regression) if segmentation finds
// nothing — e.g. a scan with no floor polygon at all.
function renderZones(data, seg){
  const el = document.getElementById('zonesContent');
  if (seg && seg.zones.length) {
    renderZonesSegmented(el, data, seg);
  } else {
    renderZonesFallback(el, data);
  }
}

// stable reading order (top-to-bottom, then left-to-right) so a room keeps its
// number between renders — shared by the zone list and the ceiling panel
function orderedZones(seg){
  return [...seg.zones].sort((a,b) => a.center[1]-b.center[1] || a.center[0]-b.center[0]);
}
function zoneTitles(data, seg){
  const furnByZone = furnitureByZone(data, seg.grid);
  const titles = new Map();
  orderedZones(seg).forEach((z, i) => {
    const cls = classifyZone(z, furnByZone.get(z.zoneId) || []);
    titles.set(z.zoneId, cls === 'Other' ? 'Soba ' + (i+1) : ZONE_LABELS_HR[cls]);
  });
  return titles;
}

function renderZonesSegmented(el, data, seg){
  const furnByZone = furnitureByZone(data, seg.grid);
  const wallMap = wallsByZone(data, seg);
  const ceilMap = ceilingByZone(data, seg);
  const titles = zoneTitles(data, seg);
  const ordered = orderedZones(seg);

  let html = '';
  ordered.forEach((z) => {
    const objs = furnByZone.get(z.zoneId) || [];
    const title = titles.get(z.zoneId);
    const walls = (wallMap.get(z.zoneId) || []).slice().sort((a,b) => b.netArea - a.netArea);
    const wallsTotal = sum(walls, w => w.netArea);
    const ceil = ceilMap.get(z.zoneId);

    html += '<div class="zone-block">';
    html += '<div class="zone-title">' + esc(title) + '</div>';
    html += '<div class="zone-sub">' + fmtArea(z.area) + ' pod · ' +
      (ceil ? fmtArea(ceil.ceilingArea) + ' strop' + (ceil.flat ? ' (ravan)' : '') + ' · ' : '') +
      fmtArea(wallsTotal) + ' zidovi (za premaz)' +
      (objs.length ? ' · ' + objs.map(o=>esc(catLabel(o))).join(' · ') : ' · nema namještaja') + '</div>';
    if (walls.length) {
      html += '<table style="margin-top:6px;"><thead><tr><th>Zid</th><th>Dim (m)</th><th>Površina</th></tr></thead><tbody>';
      html += walls.map(w => {
        const wg = w.wall;
        const badge = w.sharedWith.length ? ' <span class="badge b-shared">dijeljen</span>' : '';
        // a wall the room only partly borders (it continues into another room),
        // or one whose both faces are inside this room, is worth showing
        const partial = Math.abs(w.share - 1) > 0.02
          ? ' <span class="badge b-part">' + Math.round(w.share*100) + '%</span>' : '';
        return '<tr><td>' + esc(String(wg.identifier).slice(0,8)) + badge + partial + '</td><td>' + wg.dimensions[0].toFixed(2) + ' × ' + wg.dimensions[1].toFixed(2) + '</td><td>' + fmt(w.netArea) + '</td></tr>';
      }).join('');
      html += '</tbody></table>';
    }
    html += '</div>';
  });
  el.innerHTML = html;
  const note = document.getElementById('zonesNote');
  if (note) {
    note.textContent = 'Automatska segmentacija (mreža ' + (CELL_M*100).toFixed(0) + ' cm) — granice i klasifikacija su procjena. ' +
      'Svaka soba dobiva onaj dio zida koji stvarno graniči s njom: "dijeljen" zid ulazi punom površinom u obje sobe (svaka strana svoj premaz), ' +
      'a zid koji se proteže kroz više soba dijeli se po stvarnoj dužini (postotak uz zid). Pregradni zid s oba lica u istoj sobi broji se dvaput. ' +
      'Ukupni zbroj zidova u Pregledu i dalje broji svaki zid jednom.';
    note.style.display = '';
  }
}

function renderZonesFallback(el, data){
  const note = document.getElementById('zonesNote');
  if (note) note.style.display = 'none';
  if (!data.sections.length) {
    el.innerHTML = '<div style="font-family:ui-monospace,monospace; font-size:11.5px; color:var(--ink-dim);">Nema imenovanih zona u ovoj datoteci.</div>';
    return;
  }
  let html = '';
  for (const s of data.sections) {
    const assigned = assignByNearest(data.furniture.filter(f => f.roomIdx===s.roomIdx), data.sections.filter(z=>z.roomIdx===s.roomIdx)).filter(x => x.zone === s.label).map(x => x.item);
    const label = String(s.label).replace(/([a-z])([A-Z0-9])/g, '$1 $2').replace(/^./, c => c.toUpperCase());
    html += '<div class="zone-block"><div class="zone-title">' + esc(label) + '</div>';
    html += '<div class="zone-sub">' + (assigned.length ? assigned.length + ' komada namještaja u blizini: ' + assigned.map(a=>esc(catLabel(a))).join(' · ') : 'nema namještaja u blizini') + '</div></div>';
  }
  el.innerHTML = html;
}

function assignByNearest(items, zones){
  return items.map(item => {
    const [ix,,iz] = [item.transform[12], item.transform[13], item.transform[14]];
    let best = null, bestD = Infinity;
    for (const z of zones) {
      const d = Math.hypot(ix-z.center[0], iz-z.center[2]);
      if (d < bestD) { bestD = d; best = z.label; }
    }
    return { item, zone: best };
  });
}

function confBadge(level){
  return '<span class="badge b-conf-' + level + '">' + level + '</span>';
}

function renderWallsTable(data){
  const tbody = document.querySelector('#wallsTable tbody');
  if (!data.walls.length) { tbody.innerHTML = '<tr><td colspan="5" style="color:var(--ink-faint);">Nema podataka</td></tr>'; return; }
  tbody.innerHTML = data.walls.map(w => {
    const net = wallNetArea(data, w);
    const slopeBadge = w.hasSlope ? ' <span class="badge b-slope">kosina</span>' : '';
    return '<tr><td>' + esc(String(w.identifier).slice(0,8)) + slopeBadge + '</td><td>' + w.dimensions[0].toFixed(2) + ' × ' + w.dimensions[1].toFixed(2) + '</td><td>' + fmt(w.area) + '</td><td>' + fmt(net) + '</td><td>' + confBadge(w.confLevel) + '</td></tr>';
  }).join('');
}

// One block per SEGMENTED room. Each room's ceiling is built only from its own
// sloped walls, so a flat hallway is never dragged up to the living room's pitch.
function renderCeilingPanel(data, seg){
  const el = document.getElementById('ceilingContent');
  if (!data.walls.length) { el.innerHTML = '<div style="color:var(--ink-faint); font-family:ui-monospace,monospace; font-size:11.5px;">Nema zidova za rekonstrukciju.</div>'; return; }
  if (!seg || !seg.zones.length) {
    el.innerHTML = '<div style="font-family:ui-monospace,monospace; font-size:11.5px; color:var(--ink-dim);">Segmentacija nije pronašla prostorije — strop nije rekonstruiran po sobama.</div>';
    return;
  }
  const ceilMap = ceilingByZone(data, seg);
  const titles = zoneTitles(data, seg);
  let html = '';

  for (const z of orderedZones(seg)) {
    const c = ceilMap.get(z.zoneId);
    if (!c) continue;
    html += '<div class="zone-block"><div class="zone-title">' + esc(titles.get(z.zoneId)) + '</div>';

    if (c.flat) {
      html += '<div class="assumption">Nijedan zid ove prostorije nema kosi gornji rub — strop je ravan i jednak podu: <strong style="color:var(--line-bright);">' + fmt(c.ceilingArea) + ' m²</strong>.</div></div>';
      continue;
    }

    html += '<table style="margin-top:6px;"><thead><tr><th>Zid</th><th>Greben (puna V)</th><th>Koljenasti zid</th><th>Segmenti</th></tr></thead><tbody>';
    for (const p of c.profiles) {
      const segStr = p.segments.map(s => s.isSlope ? (s.angleDeg.toFixed(1) + '° (' + s.run.toFixed(2) + '×' + s.rise.toFixed(2) + 'm)') : ('ravno ' + s.run.toFixed(2) + 'm')).join(', ');
      html += '<tr><td>' + esc(String(p.wallId).slice(0,8)) + (p === c.section ? ' <span class="badge b-shared">presjek</span>' : '') + '</td><td>' + fmt(p.ridgeHeight) + ' m</td><td>' + fmt(p.kneeWallHeight) + ' m</td><td style="font-size:10.5px;">' + esc(segStr) + '</td></tr>';
    }
    html += '</tbody></table>';

    if (c.ceilingArea == null) {
      html += '<div class="assumption"><span class="warn">nedovoljno podataka — površina stropa nije izračunata.</span></div></div>';
      continue;
    }

    let formula;
    if (c.method === 'knee') {
      formula = 'pod ' + fmt(c.floorArea) + ' m² + kosina ' + c.slopeSurplus.toFixed(4) + ' m po metru širine × ' + fmt(c.slopeExtent) + ' m dužine = <strong style="color:var(--line-bright);">' + fmt(c.ceilingArea) + ' m²</strong>. ' +
        'Ravni dio stropa je već točno poznat iz tlocrta poda, pa se procjenjuje samo koliko površine kosina dodaje iznad svoje tlocrtne projekcije. ' +
        'Dužina kosine nije pretpostavljena nego izmjerena — to je dužina koljenastog zida (' + c.kneeWallIds.map(x => esc(String(x).slice(0,8))).join(', ') + '), prepoznatog po tome što mu visina odgovara koljenu iz presjeka.';
    } else if (c.method === 'section') {
      formula = 'pod ' + fmt(c.floorArea) + ' m² × ' + c.sectionRatio.toFixed(4) + ' = <strong style="color:var(--line-bright);">' + fmt(c.ceilingArea) + ' m²</strong>. ' +
        'Faktor je dužina presjeka podijeljena s njegovim horizontalnim rasponom — koliko je kosi strop duži od svoje tlocrtne projekcije. ' +
        'U ovoj prostoriji nije pronađen koljenasti zid, pa se pretpostavlja da kosina ide cijelim tlocrtom (gornja granica).';
    } else {
      formula = 'presjek ' + fmt(c.section.profileLength) + ' m × ' + fmt(c.roomLength) + ' m = <strong style="color:var(--line-bright);">' + fmt(c.ceilingArea) + ' m²</strong>. ' +
        'Prostorija nema vlastiti poligon poda, pa se presjek proteže po procijenjenoj dužini — najmanje pouzdan od tri načina.';
    }
    html += '<div class="assumption">' + formula +
      ' Pretpostavka: isti poprečni presjek kroz cijelu prostoriju (jednostavan krov).' +
      (c.notParallel ? ' <span class="warn">Kosi zidovi ove prostorije nisu međusobno paralelni — krov se mijenja u oba smjera i ova procjena nije pouzdana.</span>' : '') +
      '</div></div>';
  }
  el.innerHTML = html;
}

function renderOpeningsTable(data){
  const tbody = document.querySelector('#openingsTable tbody');
  if (!data.openings.length) { tbody.innerHTML = '<tr><td colspan="5" style="color:var(--ink-faint);">Nema podataka</td></tr>'; return; }
  tbody.innerHTML = data.openings.map(o => {
    const parentShort = o.parentIdentifier ? esc(String(o.parentIdentifier).slice(0,8)) : '—';
    return '<tr><td>' + esc(catLabel(o)) + '</td><td>' + parentShort + '</td><td>' + o.dimensions[0].toFixed(2) + ' × ' + o.dimensions[1].toFixed(2) + '</td><td>' + fmt(o.area) + '</td><td>' + confBadge(o.confLevel) + '</td></tr>';
  }).join('');
}

function renderFurnitureTable(furniture){
  const tbody = document.querySelector('#furnitureTable tbody');
  if (!furniture.length) { tbody.innerHTML = '<tr><td colspan="3" style="color:var(--ink-faint);">Nema podataka</td></tr>'; return; }
  tbody.innerHTML = furniture.map(f => {
    return '<tr><td><span class="badge b-furn">' + esc(f.catName||'—') + '</span></td><td>' + f.dimensions.map(n=>n.toFixed(2)).join(' × ') + '</td><td>' + confBadge(f.confLevel) + '</td></tr>';
  }).join('');
}

/* ---------- Blueprint SVG floor plan ---------- */

function renderPlan(data, showFurniture){
  const svg = document.getElementById('plan-svg');
  const legend = document.getElementById('legend');

  const segs = data.walls.map(w => wallSegment(w));
  if (!segs.length) {
    svg.innerHTML = '<text x="50" y="50" class="sv-muted" font-size="4">Nema zidova za crtanje</text>';
    document.getElementById('compassSvg').innerHTML = '';
    return;
  }

  // Base top-down mapping (viewed from above): screen_x = world_x, screen_y = world_z.
  // The drawing is always straight, aligned to the longest wall. All orientation
  // decisions (which of the four axis-aligned rotations, Portrait vs Landscape,
  // manual override) live in planOrientation() in geometry.js — pure and unit
  // tested, because that's where every orientation bug so far has lived. The
  // compass rose in the legend shows where true north ends up; when meta.json
  // is absent north is unknown and the rose tracks the assumed north instead.
  const northB = northBearingDeg(); // bearing of world -Z, or null without meta.json
  const longest = data.walls.reduce((a,b) => (b.dimensions[0] > a.dimensions[0] ? b : a));
  const lseg = wallSegment(longest);
  const wallAngle = Math.atan2(lseg.p2[1]-lseg.p1[1], lseg.p2[0]-lseg.p1[0]) * 180/Math.PI;
  const panelW = svg.parentElement ? svg.parentElement.clientWidth : 800;
  const orient = planOrientation({
    wallAngle,
    northB,
    override: orientationOverride,
    panelLandscape: panelW >= window.innerHeight * 0.7
  });
  const rotDeg = orient.rotDeg, wantLandscape = orient.landscape;
  if (orient.auto) landToggle.checked = wantLandscape;
  const th = rotDeg * Math.PI/180, cosT = Math.cos(th), sinT = Math.sin(th);
  const projX = (x, z) => x*cosT - z*sinT;
  const projY = (x, z) => x*sinT + z*cosT;

  const projected = segs.map(s => ({
    p1: [projX(...s.p1), projY(...s.p1)],
    p2: [projX(...s.p2), projY(...s.p2)]
  }));
  const allX = projected.flatMap(s => [s.p1[0], s.p2[0]]);
  const allY = projected.flatMap(s => [s.p1[1], s.p2[1]]);
  const pad = 1.6;
  const minX = Math.min(...allX) - pad, maxX = Math.max(...allX) + pad;
  const minY = Math.min(...allY) - pad, maxY = Math.max(...allY) + pad;
  const w = maxX - minX, h = maxY - minY;

  svg.setAttribute('viewBox', '0 0 ' + w.toFixed(2) + ' ' + h.toFixed(2));
  const toSvg = (x, z) => [ projX(x, z) - minX, projY(x, z) - minY ];

  let parts = [];
  const gridId = 'grid' + Math.random().toString(36).slice(2,8);
  parts.push('<defs><pattern id="' + gridId + '" width="0.5" height="0.5" patternUnits="userSpaceOnUse"><path d="M 0.5 0 L 0 0 0 0.5" fill="none" class="sv-grid" stroke-width="0.012"/></pattern></defs>');
  parts.push('<rect x="0" y="0" width="' + w + '" height="' + h + '" fill="url(#' + gridId + ')"/>');

  const wallStroke = Math.max(w, h) * 0.012;

  // floor outline (subtle fill)
  for (const f of data.floors) {
    const poly = floorPolygon(f).map(p => toSvg(...p));
    parts.push('<polygon points="' + poly.map(p=>p.join(',')).join(' ') + '" class="sv-floor" stroke="none"/>');
  }

  // room bbox center (used for door swing direction and dimension-line offsets)
  const wallXs = data.walls.flatMap(wg => { const s = wallSegment(wg); return [s.p1[0], s.p2[0]]; });
  const wallYs = data.walls.flatMap(wg => { const s = wallSegment(wg); return [s.p1[1], s.p2[1]]; });
  const centroidWorld = [ (Math.min(...wallXs)+Math.max(...wallXs))/2, (Math.min(...wallYs)+Math.max(...wallYs))/2 ];
  const [ccx, ccy] = toSvg(...centroidWorld);

  // walls: base color full length; grey overlay only where the top edge slopes
  for (const wg of data.walls) {
    const s = wallSegment(wg);
    const [x1, y1] = toSvg(...s.p1);
    const [x2, y2] = toSvg(...s.p2);
    const dash = wg.confLevel === 'low' ? (wallStroke*1.2) + ',' + (wallStroke*0.8) : 'none';
    parts.push('<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" class="sv-wall" stroke-width="' + wallStroke + '" stroke-linecap="square" ' + (dash!=='none' ? 'stroke-dasharray="'+dash+'"' : '') + '/>');
    if (wg.hasSlope) {
      const L = wg.dimensions[0];
      const { pts } = topProfile(wg);
      for (let i=0;i<pts.length-1;i++){
        if (Math.abs(pts[i+1][1] - pts[i][1]) <= 0.02) continue; // flat part, no marker
        const ta = Math.min(1, Math.max(0, (pts[i][0] + L/2) / L));
        const tb = Math.min(1, Math.max(0, (pts[i+1][0] + L/2) / L));
        const [ax, ay] = toSvg(s.p1[0] + (s.p2[0]-s.p1[0])*ta, s.p1[1] + (s.p2[1]-s.p1[1])*ta);
        const [bx, by] = toSvg(s.p1[0] + (s.p2[0]-s.p1[0])*tb, s.p1[1] + (s.p2[1]-s.p1[1])*tb);
        parts.push('<line x1="' + ax + '" y1="' + ay + '" x2="' + bx + '" y2="' + by + '" class="sv-wall-slope" stroke-width="' + wallStroke + '" stroke-linecap="butt"/>');
      }
    }
  }

  // openings; doors additionally get the standard swing symbol (leaf + arc).
  // Hinge side is a drawing convention — the scan records only isOpen.
  for (const o of data.openings) {
    const s = wallSegment(o);
    const [x1, y1] = toSvg(...s.p1);
    const [x2, y2] = toSvg(...s.p2);
    parts.push('<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" class="sv-open-cut" stroke-width="' + (wallStroke*1.6) + '" stroke-linecap="butt"/>');
    parts.push('<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" class="sv-open" stroke-width="' + (wallStroke*0.9) + '" stroke-linecap="butt"/>');
    if (o.kind === 'door') {
      const dxo = x2 - x1, dyo = y2 - y1;
      const wpx = Math.hypot(dxo, dyo) || 1;
      const dux = dxo/wpx, duy = dyo/wpx;
      let nx = -duy, ny = dux;
      const midx = (x1+x2)/2, midy = (y1+y2)/2;
      if ((ccx-midx)*nx + (ccy-midy)*ny < 0) { nx = -nx; ny = -ny; } // swing into the room
      const lx = x1 + nx*wpx, ly = y1 + ny*wpx; // open leaf end (hinge at p1)
      const sweep = (dux*ny - duy*nx) > 0 ? 1 : 0;
      parts.push('<line x1="' + x1 + '" y1="' + y1 + '" x2="' + lx + '" y2="' + ly + '" class="sv-open" stroke-width="' + (wallStroke*0.45) + '"/>');
      parts.push('<path d="M ' + x2 + ' ' + y2 + ' A ' + wpx + ' ' + wpx + ' 0 0 ' + sweep + ' ' + lx + ' ' + ly + '" fill="none" class="sv-open" stroke-width="' + (wallStroke*0.3) + '" stroke-dasharray="' + (wallStroke*0.8) + ',' + (wallStroke*0.8) + '" opacity="0.8"/>');
    }
  }

  // furniture
  if (showFurniture) {
    for (const f of data.furniture) {
      const corners = furnitureRect(f).map(p => toSvg(...p));
      parts.push('<polygon points="' + corners.map(p=>p.join(',')).join(' ') + '" class="sv-furn" stroke-width="' + (wallStroke*0.5) + '" stroke-dasharray="' + (wallStroke*0.9) + ',' + (wallStroke*0.9) + '"/>');
    }
  }

  // dimension lines — always offset outward, away from the room centroid
  const fontSize = Math.max(w,h) * 0.022;
  for (const wg of data.walls) {
    const s = wallSegment(wg);
    const [x1, y1] = toSvg(...s.p1);
    const [x2, y2] = toSvg(...s.p2);
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    let nx = -dy/len, ny = dx/len;
    // flip normal if it points toward the room centroid instead of away from it
    const mx0 = (x1+x2)/2, my0 = (y1+y2)/2;
    const towardCentroid = (ccx-mx0)*nx + (ccy-my0)*ny;
    if (towardCentroid > 0) { nx = -nx; ny = -ny; }
    const off = Math.max(w,h) * 0.045;
    const ox1 = x1 + nx*off, oy1 = y1 + ny*off, ox2 = x2 + nx*off, oy2 = y2 + ny*off;
    const tick = Math.max(w,h) * 0.012;
    parts.push('<g class="sv-dim" stroke-width="' + (wallStroke*0.35) + '" opacity="0.85">');
    parts.push('<line x1="' + ox1 + '" y1="' + oy1 + '" x2="' + ox2 + '" y2="' + oy2 + '"/>');
    parts.push('<line x1="' + x1 + '" y1="' + y1 + '" x2="' + ox1 + '" y2="' + oy1 + '" stroke-dasharray="' + tick + ',' + tick + '"/>');
    parts.push('<line x1="' + x2 + '" y1="' + y2 + '" x2="' + ox2 + '" y2="' + oy2 + '" stroke-dasharray="' + tick + ',' + tick + '"/>');
    parts.push('</g>');
    const mxl = (ox1+ox2)/2, myl = (oy1+oy2)/2;
    parts.push('<text x="' + mxl + '" y="' + myl + '" class="sv-dimtxt" font-size="' + fontSize + '" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" text-anchor="middle" dy="' + (-fontSize*0.35) + '">' + s.len.toFixed(2) + ' m</text>');
  }

  // zone labels
  for (const s of data.sections) {
    const [x, y] = toSvg(s.center[0], s.center[2]);
    const label = String(s.label).replace(/([a-z])([A-Z0-9])/g, '$1 $2').replace(/^./, c => c.toUpperCase());
    parts.push('<text x="' + x + '" y="' + y + '" class="sv-muted" font-size="' + (fontSize*1.2) + '" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif" text-anchor="middle" opacity="0.8">' + esc(label) + '</text>');
  }

  svg.innerHTML = parts.join('');

  // compass rose lives in the legend row (never touches the drawing); its N mark
  // points at true north when meta.json heading is known, otherwise at the
  // assumed north (world -Z) — rotating together with the plan in both cases
  const roseDeg = (((rotDeg - (northB != null ? northB : 0)) % 360) + 360) % 360;
  renderCompass(roseDeg, northB != null ? 'meta.json' : 'procjena');

  legend.innerHTML =
    '<span><span class="sw lg-wall"></span>Ravan zid</span>' +
    '<span><span class="sw lg-slope"></span>Zid s kosinom</span>' +
    '<span><span class="sw lg-open"></span>Otvor</span>' +
    (showFurniture ? '<span><span class="sw lg-furn"></span>Namještaj</span>' : '');
}

// draws the compass rose into the fixed-size #compassSvg in the legend row
function renderCompass(roseDeg, label){
  const c = document.getElementById('compassSvg');
  const cx = 44, cy = 44, r = 40, stroke = 1.1, fontSize = 14;
  const parts = [];
  compassRose(parts, cx, cy, r, roseDeg, stroke, fontSize, label);
  c.innerHTML = parts.join('');
}

// a proper compass rose: rings, degree ticks, cardinal letters and a needle;
// rotated as a whole by roseDeg (letters counter-rotated to stay upright)
function compassRose(parts, cx, cy, r, roseDeg, stroke, fontSize, label){
  parts.push('<g class="sv-muted-stroke" fill="none" stroke-width="' + stroke + '">' +
    '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '"/>' +
    '<circle cx="' + cx + '" cy="' + cy + '" r="' + (r*0.7) + '" opacity="0.45"/>' +
    '</g>');
  let g = '<g transform="rotate(' + roseDeg.toFixed(2) + ' ' + cx + ' ' + cy + ')">';
  for (let a = 0; a < 360; a += 30) {
    const major = a % 90 === 0;
    const rad = a * Math.PI/180, sx = Math.sin(rad), sy = -Math.cos(rad);
    const r1 = r * (major ? 0.80 : 0.88), r2 = r * 0.97;
    g += '<line class="sv-muted-stroke" stroke-width="' + (stroke * (major ? 1.3 : 0.7)) + '" x1="' + (cx + sx*r1) + '" y1="' + (cy + sy*r1) + '" x2="' + (cx + sx*r2) + '" y2="' + (cy + sy*r2) + '"/>';
  }
  for (const [t, a] of [['N',0],['E',90],['S',180],['W',270]]) {
    const rad = a * Math.PI/180;
    const x = cx + Math.sin(rad) * r * 0.55, y = cy - Math.cos(rad) * r * 0.55;
    const cls = t === 'N' ? 'sv-dimtxt' : 'sv-muted';
    g += '<text x="' + x + '" y="' + y + '" class="' + cls + '" font-size="' + (fontSize * (t === 'N' ? 0.85 : 0.62)) + '" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" text-anchor="middle" dominant-baseline="central" transform="rotate(' + (-roseDeg).toFixed(2) + ' ' + x + ' ' + y + ')">' + t + '</text>';
  }
  // needle: north half highlighted, south half muted
  g += '<polygon class="sv-dimtxt" points="' + cx + ',' + (cy - r*0.42) + ' ' + (cx - r*0.09) + ',' + cy + ' ' + (cx + r*0.09) + ',' + cy + '"/>';
  g += '<polygon class="sv-muted" opacity="0.55" points="' + cx + ',' + (cy + r*0.42) + ' ' + (cx - r*0.09) + ',' + cy + ' ' + (cx + r*0.09) + ',' + cy + '"/>';
  g += '</g>';
  parts.push(g);
  parts.push('<text x="' + cx + '" y="' + (cy + r + fontSize*0.8) + '" class="sv-muted" font-size="' + (fontSize*0.55) + '" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" text-anchor="middle" opacity="0.65">' + label + '</text>');
}
