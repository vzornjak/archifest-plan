/* ARCHIFEST Plan — app.js
 * DOM wiring and rendering: file loading, report panels, SVG floor plan,
 * compass rose and live device compass. Pure math lives in geometry.js.
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

/* ---------- Live device compass ---------- */

const devBtn = document.getElementById('devCompassBtn');
const devCompass = { on: false, heading: null };
if (!('DeviceOrientationEvent' in window)) devBtn.style.display = 'none';
devBtn.addEventListener('click', async () => {
  if (devCompass.on) { stopDevCompass(); return; }
  try {
    // iOS requires an explicit permission request from a user gesture
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      const p = await DeviceOrientationEvent.requestPermission();
      if (p !== 'granted') { setStatus('Pristup kompasu uređaja odbijen.', 'err'); return; }
    }
    window.addEventListener('deviceorientationabsolute', onDevOrientation);
    window.addEventListener('deviceorientation', onDevOrientation);
    window.addEventListener('orientationchange', onScreenRotate);
    devCompass.on = true;
    devBtn.classList.add('active');
  } catch (e) {
    setStatus('Kompas uređaja nije dostupan: ' + e.message, 'err');
  }
});
function stopDevCompass(){
  window.removeEventListener('deviceorientationabsolute', onDevOrientation);
  window.removeEventListener('deviceorientation', onDevOrientation);
  window.removeEventListener('orientationchange', onScreenRotate);
  devCompass.on = false;
  devCompass.heading = null;
  devBtn.classList.remove('active');
  const n = document.getElementById('devNeedle');
  if (n) n.style.display = 'none';
  const dbg = document.getElementById('devDebug');
  if (dbg) { dbg.textContent = ''; dbg.style.display = 'none'; }
}
function onScreenRotate(){ requestAnimationFrame(updateDevNeedle); }

// DIO A: raw sensor heading is relative to the device's PHYSICAL top edge and
// does not account for how the browser's viewport is currently rotated
// (portrait / landscape-primary / landscape-secondary) — a known gap in both
// webkitCompassHeading and generic deviceorientationabsolute alpha. Correct it
// with the live screen rotation angle. SCREEN_ANGLE_SIGN mirrors the earlier
// HEADING_OFFSET_DEG pattern: flip to -1 in one line if a physical test shows
// the sign is backwards.
const SCREEN_ANGLE_SIGN = 1;
function currentScreenAngle(){
  if (screen.orientation && typeof screen.orientation.angle === 'number') return screen.orientation.angle;
  if (typeof window.orientation === 'number') return window.orientation; // legacy iOS fallback
  return 0;
}
let devRaf = false;
function onDevOrientation(e){
  let raw = null;
  // iOS: physically verified (two readings, one after a real 90deg clockwise
  // turn) that webkitCompassHeading on this device increases COUNTER-
  // clockwise — opposite of the documented CLHeading convention — so it's
  // inverted here. Facing true north read 359deg (should be ~0); after
  // turning 90deg clockwise it read 270deg (should be ~90, not decrease).
  // 360-x flips it back to the standard clockwise-increasing convention
  // the rest of this file assumes. Android's alpha path already applies
  // its own 360-x conversion for unrelated reasons and is left as-is
  // (untested here) — do not double-flip it if this ever needs revisiting.
  if (e.webkitCompassHeading != null) raw = (360 - e.webkitCompassHeading) % 360;
  else if (e.absolute && e.alpha != null) raw = 360 - e.alpha;          // Android absolute orientation
  if (raw == null) return;
  const screenAngle = currentScreenAngle();
  devCompass.rawHeading = raw;
  devCompass.screenAngle = screenAngle;
  devCompass.heading = ((raw + SCREEN_ANGLE_SIGN * screenAngle) % 360 + 360) % 360;
  if (!devRaf) { devRaf = true; requestAnimationFrame(updateDevNeedle); }
}
function updateDevNeedle(){
  devRaf = false;
  const n = document.getElementById('devNeedle');
  const dbg = document.getElementById('devDebug');
  const st = window.__compassState;
  if (!n || !devCompass.on || devCompass.heading == null) return;
  if (!st || st.northB == null) { n.style.display = 'none'; if (dbg) dbg.style.display = 'none'; return; }  // plan north unknown
  const ang = ((st.roseDeg + devCompass.heading) % 360 + 360) % 360;
  n.style.display = '';
  n.setAttribute('transform', 'rotate(' + ang + ' ' + st.cx + ' ' + st.cy + ')');
  if (dbg) {
    dbg.style.display = '';
    dbg.textContent = 's' + devCompass.rawHeading.toFixed(0) + '° e' + devCompass.screenAngle.toFixed(0) + '° r' + ang.toFixed(0) + '°';
  }
}

function setStatus(msg, cls){ statusEl.textContent = msg; statusEl.className = cls || ''; }

async function handleFiles(files){
  for (const f of files) await handleFile(f);
}

async function handleFile(file){
  setStatus('Čitam ' + file.name + ' …');
  try {
    const text = await file.text();
    let json = JSON.parse(text);
    // meta.json (app metadata with compass heading), not a scan
    if (json.headingDegrees != null && !json.rooms && !json.walls) {
      window.__meta = json;
      setStatus('meta.json učitan — kompasni smjer poznat (heading ' + json.headingDegrees.toFixed(1) + '°).', 'ok');
      if (window.__lastData) render(window.__lastData, window.__lastName);
      return;
    }
    // some apps export the CapturedRoom itself, without a "rooms" wrapper
    if (!json.rooms && json.walls) json = { rooms: [json] };
    if (!json.rooms || !json.rooms.length) {
      setStatus('JSON ne sadrži "rooms" ni "walls" polje — ovo ne izgleda kao CapturedRoom export.', 'err');
      return;
    }
    const data = buildData(json);
    setStatus('Učitano — ' + data.walls.length + ' zidova, ' + data.openings.length + ' otvora, ' + data.furniture.length + ' komada namještaja.' + (window.__meta ? ' Pravi sjever iz meta.json.' : ''), 'ok');
    window.__lastData = data;
    window.__lastName = file.name;
    orientationOverride = null; // back to auto orientation for a new scan
    render(data, file.name);
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
  document.getElementById('projTitle').textContent =
    (window.__meta && window.__meta.name) ? window.__meta.name : filename.replace(/\.json$/i, '');
  document.getElementById('projSub').textContent = 'CapturedRoom JSON · ' + data.roomCount + ' prostorija · parsirano lokalno';
  reportEl.classList.add('show');
  printBtn.style.display = 'inline-block';
  furnPanel.classList.toggle('hidden-panel', !furnToggle.checked);

  const grossWallArea = sum(data.walls, w => w.area);
  const openingArea = sum(data.openings, o => o.area);
  // total net must agree with the walls table: same per-wall parentIdentifier linkage
  const netWallArea = sum(data.walls, w => wallNetArea(data, w));
  const floorArea = sum(data.floors, f => f.area);

  const wallIds = new Set(data.walls.map(w => w.identifier));
  const unlinkedOpenings = data.openings.filter(o => !wallIds.has(o.parentIdentifier));
  const unlinkedArea = sum(unlinkedOpenings, o => o.area);
  document.getElementById('unlinkedNote').innerHTML = unlinkedArea > 0.005
    ? ' <span class="warn">Upozorenje: ' + unlinkedOpenings.length + ' otvora (' + fmt(unlinkedArea) + ' m²) nije povezano ni s jednim zidom pa nisu odbijeni od neto površine.</span>'
    : '';

  const ceiling = reconstructCeiling(data);
  const ceilingArea = ceiling ? ceiling.ceilingArea : null;

  const northB = northBearingDeg();
  document.getElementById('metaStrip').innerHTML =
    metaChip('Zidova', data.walls.length) + metaChip('Otvora', data.openings.length) + metaChip('Namještaja', data.furniture.length) + metaChip('Prostorija', data.roomCount) +
    (northB != null ? metaChip('Sjever', 'meta ✓') : '');

  const statsObj = {
    'Površina poda': fmtArea(floorArea),
    'Strop (rekonstruirano)': fmtArea(ceilingArea),
    'Zidovi (bruto)': fmtArea(grossWallArea),
    'Zidovi (neto)': fmtArea(netWallArea),
    'Otvori ukupno': fmtArea(openingArea),
    'Strop − pod': (ceilingArea != null && floorArea ? (ceilingArea-floorArea >= 0 ? '+' : '') + fmtArea(ceilingArea-floorArea) : '—'),
  };
  // app's own numbers from meta.json as a cross-check (its wallArea is net: gross minus all openings)
  if (window.__meta) {
    if (window.__meta.floorAreaSquareMetres != null) statsObj['Pod (app meta)'] = fmtArea(window.__meta.floorAreaSquareMetres);
    if (window.__meta.wallAreaSquareMetres != null) statsObj['Zidovi neto (app meta)'] = fmtArea(window.__meta.wallAreaSquareMetres);
  }
  renderStats(statsObj);

  renderMetaPanel();
  renderZones(data);
  renderWallsTable(data);
  renderCeilingPanel(ceiling);
  renderOpeningsTable(data);
  renderFurnitureTable(data.furniture);
  renderPlan(data, furnToggle.checked);

  document.getElementById('footnote').textContent =
    'Sve mjere izvučene izravno iz CapturedRoom JSON strukture (dimensions / transform / polygonCorners po elementu). ' +
    'Elementi koji se ponavljaju u više prostorija broje se jednom (deduplikacija po identifieru). ' +
    'Neto površina zidova koristi parentIdentifier za povezivanje otvora s pravim zidom. ' +
    'Strop nije izravno skeniran (RoomPlan nema "ceiling" kategoriju) — rekonstruiran je po prostoriji iz profila zidova s kosim gornjim rubom, ' +
    'uz pretpostavku da se poprečni presjek proteže cijelom dužinom prostorije (jednostavan jednostrešni/dvostrešni krov). ' +
    'Za složenije oblike krova (koji se mijenjaju u oba smjera) ova metoda nije pouzdana. ' +
    'Orijentacija: pravi sjever = meta.json heading − referenceOriginTransform rotacija + 90° ' +
    '(RoomPlan interno poravnava koordinate sa zidovima, a korekcija od +90° je kalibrirana fizičkom provjerom kompasom: ' +
    'app bilježi sirovi CLHeading koji mjeri vrh uređaja, ne smjer kamere). ' +
    'Bez meta.json orijentacija je proizvoljna po sesiji skeniranja — kompas tada prati pretpostavljeni sjever. ' +
    'Tlocrt je poravnat s najdužim zidom (uvijek ravan); sjever pokazuje kompasna ruža u legendi. Kad je sjever poznat, od četiri osne rotacije ' +
    '(sve jednako ravne, isti tlocrt) bira se ona gdje je sjever najbliže gore — time se ujedno određuje Portrait/Landscape, jer rotacija od 90° mijenja i to. ' +
    'Ručnim prekidačem se to nadjačava, ali tada sjever u pravilu ostaje ~90° od gore. Živa strelica (🧭) dodatno kompenzira trenutni kut rotacije ekrana (screen.orientation) — sirovi kompasni signal mjeri ' +
    'fizički vrh uređaja, ne trenutnu orijentaciju sadržaja na ekranu. Smjer rasta signala je fizički provjeren i invertiran gdje je bilo potrebno — ' +
    'obrnut od dokumentirane konvencije na testiranom uređaju. ' +
    'Simbol otvaranja vrata (krilo + luk) je konvencija — sken ne bilježi stranu šarki ni smjer otvaranja. ' +
    'Adresa se dohvaća reverse geocodingom (OpenStreetMap Nominatim) — jedino se koordinate iz meta.json šalju tom servisu; sken ostaje lokalno.';
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
  if (m.latitude != null && m.longitude != null) {
    rows.push(['Koordinate', m.latitude.toFixed(6) + ', ' + m.longitude.toFixed(6) +
      ' · <a href="https://maps.apple.com/?q=' + m.latitude + ',' + m.longitude + '" target="_blank" rel="noopener" style="color:var(--amber);">Apple Maps</a>']);
    rows.push(['Adresa', '<span id="metaAddr">učitavam…</span>']);
  }
  if (m.headingDegrees != null) rows.push(['Heading', m.headingDegrees.toFixed(1) + '°']);
  if (m.roomCount != null) rows.push(['Prostorija', String(m.roomCount)]);
  document.getElementById('metaContent').innerHTML =
    '<table><tbody>' + rows.map(r => '<tr><th style="width:32%;">' + r[0] + '</th><td>' + r[1] + '</td></tr>').join('') + '</tbody></table>';
  if (m.latitude != null && m.longitude != null) fetchAddress(m.latitude, m.longitude);
}

// reverse geocoding via OpenStreetMap Nominatim (free, no key); only the
// coordinates leave the browser — the scan itself stays local
let addrCache = { key: null, text: null };
async function fetchAddress(lat, lon){
  const key = lat.toFixed(5) + ',' + lon.toFixed(5);
  const el = () => document.getElementById('metaAddr');
  if (addrCache.key === key) { if (el()) el().textContent = addrCache.text; return; }
  try {
    const r = await fetch('https://nominatim.openstreetmap.org/reverse?format=jsonv2&accept-language=hr&zoom=18&lat=' + lat + '&lon=' + lon);
    const j = await r.json();
    addrCache = { key, text: j.display_name || 'adresa nedostupna' };
  } catch (e) {
    addrCache = { key, text: 'adresa nedostupna' };
  }
  if (el()) el().textContent = addrCache.text;
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
function renderZones(data){
  const el = document.getElementById('zonesContent');
  const seg = segmentRooms(data);
  if (seg.zones.length) {
    renderZonesSegmented(el, data, seg);
  } else {
    renderZonesFallback(el, data);
  }
}

function renderZonesSegmented(el, data, seg){
  const furnByZone = furnitureByZone(data, seg.grid);
  const wallMap = wallsByZone(data, seg);
  // left-to-right, top-to-bottom reading order for a stable, predictable list
  const ordered = [...seg.zones].sort((a,b) => a.center[1]-b.center[1] || a.center[0]-b.center[0]);

  let html = '';
  ordered.forEach((z, i) => {
    const objs = furnByZone.get(z.zoneId) || [];
    const cls = classifyZone(z, objs);
    const title = cls === 'Other' ? 'Soba ' + (i+1) : ZONE_LABELS_HR[cls];
    const walls = (wallMap.get(z.zoneId) || []).slice().sort((a,b) => b.netArea - a.netArea);
    const wallsTotal = sum(walls, w => w.netArea);

    html += '<div class="zone-block">';
    html += '<div class="zone-title">' + esc(title) + '</div>';
    html += '<div class="zone-sub">' + fmtArea(z.area) + ' pod · ' + fmtArea(wallsTotal) + ' zidovi (za premaz)' +
      (objs.length ? ' · ' + objs.map(o=>esc(catLabel(o))).join(' · ') : ' · nema namještaja') + '</div>';
    if (walls.length) {
      html += '<table style="margin-top:6px;"><thead><tr><th>Zid</th><th>Dim (m)</th><th>Površina</th><th></th></tr></thead><tbody>';
      html += walls.map(w => {
        const wg = w.wall;
        const badge = w.sharedWith != null ? ' <span class="badge b-shared">dijeljen</span>' : '';
        return '<tr><td>' + esc(String(wg.identifier).slice(0,8)) + badge + '</td><td>' + wg.dimensions[0].toFixed(2) + ' × ' + wg.dimensions[1].toFixed(2) + '</td><td>' + fmt(w.netArea) + '</td><td></td></tr>';
      }).join('');
      html += '</tbody></table>';
    }
    html += '</div>';
  });
  el.innerHTML = html;
  const note = document.getElementById('zonesNote');
  if (note) {
    note.textContent = 'Automatska segmentacija (mreža ' + (CELL_M*100).toFixed(0) + ' cm) — granice i klasifikacija su procjena. "Dijeljen" zid ulazi punom površinom u obje sobe (svaka strana svoj premaz); ukupni zbroj zidova u Pregledu i dalje broji svaki zid jednom.';
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

function renderCeilingPanel(ceiling){
  const el = document.getElementById('ceilingContent');
  if (!ceiling) { el.innerHTML = '<div style="color:var(--ink-faint); font-family:ui-monospace,monospace; font-size:11.5px;">Nema zidova za rekonstrukciju.</div>'; return; }
  if (ceiling.flat) {
    el.innerHTML = '<div style="font-family:ui-monospace,monospace; font-size:11.5px; color:var(--ink-dim);">Nijedan zid nema kosi gornji rub (nema detektiranih kosina) — strop se tretira kao ravan, jednak tlocrtu poda.</div>';
    return;
  }
  let html = '<table><thead><tr><th>Zid</th><th>Greben (puna V)</th><th>Koljenasti zid</th><th>Segmenti</th></tr></thead><tbody>';
  for (const p of ceiling.profiles) {
    const segStr = p.segments.map(s => s.isSlope ? (s.angleDeg.toFixed(1) + '° (' + s.run.toFixed(2) + '×' + s.rise.toFixed(2) + 'm)') : ('ravno ' + s.run.toFixed(2) + 'm')).join(', ');
    html += '<tr><td>' + esc(String(p.wallId).slice(0,8)) + '</td><td>' + fmt(p.ridgeHeight) + ' m</td><td>' + fmt(p.kneeWallHeight) + ' m</td><td style="font-size:10.5px;">' + esc(segStr) + '</td></tr>';
  }
  html += '</tbody></table>';
  const multi = ceiling.rooms.filter(r => !r.flat).length > 1 || ceiling.rooms.length > 1;
  for (const room of ceiling.rooms) {
    if (room.flat) continue;
    const tag = multi ? 'Prostorija ' + (room.roomIdx+1) + ': ' : '';
    if (room.ceilingArea != null) {
      html += '<div class="assumption">' + tag + 'prosječni presjek ' + fmt(room.avgProfileLen) + ' m × duljina prostorije ' + fmt(room.roomLength) + ' m = <strong style="color:var(--line-bright);">' + fmt(room.ceilingArea) + ' m²</strong> površine stropa. Duljina = razmak kosih (zabatnih) zidova, odnosno najdulji ravni zid kad postoji samo jedan kosi. Pretpostavka: isti poprečni presjek kroz cijelu duljinu (jednostavan krov) — nije pouzdano za krovove koji se mijenjaju u oba smjera.</div>';
    } else {
      html += '<div class="assumption">' + tag + '<span class="warn">nedovoljno podataka za duljinu prostorije — površina stropa nije izračunata.</span></div>';
    }
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
  // IMPORTANT: ARKit/RoomPlan world yaw is session-dependent — world -Z is true
  // north ONLY when the scanner app used gravityAndHeading world alignment.
  // Otherwise -Z points wherever the phone faced when the scan started. The plan
  // therefore auto-aligns to the longest wall by default, offers manual rotation,
  // and the compass rotates together with the plan (it tracks the assumed north
  // direction, it does not claim true north).
  const northB = northBearingDeg(); // bearing of world -Z, or null without meta.json
  // The drawing is always straight, aligned to the longest wall — never tilted.
  // Landscape puts that wall horizontal, Portrait vertical; the compass rose in
  // the legend keeps pointing at the real north either way.
  const longest = data.walls.reduce((a,b) => (b.dimensions[0] > a.dimensions[0] ? b : a));
  const lseg = wallSegment(longest);
  const wallAngle = Math.atan2(lseg.p2[1]-lseg.p1[1], lseg.p2[0]-lseg.p1[0]) * 180/Math.PI;
  // how far true north lands from the top of the screen for a given 90° step
  const northOffsetFor = step => {
    const rose = ((-wallAngle + step - northB) % 360 + 360) % 360;
    return Math.abs(rose > 180 ? rose - 360 : rose);
  };

  let rotDeg, wantLandscape;
  if (northB != null && !orientationOverride) {
    // North-up wins: pick whichever of the FOUR axis-aligned rotations puts true
    // north closest to the top of the screen, and let that decide
    // Portrait/Landscape. Walls stay straight in all four. This matters because
    // a 90° step swaps Portrait<->Landscape, so fixing the orientation first and
    // only tie-breaking the 180° flip (as this did before) can leave north stuck
    // ~90° off — measured on the reference scan: Portrait can only reach 87° or
    // 93° from north-up, while Landscape reaches 3°. That made "face north and
    // the plan matches the room" impossible in Portrait no matter the flip.
    let best = 0;
    for (const step of [90, 180, 270]) if (northOffsetFor(step) < northOffsetFor(best)) best = step;
    rotDeg = -wallAngle + best;
    wantLandscape = best % 180 === 0;
    landToggle.checked = wantLandscape;
  } else {
    if (orientationOverride) {
      wantLandscape = orientationOverride === 'landscape';
    } else {
      const panelW = svg.parentElement ? svg.parentElement.clientWidth : 800;
      wantLandscape = panelW >= window.innerHeight * 0.7;
      landToggle.checked = wantLandscape;
    }
    rotDeg = -wallAngle + (wantLandscape ? 0 : 90);
    // Manual override (or no meta.json): the user's Portrait/Landscape choice
    // is king, but still prefer the 180° variant that puts north nearer the top.
    if (northB != null) {
      const nb = ((rotDeg - northB) % 360 + 360) % 360;
      const d = nb > 180 ? nb - 360 : nb; // signed distance of north from "up", (-180,180]
      if (Math.abs(d) > 90) rotDeg = (rotDeg + 180) % 360;
    }
  }
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
  renderCompass(roseDeg, northB, northB != null ? 'meta.json' : 'procjena');

  legend.innerHTML =
    '<span><span class="sw lg-wall"></span>Ravan zid</span>' +
    '<span><span class="sw lg-slope"></span>Zid s kosinom</span>' +
    '<span><span class="sw lg-open"></span>Otvor</span>' +
    (showFurniture ? '<span><span class="sw lg-furn"></span>Namještaj</span>' : '');
}

// draws the compass rose into the fixed-size #compassSvg in the legend row
function renderCompass(roseDeg, northB, label){
  const c = document.getElementById('compassSvg');
  const cx = 44, cy = 44, r = 40, stroke = 1.1, fontSize = 14;
  window.__compassState = { roseDeg, northB, cx, cy };
  const parts = [];
  compassRose(parts, cx, cy, r, roseDeg, stroke, fontSize, label);
  c.innerHTML = parts.join('');
  updateDevNeedle();
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
  // live device-orientation marker: a small solid arrow (hidden until enabled)
  parts.push('<g id="devNeedle" style="display:none">' +
    '<polygon class="sv-live" points="' + cx + ',' + (cy - r*0.64) + ' ' + (cx - r*0.085) + ',' + (cy - r*0.34) + ' ' + (cx + r*0.085) + ',' + (cy - r*0.34) + '"/>' +
    '</g>');
  parts.push('<text x="' + cx + '" y="' + (cy + r + fontSize*0.8) + '" class="sv-muted" font-size="' + (fontSize*0.55) + '" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" text-anchor="middle" opacity="0.65">' + label + '</text>');
}
