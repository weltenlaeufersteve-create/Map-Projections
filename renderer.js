'use strict';
const { ipcRenderer } = require('electron');
const shp  = require('shpjs');
const fs   = require('fs');
const path = require('path');
const d3geo           = require('d3-geo');
const { geoCahillKeyes } = require('d3-geo-polygon');

// Natural Earth data folder
const APP_DIR = path.join(__dirname, 'data');

// ─── State ────────────────────────────────────────────────────────────────────
let worldFeatures   = [];
let lakesFeatures   = [];
let riversFeatures  = [];
let countryNames    = [];
let selectedCountries = [];
let combos          = loadCombos();
let activeComboId   = null;
let countryColors   = loadColors();
let currentSVG      = '';
let colorTargetCountry = null;
let comboCounter    = Math.max(10, ...combos.map(c => c.id));
let resolution      = localStorage.getItem('ne_resolution') || '50m';
let mode            = localStorage.getItem('app_mode') || 'region';

const PALETTE = [
  '#E8A838','#5B8DB8','#4CAF82','#C45A5A','#9B59B6',
  '#E67E22','#1ABC9C','#E91E8C','#3498DB','#F1C40F',
  '#2ECC71','#E74C3C','#8E44AD','#16A085','#D35400',
  '#BDC3C7','#7F8C8D','#2C3E50','#F39C12','#27AE60',
];

// ─── Persistence ──────────────────────────────────────────────────────────────
function loadCombos() {
  try {
    const s = localStorage.getItem('combos');
    if (s) return JSON.parse(s);
  } catch(e) {}
  return [
    { id: 1, countries: ['Namibia', 'Botswana'] },
    { id: 2, countries: ['South Africa', 'Botswana', 'Namibia'] },
    { id: 3, countries: ['Argentina', 'Chile'] },
  ];
}
function saveCombos()  { localStorage.setItem('combos', JSON.stringify(combos)); }
function loadColors()  { try { const s = localStorage.getItem('colors'); return s ? JSON.parse(s) : {}; } catch(e) { return {}; } }
function saveColors()  { localStorage.setItem('colors', JSON.stringify(countryColors)); }

// ─── NE file paths ────────────────────────────────────────────────────────────
function getNEPaths(res) {
  return {
    countries: path.join(APP_DIR, `ne_${res}_admin_0_countries.zip`),
    lakes:     path.join(APP_DIR, `ne_${res}_lakes.zip`),
    rivers:    path.join(APP_DIR, `ne_${res}_rivers_lake_centerlines.zip`),
  };
}
function fileExists(p) { try { fs.accessSync(p); return true; } catch { return false; } }

function nodeBufferToArrayBuffer(buf) {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

// ─── Resolution UI ────────────────────────────────────────────────────────────
function updateResolutionUI() {
  ['10m', '50m'].forEach(res => {
    const paths   = getNEPaths(res);
    const avail   = fileExists(paths.countries);
    const optEl   = document.getElementById(`resOpt${res}`);
    const availEl = document.getElementById(`resAvail${res}`);
    if (avail) {
      availEl.textContent = '✓ available';
      optEl.classList.remove('unavail');
    } else {
      availEl.textContent = '—';
      optEl.classList.add('unavail');
    }
    if (res === resolution) {
      document.getElementById(`res${res}`).checked = true;
      optEl.classList.add('active');
    }
  });
}

// ─── Auto-load from app folder ────────────────────────────────────────────────
async function autoLoad() {
  const paths = getNEPaths(resolution);
  if (!fileExists(paths.countries)) {
    setStatus(`ne_${resolution}_admin_0_countries.zip not found`, 'err');
    return;
  }
  await loadCountriesFromPath(paths.countries);

  // Physical: load all that exist
  const physPaths = [paths.lakes, paths.rivers].filter(fileExists);
  if (physPaths.length) {
    document.getElementById('physAutoLabel').textContent = 'auto';
    await loadPhysicalFromPaths(physPaths);
  }
}

// ─── Shapefile parsing helpers ────────────────────────────────────────────────
let NAME_FIELD = 'NAME';

function detectNameField(props) {
  for (const c of ['NAME','NAME_EN','ADMIN','name','Name','COUNTRY','SOVEREIGNT']) {
    if (props[c] !== undefined && String(props[c]).replace(/\0/g,'').trim().length > 0) return c;
  }
  return Object.keys(props)[0] || 'NAME';
}

function getCountryName(feature) {
  const val = feature.properties ? feature.properties[NAME_FIELD] : '';
  return (val || '').replace(/\0/g, '').trim();
}

function processGeoJSON(geojson) {
  let features = [];
  if (Array.isArray(geojson)) {
    for (const g of geojson) { if (g && g.features) features = features.concat(g.features); }
  } else if (geojson && geojson.features) {
    features = geojson.features;
  }
  return features;
}

// ─── Loaders: file-path based (Node fs) ──────────────────────────────────────
async function loadCountriesFromPath(filePath) {
  setStatus('Loading…', 'loading');
  try {
    const buf = fs.readFileSync(filePath);
    const geojson = await shp(nodeBufferToArrayBuffer(buf));
    worldFeatures = processGeoJSON(geojson);
    if (!worldFeatures.length) throw new Error('No features found');
    NAME_FIELD = detectNameField(worldFeatures[0].properties || {});
    countryNames = worldFeatures.map(getCountryName).filter(Boolean).sort();
    setStatus(`${countryNames.length} countries (${resolution})`, 'ok');
    document.getElementById('generateBtn').disabled = false;
    renderComboList();
  } catch(e) {
    setStatus('Error: ' + e.message, 'err');
    console.error(e);
  }
}

async function loadPhysicalFromPaths(filePaths) {
  const statusEl = document.getElementById('fileStatusPhysical');
  statusEl.innerHTML = pill('Loading…', 'loading');
  const loaded = [];
  try {
    for (const fp of filePaths) {
      const buf      = fs.readFileSync(fp);
      const geojson  = await shp(nodeBufferToArrayBuffer(buf));
      const features = processGeoJSON(geojson);
      const name     = path.basename(fp).toLowerCase();
      if (name.includes('river')) { riversFeatures = features; loaded.push(`${features.length} rivers`); }
      else if (name.includes('lake')) { lakesFeatures = features; loaded.push(`${features.length} lakes`); }
    }
    if (loaded.length) {
      statusEl.innerHTML = pill(loaded.join(', ') + ' loaded', 'ok');
      showLayerToggles();
    }
  } catch(e) {
    statusEl.innerHTML = pill('Error: ' + e.message, 'err');
    console.error(e);
  }
}

// ─── Loaders: File object based (drag-and-drop) ───────────────────────────────
async function loadFromFileObjects(files) {
  setStatus('Loading…', 'loading');
  try {
    const arr = Array.from(files);
    let geojson;
    if (arr.length === 1 && arr[0].name.toLowerCase().endsWith('.zip')) {
      geojson = await shp(await arr[0].arrayBuffer());
    } else {
      const shpF = arr.find(f => f.name.toLowerCase().endsWith('.shp'));
      const dbfF = arr.find(f => f.name.toLowerCase().endsWith('.dbf'));
      if (!shpF || !dbfF) throw new Error('.shp und .dbf benötigt');
      geojson = await shp.combine([shp.parseShp(await shpF.arrayBuffer()), shp.parseDbf(await dbfF.arrayBuffer())]);
    }
    worldFeatures = processGeoJSON(geojson);
    if (!worldFeatures.length) throw new Error('No features found');
    NAME_FIELD = detectNameField(worldFeatures[0].properties || {});
    countryNames = worldFeatures.map(getCountryName).filter(Boolean).sort();
    setStatus(`${countryNames.length} countries loaded`, 'ok');
    document.getElementById('generateBtn').disabled = false;
    renderComboList();
  } catch(e) {
    setStatus('Error: ' + e.message, 'err');
    console.error(e);
  }
}

async function loadPhysicalFromFileObjects(files) {
  const statusEl = document.getElementById('fileStatusPhysical');
  statusEl.innerHTML = pill('Loading…', 'loading');
  const loaded = [];
  try {
    for (const file of Array.from(files)) {
      const geojson  = await shp(await file.arrayBuffer());
      const features = processGeoJSON(geojson);
      const name     = file.name.toLowerCase();
      if (name.includes('river')) { riversFeatures = features; loaded.push(`${features.length} rivers`); }
      else if (name.includes('lake')) { lakesFeatures = features; loaded.push(`${features.length} lakes`); }
    }
    if (loaded.length) {
      statusEl.innerHTML = pill(loaded.join(', ') + ' loaded', 'ok');
      showLayerToggles();
    }
  } catch(e) {
    statusEl.innerHTML = pill('Error: ' + e.message, 'err');
    console.error(e);
  }
}

function showLayerToggles() {
  const el = document.getElementById('layerToggles');
  el.style.display = 'flex';
  el.style.flexDirection = 'column';
}

// ─── Projection ───────────────────────────────────────────────────────────────
function projectFeatures(features, projType) {
  let minLon=Infinity, minLat=Infinity, maxLon=-Infinity, maxLat=-Infinity;
  function scanCoords(coords) {
    if (typeof coords[0] === 'number') {
      minLon = Math.min(minLon, coords[0]); maxLon = Math.max(maxLon, coords[0]);
      minLat = Math.min(minLat, coords[1]); maxLat = Math.max(maxLat, coords[1]);
    } else { coords.forEach(scanCoords); }
  }
  features.forEach(f => f.geometry && scanCoords(f.geometry.coordinates));

  const lon0 = ((minLon + maxLon) / 2) * Math.PI / 180;
  const lat0 = ((minLat + maxLat) / 2) * Math.PI / 180;
  const R = 6371000;

  function projectPoint(pt) {
    const lon = pt[0] * Math.PI / 180;
    const lat = pt[1] * Math.PI / 180;
    try {
      if (projType === 'laea') {
        const sinLat0=Math.sin(lat0), cosLat0=Math.cos(lat0);
        const sinLat =Math.sin(lat),  cosLat =Math.cos(lat);
        const cosD   = sinLat0*sinLat + cosLat0*cosLat*Math.cos(lon-lon0);
        const k = Math.sqrt(2/(1+cosD));
        return [ R*k*cosLat*Math.sin(lon-lon0), R*k*(cosLat0*sinLat - sinLat0*cosLat*Math.cos(lon-lon0)) ];
      } else if (projType === 'aeqd') {
        const sinLat0=Math.sin(lat0), cosLat0=Math.cos(lat0);
        const sinLat =Math.sin(lat),  cosLat =Math.cos(lat);
        const cosC = sinLat0*sinLat + cosLat0*cosLat*Math.cos(lon-lon0);
        const c = Math.acos(Math.max(-1, Math.min(1, cosC)));
        const k = c === 0 ? R : R*c/Math.sin(c);
        return [ k*cosLat*Math.sin(lon-lon0), k*(cosLat0*sinLat - sinLat0*cosLat*Math.cos(lon-lon0)) ];
      } else {
        return [ R*(lon-lon0), R*Math.log(Math.tan(Math.PI/4 + lat/2)) ];
      }
    } catch(e) { return [NaN, NaN]; }
  }

  function projectRing(ring) { return ring.map(projectPoint); }
  function projectGeometry(geom) {
    if (geom.type === 'Polygon')      return { ...geom, coordinates: geom.coordinates.map(projectRing) };
    if (geom.type === 'MultiPolygon') return { ...geom, coordinates: geom.coordinates.map(p => p.map(projectRing)) };
    return geom;
  }

  const projected = features.map(f => f.geometry ? { ...f, geometry: projectGeometry(f.geometry) } : f);

  let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
  function scanRing(ring) {
    for (const pt of ring) {
      if (!isNaN(pt[0]) && !isNaN(pt[1])) {
        if (pt[0]<minX) minX=pt[0]; if (pt[0]>maxX) maxX=pt[0];
        if (pt[1]<minY) minY=pt[1]; if (pt[1]>maxY) maxY=pt[1];
      }
    }
  }
  for (const f of projected) {
    if (!f.geometry) continue;
    if (f.geometry.type === 'Polygon')      f.geometry.coordinates.forEach(scanRing);
    if (f.geometry.type === 'MultiPolygon') f.geometry.coordinates.forEach(p => p.forEach(scanRing));
  }

  return { features: projected, bounds: { minX, minY, maxX, maxY }, projectPoint };
}

// ─── Water helpers ────────────────────────────────────────────────────────────
function getFeaturesBBox(features) {
  let minLon=Infinity, minLat=Infinity, maxLon=-Infinity, maxLat=-Infinity;
  function scan(coords) {
    if (!coords || !coords.length) return;
    if (typeof coords[0] === 'number') {
      if (coords[0]<minLon) minLon=coords[0]; if (coords[0]>maxLon) maxLon=coords[0];
      if (coords[1]<minLat) minLat=coords[1]; if (coords[1]>maxLat) maxLat=coords[1];
    } else coords.forEach(scan);
  }
  features.forEach(f => f.geometry && scan(f.geometry.coordinates));
  return { minLon, minLat, maxLon, maxLat };
}

function ringIntersectsBBox(ring, bbox) {
  for (const p of ring) {
    if (p[0]>=bbox.minLon && p[0]<=bbox.maxLon && p[1]>=bbox.minLat && p[1]<=bbox.maxLat) return true;
  }
  let rMinX=Infinity, rMinY=Infinity, rMaxX=-Infinity, rMaxY=-Infinity;
  for (const p of ring) {
    if (p[0]<rMinX) rMinX=p[0]; if (p[0]>rMaxX) rMaxX=p[0];
    if (p[1]<rMinY) rMinY=p[1]; if (p[1]>rMaxY) rMaxY=p[1];
  }
  return !(rMaxX<bbox.minLon || rMinX>bbox.maxLon || rMaxY<bbox.minLat || rMinY>bbox.maxLat);
}

function projectWaterRing(ring, projectFn) {
  return ring.map(pt => {
    if (!pt) return [NaN, NaN];
    const p = Array.isArray(pt[0]) ? pt[0] : pt;
    if (typeof p[0] !== 'number') return [NaN, NaN];
    return projectFn(p[0], p[1]);
  });
}

function renderLakes(feats, bbox, projectFn, toSVG, color, clipper) {
  const paths = [];
  for (const f of feats) {
    const geom = f.geometry; if (!geom) continue;
    const polys = geom.type === 'MultiPolygon' ? geom.coordinates : [geom.coordinates];
    for (const poly of polys) {
      if (!poly || !poly[0] || !poly[0][0]) continue;
      if (!ringIntersectsBBox(poly[0], bbox)) continue;
      // Project rings to SVG coordinate space, then clip to viewport
      const svgRings = poly
        .map(ring => projectWaterRing(ring, projectFn)
          .filter(p => !isNaN(p[0]) && !isNaN(p[1]))
          .map(p => toSVG(p[0], p[1])))
        .filter(r => r.length >= 3);
      if (!svgRings.length) continue;
      const d = clipper({ type: 'Polygon', coordinates: svgRings });
      if (d) paths.push(`<path d="${d}" fill="${color}" stroke="none"/>`);
    }
  }
  return paths.join('\n  ');
}

function renderRivers(feats, bbox, projectFn, toSVG, color, width, clipper) {
  const lines = [];
  for (const f of feats) {
    const geom = f.geometry; if (!geom) continue;
    const linestrings = geom.type === 'MultiLineString' ? geom.coordinates
                      : geom.type === 'LineString'      ? [geom.coordinates] : null;
    if (!linestrings) continue;
    for (const line of linestrings) {
      if (!line || line.length < 2) continue;
      const fp = line[0];
      if (!fp || !Array.isArray(fp) || typeof fp[0] !== 'number') continue;
      if (!ringIntersectsBBox(line, bbox)) continue;
      // Project to SVG space, then clip to viewport
      const svgPts = projectWaterRing(line, projectFn)
        .filter(p => !isNaN(p[0]) && !isNaN(p[1]))
        .map(p => toSVG(p[0], p[1]));
      if (svgPts.length < 2) continue;
      const d = clipper({ type: 'LineString', coordinates: svgPts });
      if (d) lines.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`);
    }
  }
  return lines.join('\n  ');
}

// ─── Island filter ────────────────────────────────────────────────────────────
function filterIslands(features, thresholdPct) {
  if (thresholdPct === 0) return features;
  const ratio = thresholdPct / 100;
  function polyArea(ring) {
    let a = 0;
    for (let i=0, j=ring.length-1; i<ring.length; j=i++) {
      a += (ring[j][0]+ring[i][0]) * (ring[j][1]-ring[i][1]);
    }
    return Math.abs(a/2);
  }
  return features.map(f => {
    const geom = f.geometry;
    if (!geom || geom.type !== 'MultiPolygon') return f;
    const parts = geom.coordinates.map(poly => ({ rings: poly, area: polyArea(poly[0]) }));
    const maxArea = Math.max(...parts.map(p => p.area));
    const kept = parts.filter(p => p.area >= ratio * maxArea);
    if (!kept.length || kept.length === parts.length) return f;
    if (kept.length === 1) return { ...f, geometry: { type: 'Polygon', coordinates: kept[0].rings } };
    return { ...f, geometry: { ...geom, coordinates: kept.map(p => p.rings) } };
  });
}

// ─── SVG generation ───────────────────────────────────────────────────────────
function generateSVG(features, bounds, colorMap, strokeW, strokeCol, waterOpts) {
  const W=900, H=900, margin=50;
  const { minX, minY, maxX, maxY } = bounds;
  const scale = Math.min((W-2*margin)/(maxX-minX), (H-2*margin)/(maxY-minY));
  const mapW  = (maxX-minX)*scale, mapH = (maxY-minY)*scale;
  const offX  = (W-mapW)/2, offY = (H-mapH)/2;
  const vx=offX, vy=offY, vw=mapW, vh=mapH;

  function toSVG(x, y) { return [ offX+(x-minX)*scale, H-offY-(y-minY)*scale ]; }

  function ringToPath(ring) {
    if (!ring || ring.length < 2) return '';
    const pts = ring.filter(pt => pt && !isNaN(pt[0]) && !isNaN(pt[1]));
    if (pts.length < 2) return '';
    const sp = pts.map(pt => toSVG(pt[0], pt[1]));
    return `M ${sp[0][0].toFixed(2)},${sp[0][1].toFixed(2)}` + sp.slice(1).map(p=>` L ${p[0].toFixed(2)},${p[1].toFixed(2)}`).join('') + ' Z';
  }

  function geomToPath(geom) {
    if (!geom || !geom.coordinates) return '';
    if (geom.type === 'Polygon')      return geom.coordinates.map(ringToPath).filter(Boolean).join(' ');
    if (geom.type === 'MultiPolygon') return geom.coordinates.map(p=>p.map(ringToPath).filter(Boolean).join(' ')).filter(Boolean).join(' ');
    return '';
  }

  const paths = features.map(f => {
    const name  = getCountryName(f);
    const color = colorMap[name] || '#888888';
    const d     = geomToPath(f.geometry);
    return `  <path id="${name.toLowerCase().replace(/\s+/g,'_')}" d="${d}" fill="${color}" stroke="${strokeCol}" stroke-width="${strokeW}" stroke-linejoin="round"/>`;
  });

  let lakeSVG = '', riverSVG = '';
  if (waterOpts) {
    const projectWaterPt = (lon, lat) => waterOpts.projectPoint([lon, lat]);
    // Clip water paths hard to the SVG viewport — no stray geometry outside the frame
    const clipper = d3geo.geoPath(
      d3geo.geoIdentity().clipExtent([[vx, vy], [vx + vw, vy + vh]])
    );
    if (waterOpts.showLakes && waterOpts.lakesFeatures.length)
      lakeSVG = renderLakes(waterOpts.lakesFeatures, waterOpts.bbox, projectWaterPt, toSVG, waterOpts.lakeColor, clipper);
    if (waterOpts.showRivers && waterOpts.riversFeatures.length)
      riverSVG = renderRivers(waterOpts.riversFeatures, waterOpts.bbox, projectWaterPt, toSVG, waterOpts.riverColor, waterOpts.riverWidth, clipper);
  }

  const waterPart = (lakeSVG  ? `\n  <g id="lakes">\n  ${lakeSVG}\n  </g>` : '')
                  + (riverSVG ? `\n  <g id="rivers">\n  ${riverSVG}\n  </g>` : '');

  const names = features.map(getCountryName).join(', ');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- Countries: ${names} -->
<!-- Natural Earth ${resolution} | Projektion: Local ${document.querySelector('input[name="proj"]:checked').value.toUpperCase()} -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vx.toFixed(2)} ${vy.toFixed(2)} ${vw.toFixed(2)} ${vh.toFixed(2)}">
  <g id="countries" fill-rule="evenodd">
${paths.join('\n')}
  </g>${waterPart}
</svg>`;
}

// ─── World Mode: Double Hemisphere (for azimuthal projections) ───────────────
// ─── World Mode: reference line helper ───────────────────────────────────────
function latLineGeoJSON(lat) {
  const coords = [];
  for (let lon = -180; lon <= 180; lon++) coords.push([lon, lat]);
  return { type: 'LineString', coordinates: coords };
}

// ─── World Mode SVG Generation ───────────────────────────────────────────────
function generateWorldSVG(allFeatures, selectedSet, colorMap, projType, strokeW, strokeCol, waterOpts) {
  const W = 2000, H = 1000;
  const extent = [[40, 40], [W - 40, H - 40]];
  const sphere = { type: 'Sphere' };

  let projection;
  switch (projType) {
    case 'cahill-keyes':
      projection = geoCahillKeyes().fitExtent(extent, sphere); break;
    case 'equirectangular':
      projection = d3geo.geoEquirectangular().fitExtent(extent, sphere); break;
    default: // naturalearth
      projection = d3geo.geoNaturalEarth1().fitExtent(extent, sphere);
  }

  const pathGen = d3geo.geoPath(projection);

  // ── Raster options from UI ──────────────────────────────────────────────────
  const oceanColor    = document.getElementById('oceanColor')?.value   ?? '#1a2840';
  const neutralColor  = document.getElementById('neutralColor')?.value ?? '#3a3a3a';
  const showGraticule = document.getElementById('showGraticule')?.checked ?? true;
  const gratColor     = document.getElementById('gratColor')?.value   ?? '#1e3a5a';
  const showEquator   = document.getElementById('showEquator')?.checked  ?? true;
  const showTropics   = document.getElementById('showTropics')?.checked  ?? true;
  const showPolar     = document.getElementById('showPolar')?.checked    ?? true;

  // ── Ocean background ────────────────────────────────────────────────────────
  const sphereD = pathGen(sphere) || '';

  // ── Graticule (15° grid) ────────────────────────────────────────────────────
  let gratSVG = '';
  if (showGraticule) {
    const d = pathGen(d3geo.geoGraticule().step([15, 15])());
    if (d) gratSVG = `  <path id="graticule" d="${d}" fill="none" stroke="${gratColor}" stroke-width="0.4"/>`;
  }

  // ── Reference lines ─────────────────────────────────────────────────────────
  const refPaths = [];
  if (showEquator) {
    const d = pathGen(latLineGeoJSON(0));
    if (d) refPaths.push(`    <path id="equator" d="${d}" fill="none" stroke="rgba(61,159,255,0.55)" stroke-width="0.9"/>`);
  }
  if (showTropics) {
    [23.5, -23.5].forEach(lat => {
      const d = pathGen(latLineGeoJSON(lat));
      if (d) refPaths.push(`    <path d="${d}" fill="none" stroke="rgba(255,200,70,0.45)" stroke-width="0.5" stroke-dasharray="5,4"/>`);
    });
  }
  if (showPolar) {
    [66.5, -66.5].forEach(lat => {
      const d = pathGen(latLineGeoJSON(lat));
      if (d) refPaths.push(`    <path d="${d}" fill="none" stroke="rgba(160,200,255,0.35)" stroke-width="0.5" stroke-dasharray="3,5"/>`);
    });
  }
  const refLinesSVG = refPaths.length
    ? `  <g id="reference-lines">\n${refPaths.join('\n')}\n  </g>` : '';

  // ── Countries ───────────────────────────────────────────────────────────────
  const countryPaths = allFeatures.map(f => {
    const name  = getCountryName(f);
    const color = selectedSet.includes(name) ? (colorMap[name] || '#E8A838') : neutralColor;
    const d = pathGen(f);
    if (!d) return '';
    return `  <path id="${name.toLowerCase().replace(/[^a-z0-9]/g,'_')}" d="${d}" fill="${color}" stroke="${strokeCol}" stroke-width="${strokeW}" stroke-linejoin="round"/>`;
  }).filter(Boolean);

  // ── Water layers ─────────────────────────────────────────────────────────────
  let lakesSVG = '', riversSVG = '';
  if (waterOpts) {
    if (waterOpts.showLakes && waterOpts.lakesFeatures.length) {
      lakesSVG = waterOpts.lakesFeatures.map(f => {
        const d = pathGen(f); if (!d) return '';
        return `<path d="${d}" fill="${waterOpts.lakeColor}" stroke="none"/>`;
      }).filter(Boolean).join('\n  ');
    }
    if (waterOpts.showRivers && waterOpts.riversFeatures.length) {
      riversSVG = waterOpts.riversFeatures.map(f => {
        const d = pathGen(f); if (!d) return '';
        return `<path d="${d}" fill="none" stroke="${waterOpts.riverColor}" stroke-width="${waterOpts.riverWidth}" stroke-linecap="round" stroke-linejoin="round"/>`;
      }).filter(Boolean).join('\n  ');
    }
  }
  const waterPart = (lakesSVG  ? `\n  <g id="lakes">\n  ${lakesSVG}\n  </g>`  : '')
                  + (riversSVG ? `\n  <g id="rivers">\n  ${riversSVG}\n  </g>` : '');

  const names = selectedSet.join(', ') || 'Welt';

  // ── Layer order: ocean → grid → ref lines → countries → water → outline ────
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- Countries: ${names} -->
<!-- Natural Earth ${resolution} | Projektion: ${projType} | World Mode -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">
  <path id="ocean" d="${sphereD}" fill="${oceanColor}"/>
${gratSVG ? gratSVG + '\n' : ''}${refLinesSVG ? refLinesSVG + '\n' : ''}  <g id="countries" fill-rule="evenodd">
${countryPaths.join('\n')}
  </g>${waterPart}
  <path id="sphere-outline" d="${sphereD}" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="0.5"/>
</svg>`;
}

// ─── UI Helpers ───────────────────────────────────────────────────────────────
function pill(msg, type) {
  return `<div class="status-pill ${type}"><div class="dot ${type==='loading'?'pulse':''}"></div>${msg}</div>`;
}
function setStatus(msg, type) {
  document.getElementById('fileStatus').innerHTML = pill(msg, type);
}

// ─── Window controls ──────────────────────────────────────────────────────────
document.getElementById('winMin').addEventListener('click', () => ipcRenderer.send('win:minimize'));
document.getElementById('winMax').addEventListener('click', () => ipcRenderer.send('win:maximize'));
document.getElementById('winClose').addEventListener('click', () => ipcRenderer.send('win:close'));

// ─── Mode toggle ──────────────────────────────────────────────────────────────
function applyMode(m) {
  mode = m;
  localStorage.setItem('app_mode', mode);

  document.getElementById('modeRegion').classList.toggle('active', mode === 'region');
  document.getElementById('modeWorld').classList.toggle('active', mode === 'world');
  document.body.classList.toggle('world-mode', mode === 'world');

  const proj = document.querySelector('input[name="proj"]:checked');
  // Switching to World: region-only projections → switch to naturalearth
  if (mode === 'world' && ['laea', 'aeqd', 'merc'].includes(proj.value)) {
    document.querySelector('input[name="proj"][value="naturalearth"]').checked = true;
  }
  // Switching back to Region: world-only projections → switch back to laea
  if (mode === 'region' && ['cahill-keyes', 'naturalearth', 'equirectangular'].includes(proj.value)) {
    document.querySelector('input[name="proj"][value="laea"]').checked = true;
  }
}

document.getElementById('modeRegion').addEventListener('click', () => applyMode('region'));
document.getElementById('modeWorld').addEventListener('click',  () => applyMode('world'));

// ─── Manual expand toggles ────────────────────────────────────────────────────
function setupToggle(btnId, bodyId) {
  const btn  = document.getElementById(btnId);
  const body = document.getElementById(bodyId);
  btn.addEventListener('click', () => {
    const open = body.classList.toggle('open');
    btn.textContent = (open ? '▾ ' : '▸ ') + 'Load manually…';
  });
}
setupToggle('manualToggle1', 'manualBody1');
setupToggle('manualToggle2', 'manualBody2');

// ─── Resolution toggle ────────────────────────────────────────────────────────
document.querySelectorAll('input[name="res"]').forEach(radio => {
  radio.addEventListener('change', async () => {
    if (radio.value === resolution && worldFeatures.length) return;
    resolution = radio.value;
    localStorage.setItem('ne_resolution', resolution);

    // Update active styling
    document.querySelectorAll('.res-opt').forEach(el => el.classList.remove('active'));
    const resId = resolution === '10m' ? 'resOpt10m' : 'resOpt50m';
    document.getElementById(resId).classList.add('active');

    // Reset loaded data
    worldFeatures = []; countryNames = []; lakesFeatures = []; riversFeatures = [];
    document.getElementById('generateBtn').disabled = true;
    document.getElementById('fileStatusPhysical').innerHTML = '';
    document.getElementById('layerToggles').style.display = 'none';
    document.getElementById('physAutoLabel').textContent = '';

    await autoLoad();
  });
});

// ─── IPC file pickers ─────────────────────────────────────────────────────────
document.getElementById('pickCountriesBtn').addEventListener('click', async () => {
  const result = await ipcRenderer.invoke('dialog:openFiles', {
    title: 'Shapefile wählen',
    filters: [{ name: 'ZIP / SHP', extensions: ['zip','shp'] }],
    properties: ['openFile', 'multiSelections']
  });
  if (!result.canceled && result.filePaths.length) {
    await loadCountriesFromPath(result.filePaths[0]);
  }
});

document.getElementById('pickPhysicalBtn').addEventListener('click', async () => {
  const result = await ipcRenderer.invoke('dialog:openFiles', {
    title: 'Lakes + Rivers ZIPs wählen',
    filters: [{ name: 'ZIP', extensions: ['zip'] }],
    properties: ['openFile', 'multiSelections']
  });
  if (!result.canceled && result.filePaths.length) {
    await loadPhysicalFromPaths(result.filePaths);
  }
});

// ─── Drag-and-drop ────────────────────────────────────────────────────────────
['dropZone', 'dropZonePhys'].forEach((id, i) => {
  const el = document.getElementById(id);
  el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('drag-over'); });
  el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
  el.addEventListener('drop', e => {
    e.preventDefault(); el.classList.remove('drag-over');
    if (i === 0) loadFromFileObjects(e.dataTransfer.files);
    else         loadPhysicalFromFileObjects(e.dataTransfer.files);
  });
});

// ─── Autocomplete ─────────────────────────────────────────────────────────────
const countryInput     = document.getElementById('countryInput');
const autocompleteList = document.getElementById('autocompleteList');
let acFocusedIdx = -1;

countryInput.addEventListener('input', () => {
  const q = countryInput.value.toLowerCase();
  if (!q || !countryNames.length) { autocompleteList.classList.remove('open'); return; }
  const matches = countryNames.filter(n => n.toLowerCase().includes(q)).slice(0, 8);
  if (!matches.length) { autocompleteList.classList.remove('open'); return; }
  autocompleteList.innerHTML = matches.map(m => `<div class="autocomplete-item" data-name="${m}">${m}</div>`).join('');
  autocompleteList.classList.add('open');
  acFocusedIdx = -1;
});

autocompleteList.addEventListener('click', e => {
  const item = e.target.closest('.autocomplete-item');
  if (item) addToSelection(item.dataset.name);
});

countryInput.addEventListener('keydown', e => {
  const items = autocompleteList.querySelectorAll('.autocomplete-item');
  if (e.key === 'ArrowDown') { acFocusedIdx = Math.min(acFocusedIdx+1, items.length-1); updateAcFocus(items); e.preventDefault(); }
  else if (e.key === 'ArrowUp')  { acFocusedIdx = Math.max(acFocusedIdx-1, 0); updateAcFocus(items); e.preventDefault(); }
  else if (e.key === 'Enter')    { if (acFocusedIdx >= 0 && items[acFocusedIdx]) addToSelection(items[acFocusedIdx].dataset.name); else if (items.length) addToSelection(items[0].dataset.name); }
  else if (e.key === 'Escape')   { autocompleteList.classList.remove('open'); }
});

document.addEventListener('click', e => {
  if (!e.target.closest('.country-input-wrap')) autocompleteList.classList.remove('open');
});

function updateAcFocus(items) {
  items.forEach((it, i) => it.classList.toggle('focused', i === acFocusedIdx));
}

function addToSelection(name) {
  if (!selectedCountries.includes(name)) {
    selectedCountries.push(name);
    if (!countryColors[name]) {
      countryColors[name] = PALETTE[Object.keys(countryColors).length % PALETTE.length];
    }
    renderSelectedTags(); renderColorAssign();
  }
  countryInput.value = '';
  autocompleteList.classList.remove('open');
}

function removeFromSelection(name) {
  selectedCountries = selectedCountries.filter(n => n !== name);
  renderSelectedTags(); renderColorAssign();
}
window.removeFromSelection = removeFromSelection;

function renderSelectedTags() {
  document.getElementById('selectedCountries').innerHTML = selectedCountries.map(name => {
    const color = countryColors[name] || '#888';
    return `<div class="sel-tag" style="background:${color}">${name}<button onclick="removeFromSelection('${name.replace(/'/g,"\\'")}')">×</button></div>`;
  }).join('');
}

document.getElementById('clearSelBtn').addEventListener('click', () => {
  selectedCountries = []; renderSelectedTags(); renderColorAssign();
});

// ─── Combos ───────────────────────────────────────────────────────────────────
function renderComboList() {
  const list = document.getElementById('comboList');
  if (!combos.length) {
    list.innerHTML = '<div style="font-size:11px;color:var(--text-dim);">No combos saved yet</div>'; return;
  }
  list.innerHTML = combos.map(c => `
    <div class="combo-item ${activeComboId===c.id?'active':''}" onclick="loadCombo(${c.id})">
      <div class="combo-tags">${c.countries.map(n=>`<span class="combo-tag">${n}</span>`).join('')}</div>
      <button class="combo-remove" onclick="event.stopPropagation();removeCombo(${c.id})">×</button>
    </div>`).join('');
}
window.loadCombo = function(id) {
  const combo = combos.find(c => c.id === id); if (!combo) return;
  activeComboId = id;
  selectedCountries = [...combo.countries];
  selectedCountries.forEach(name => {
    if (!countryColors[name]) countryColors[name] = PALETTE[Object.keys(countryColors).length % PALETTE.length];
  });
  renderSelectedTags(); renderColorAssign(); renderComboList();
};
window.removeCombo = function(id) {
  combos = combos.filter(c => c.id !== id);
  if (activeComboId === id) activeComboId = null;
  saveCombos(); renderComboList();
};

document.getElementById('addComboBtn').addEventListener('click', () => {
  if (!selectedCountries.length) return;
  comboCounter++;
  combos.push({ id: comboCounter, countries: [...selectedCountries] });
  activeComboId = comboCounter;
  saveCombos(); renderComboList();
});

// ─── Color assign ─────────────────────────────────────────────────────────────
function renderColorAssign() {
  const container = document.getElementById('colorAssign');
  if (!selectedCountries.length) {
    container.innerHTML = '<div style="font-size:11px;color:var(--text-dim);">Select countries to assign colours</div>'; return;
  }
  container.innerHTML = selectedCountries.map(name => {
    const color = countryColors[name] || '#888';
    return `<div class="color-assign-row"><span>${name}</span><div class="color-dot" style="background:${color}" onclick="openColorPicker('${name.replace(/'/g,"\\'")}', this)"></div></div>`;
  }).join('');
}

const popup = document.getElementById('colorPickerPopup');
popup.innerHTML = PALETTE.map(c => `<div class="swatch" style="background:${c}" data-color="${c}"></div>`).join('')
  + `<input type="color" id="customColor" style="width:100%;margin-top:4px;height:26px;border:none;background:none;cursor:pointer;">`;

popup.addEventListener('click', e => {
  const swatch = e.target.closest('.swatch');
  if (swatch && colorTargetCountry) {
    countryColors[colorTargetCountry] = swatch.dataset.color;
    saveColors(); renderSelectedTags(); renderColorAssign(); popup.classList.remove('open');
  }
});

document.getElementById('customColor').addEventListener('input', e => {
  if (colorTargetCountry) {
    countryColors[colorTargetCountry] = e.target.value;
    saveColors(); renderSelectedTags(); renderColorAssign();
  }
});

document.addEventListener('click', e => {
  if (!e.target.closest('.color-dot') && !e.target.closest('#colorPickerPopup')) {
    popup.classList.remove('open');
  }
});

window.openColorPicker = function(name, el) {
  colorTargetCountry = name;
  const rect = el.getBoundingClientRect();
  popup.style.left = Math.min(rect.left, window.innerWidth - 190) + 'px';
  popup.style.top  = (rect.bottom + 6) + 'px';
  popup.classList.add('open');
  document.getElementById('customColor').value = countryColors[name] || '#888888';
};

// ─── Sliders ──────────────────────────────────────────────────────────────────
document.getElementById('strokeWidth').addEventListener('input', e => {
  document.getElementById('strokeVal').textContent = e.target.value;
});
document.getElementById('riverWidth').addEventListener('input', e => {
  document.getElementById('riverWidthVal').textContent = e.target.value;
});
document.getElementById('islandThreshold').addEventListener('input', e => {
  const v = parseInt(e.target.value);
  document.getElementById('islandVal').textContent = v === 0 ? 'off' : v + '%';
});

// ─── Generate ─────────────────────────────────────────────────────────────────
document.getElementById('generateBtn').addEventListener('click', () => {
  if (!worldFeatures.length) return;
  if (!selectedCountries.length && mode === 'region') return;

  const projType  = document.querySelector('input[name="proj"]:checked').value;
  const strokeW   = document.getElementById('strokeWidth').value;
  const strokeCol = document.getElementById('strokeColor').value;

  const waterOpts = (lakesFeatures.length || riversFeatures.length) ? {
    showLakes:     document.getElementById('showLakes')?.checked  ?? true,
    showRivers:    document.getElementById('showRivers')?.checked ?? true,
    lakeColor:     document.getElementById('lakeColor')?.value    ?? '#5b8db8',
    riverColor:    document.getElementById('riverColor')?.value   ?? '#7ab3d4',
    riverWidth:    document.getElementById('riverWidth')?.value   ?? '0.8',
    lakesFeatures, riversFeatures,
  } : null;

  if (mode === 'world') {
    currentSVG = generateWorldSVG(worldFeatures, selectedCountries, countryColors, projType, strokeW, strokeCol, waterOpts);
  } else {
    const features = worldFeatures.filter(f => selectedCountries.includes(getCountryName(f)));
    if (!features.length) { setStatus('No matching countries found', 'err'); return; }

    const threshold = parseInt(document.getElementById('islandThreshold').value);
    const filtered  = filterIslands(features, threshold);
    const { features: projected, bounds, projectPoint } = projectFeatures(filtered, projType);

    const rawBBox = getFeaturesBBox(filtered);
    const bbox    = { minLon: rawBBox.minLon-3, minLat: rawBBox.minLat-3, maxLon: rawBBox.maxLon+3, maxLat: rawBBox.maxLat+3 };

    const regionWaterOpts = waterOpts ? { ...waterOpts, bbox, projectPoint } : null;
    currentSVG = generateSVG(projected, bounds, countryColors, strokeW, strokeCol, regionWaterOpts);
  }

  const canvas = document.getElementById('previewCanvas');
  canvas.innerHTML = currentSVG;
  const svg = canvas.querySelector('svg');
  if (svg) {
    svg.style.maxWidth  = '100%';
    svg.style.maxHeight = 'calc(100vh - 120px)';
    svg.removeAttribute('width'); svg.removeAttribute('height');
  }

  const label = mode === 'world'
    ? (selectedCountries.length ? selectedCountries.join(' + ') + ' · World' : 'Welt')
    : selectedCountries.join(' + ');
  document.getElementById('previewLabel').textContent = label;
  document.getElementById('copyPathBtn').style.display = '';
  document.getElementById('downloadBtn').style.display  = '';
  const countLabel = mode === 'world'
    ? `${worldFeatures.length} countries (World)`
    : `${selectedCountries.length} ${selectedCountries.length === 1 ? 'country' : 'countries'}`;
  document.getElementById('svgInfo').textContent = `${countLabel} · ${(currentSVG.length/1024).toFixed(1)} KB · ${resolution}`;
});

// ─── Download + Copy ──────────────────────────────────────────────────────────
document.getElementById('downloadBtn').addEventListener('click', () => {
  if (!currentSVG) return;
  const blob = new Blob([currentSVG], { type: 'image/svg+xml' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = selectedCountries.map(n => n.toLowerCase().replace(/\s+/g,'_')).join('_') + '.svg';
  a.click();
});

document.getElementById('copyPathBtn').addEventListener('click', () => {
  navigator.clipboard.writeText(currentSVG);
  document.getElementById('copyPathBtn').textContent = '✓ Kopiert';
  setTimeout(() => document.getElementById('copyPathBtn').textContent = 'Copy SVG', 2000);
});

// ─── Init ─────────────────────────────────────────────────────────────────────
applyMode(mode);
updateResolutionUI();
autoLoad();
renderComboList();
renderColorAssign();
