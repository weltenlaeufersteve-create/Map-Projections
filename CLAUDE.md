# Country SVG Tool — CLAUDE.md

## What is it
Electron desktop app for generating clean SVG country maps from Natural Earth shapefiles.
Built for cartographic & editorial work: select countries, assign colours, export as SVG —
with proper map projections instead of simple Plate Carrée.

## Architecture
Same as LIPA BILLING (`c:\Tools\Billing 26`) and health-dashboard:
- `nodeIntegration: true`, `contextIsolation: false` — no Preload, no contextBridge
- **main.js** is minimal (~30 lines): BrowserWindow + 3 Window-Control IPC + 1 Dialog IPC
- **renderer.js** has full Node.js access: `require('fs')`, `require('path')`, `require('shpjs')`
- All app logic runs in renderer.js

## Project Structure
```
Map Projektion SVG/
├── main.js          # Electron Main Process
├── index.html       # HTML + full CSS
├── renderer.js      # Complete app logic
├── package.json
├── CLAUDE.md
├── data/                          # Natural Earth shapefiles + bundled data
│   ├── ne_10m_admin_0_countries.zip
│   ├── ne_10m_lakes.zip
│   ├── ne_10m_rivers_lake_centerlines.zip
│   ├── ne_50m_admin_0_countries.zip
│   ├── ne_50m_lakes.zip
│   ├── ne_50m_rivers_lake_centerlines.zip
│   └── migration-routes.json      # Out of Africa routes (bundled)
└── prototypes/                    # Old HTML versions (gitignored)
```

## Tech Stack
- **Electron** v29 — Desktop shell
- **shpjs** v3.6.3 — parses Shapefile ZIPs to GeoJSON (Node.js + browser compatible)
- **d3-geo** v2.x — projections + SVG path generation for World Mode (CJS compatible)
- **d3-geo-polygon** v1.x — `geoCahillKeyes()` projection (CJS compatible via UMD bundle)
- **Vanilla HTML/CSS/JS** — no framework, no bundler

## Two Render Paths (important!)
The app has two fundamentally different render paths:

### Region Mode — Pure JavaScript
Projection math implemented in `projectFeatures()`, centred on bounding box of selection.
Returns ViewBox = exact bounding box of chosen countries.
**Projections:** LAEA, AEQD, Mercator
**Note:** No d3 involvement, pure custom maths

### World Mode — d3-geo
Uses `d3-geo` + `d3-geo-polygon` for all projections. d3 handles automatically:
- Polygon clipping at projection boundaries (critical for Cahill-Keyes!)
- Sphere background (ocean)
- `geoPath(projection)(feature)` → SVG path string directly

Fixed canvas size: 2000×1000px. All countries rendered — selected in their colours, rest neutral (`#3a3a3a`).

**Projections:**
- **equirectangular** — simple Lon/Lat grid
- **naturalearth** — Natural Earth compromise projection
- **cahill-keyes** — Cahill-Keyes butterfly/octahedral (d3-geo-polygon)

## IPC Channels (main ↔ renderer)
| Channel | Direction | Description |
|---|---|---|
| `win:minimize` | renderer→main | Minimise window |
| `win:maximize` | renderer→main | Maximise/restore window |
| `win:close` | renderer→main | Close window |
| `dialog:openFiles` | renderer→main (invoke) | Native file picker dialog; returns `{ canceled, filePaths }` |

No IPC for data — shpjs runs directly in renderer via `require`.

## File Loading
Three paths for shapefile input:
1. **Auto-load** (primary): on startup, `fs.readFileSync` reads ZIPs from `path.join(__dirname, 'data')`
2. **IPC Dialog** (fallback): `dialog:openFiles` opens native file picker
3. **Drag & Drop** (fallback): Browser File API → `file.arrayBuffer()`

Node Buffer → ArrayBuffer conversion: `buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)`

## localStorage Schema
| Key | Contents |
|---|---|
| `ne_resolution` | `'10m'` or `'50m'` — last selected resolution |
| `app_mode` | `'region'` or `'world'` — last selected mode |
| `combos` | `JSON` — array of `{ id: number, countries: string[] }` |
| `colors` | `JSON` — map of country name → hex colour, e.g. `{ "Namibia": "#E8A838" }` |

## SVG Output
### Region Mode
- ViewBox = exact bounding box of selected countries
- Only selected countries in SVG
- Layer order: ocean (if any) → graticule (optional, coming) → countries → water (lakes/rivers)

### World Mode
- ViewBox = `0 0 2000 1000` (fixed)
- All countries rendered — selected in their colours, rest neutral (`#3a3a3a`)
- Layer order: ocean → graticule → reference lines (equator/tropics/polar circles) → countries → water (lakes/rivers) → migration routes (optional)
- Each country as `<path id="country_name">` — individually selectable in Illustrator/Affinity
- `fill-rule="evenodd"` for correct hole rendering

## SVG Named Groups
Migration routes layer uses named SVG groups for easy selection in design tools:
- `migration-routes` — route line segments (solid + dashed)
- `migration-stops` — stop markers (circles, sized by importance)
- `migration-labels` — place name labels

## UI Layout
**Left panel (scrollable, ~380px):**
- **Sticky header:** Mode toggle (⊞ Region | ⊕ World) full width
- **Sections 01–05:**
  - **01 Data Layers** — Countries (10m/50m toggle) + Lakes & Rivers (manual + auto-load)
  - **02 Country Selection** — Autocomplete input + selected tags + saved combos
  - **03 Colours** — Country colour assignment + stroke width/colour + island filter (region mode only)
  - **04 Grid & Background** — Ocean colour + graticule + reference lines (world mode only)
  - **05 Overlays** — Migration Routes toggle + place labels + placeholders for Country/Marine Labels

**Right panel (preview + toolbar):**
- **Preview toolbar:** Selected countries label + projection pills (region or world) on right
- **Preview canvas:** SVG rendered live
- **Download bar:** Generate button (left) + SVG info centre + Copy/Download buttons (right)

## Design
- Dark theme, CSS Custom Properties in `index.html` (`:root`)
- Fonts: **DM Mono** (UI) + **Fraunces** (title) — Google Fonts
- Frameless window (`frame: false`), drag region via `-webkit-app-region: drag` in titlebar
- Custom window controls (─ □ ✕) top right, `-webkit-app-region: no-drag`
- Colour palette: 20 colours in `PALETTE` array in renderer.js
- All UI text in British English

## Development
```bash
npm install        # one-time — installs Electron, shpjs, d3-geo, d3-geo-polygon
npm start          # from native PowerShell — not Claude Code shell
```

## GitHub
`https://github.com/weltenlaeufersteve-create/Map-Projections.git`

## Notes for Future Work
- Projection pills on preview toolbar respond to clicks and trigger SVG generation
- Migration data bundled as JSON in `data/migration-routes.json` — sources documented
- Region/World mode auto-switches projections (e.g., entering World with LAEA selected → switches to Natural Earth)
- Layer visibility toggled via `.world-only` and `.region-only` CSS classes
- All user selections (resolution, combos, colours, mode) persisted to localStorage

## Current Features
| Feature | Status |
|---|---|
| Auto-load NE shapefiles from app folder | ✅ |
| 10m / 50m resolution toggle | ✅ |
| Country autocomplete | ✅ |
| Save/load combos (persistent) | ✅ |
| Colour assignment per country (persistent) | ✅ |
| **Region Mode:** LAEA / AEQD / Mercator | ✅ |
| **World Mode:** Equirectangular / Natural Earth / Cahill-Keyes | ✅ |
| Island filter (% of largest polygon) | ✅ |
| Lakes + Rivers optional layers | ✅ |
| Out of Africa migration routes | ✅ |
| SVG preview, download, copy to clipboard | ✅ |
| Manual file picker (IPC dialog) | ✅ |
| Drag & drop fallback | ✅ |
| World Mode reference lines: equator, tropics ±23.5°, polar circles ±66.5° | ✅ |
| Graticule 15° grid (world mode) | ✅ |

## Planned Features
- **Country labels** — country names at centroids (placeholder in UI)
- **Marine labels** — ocean/sea names (placeholder in UI)
- **Zoom & pan preview** — interactive preview for detail checking
- **Background rectangle** — optional solid background in SVG
- **Batch export** — export multiple saved combos at once
