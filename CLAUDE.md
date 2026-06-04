# Country SVG Tool — CLAUDE.md

## Was das ist
Electron-Desktop-App zum Generieren sauberer SVG-Länderkarten aus Natural Earth Shapefiles.
Gedacht für Design- und Kartografie-Arbeit: Länder auswählen, einfärben, als SVG exportieren —
mit korrekter kartografischer Projektion statt simplem Plate Carrée.

## Architektur
Gleiche Architektur wie LIPA BILLING (`c:\Tools\Billing 26`) und health-dashboard:
- `nodeIntegration: true`, `contextIsolation: false` — kein Preload, kein contextBridge
- **main.js** ist minimal (~25 Zeilen): BrowserWindow + 3 Window-Control-IPC + 1 Dialog-IPC
- **renderer.js** hat vollen Node.js-Zugriff: `require('fs')`, `require('path')`, `require('shpjs')`
- Alle App-Logik läuft in renderer.js

## Projektstruktur
```
Map Projektion SVG/
├── main.js          # Electron Main Process
├── index.html       # HTML-Shell + gesamtes CSS
├── renderer.js      # Gesamte App-Logik
├── package.json
├── CLAUDE.md
├── data/                          # Natural Earth Shapefiles (ZIPs)
│   ├── ne_10m_admin_0_countries.zip
│   ├── ne_10m_lakes.zip
│   ├── ne_10m_rivers_lake_centerlines.zip
│   ├── ne_50m_admin_0_countries.zip
│   ├── ne_50m_lakes.zip
│   └── ne_50m_rivers_lake_centerlines.zip
└── prototypes/                    # Alte HTML-Versionen (nicht auf GitHub)
    ├── country-svg-tool(7).html
    ├── country-svg-tool(17).html  ← beste Basis für Electron-Version
    └── country-svg-tool(26).html
```

## Tech Stack
- **Electron** v29 — Desktop-Shell
- **shpjs** v3.6.3 — parst Shapefile-ZIPs zu GeoJSON (Node.js + Browser kompatibel)
- **d3-geo** v2.x — Projektionen + SVG-Pfad-Generierung für World Mode (CJS-kompatibel)
- **d3-geo-polygon** v1.x — `geoCahillKeyes()` Projektion (CJS-kompatibel via UMD bundle)
- **Vanilla HTML/CSS/JS** — kein Framework, kein Bundler

## Zwei Render-Pfade (wichtig!)
Die App hat zwei grundlegend verschiedene Render-Pfade:

### Region Mode — Pure JS
Projektions-Mathe selbst implementiert in `projectFeatures()`, zentriert auf Bounding Box
der Auswahl. Gibt ViewBox = exakte Bounding Box der gewählten Länder aus.
- LAEA, AEQD, Mercator
- Kein d3-Bezug

### World Mode — d3-geo
Nutzt `d3-geo` + `d3-geo-polygon` für alle Projektionen. d3 übernimmt automatisch:
- Polygon-Clipping an Projektionsgrenzen (kritisch bei Cahill-Keyes!)
- Sphere-Hintergrund (Ozean)
- `geoPath(projection)(feature)` → SVG path string direkt
Feste Canvas-Größe: 2000×1000px. Alle Länder werden gerendert —
ausgewählte in ihren Farben, Rest neutral (`#3a3a3a`).

Projektionen World Mode:
- **laea** — `d3.geoAzimuthalEqualArea()`
- **aeqd** — `d3.geoAzimuthalEquidistant()`
- **merc** — `d3.geoMercator()`
- **naturalearth** — `d3.geoNaturalEarth1()`
- **cahill-keyes** — `geoCahillKeyes()` aus d3-geo-polygon

## IPC-Kanäle (main ↔ renderer)
| Kanal | Richtung | Beschreibung |
|---|---|---|
| `win:minimize` | renderer→main | Fenster minimieren |
| `win:maximize` | renderer→main | Fenster maximieren/wiederherstellen |
| `win:close`    | renderer→main | Fenster schließen |
| `dialog:openFiles` | renderer→main (invoke) | Nativer Datei-Öffnen-Dialog, gibt `{ canceled, filePaths }` zurück |

Kein IPC für Daten — shpjs läuft direkt im Renderer via `require`.

## Datei-Loading
Drei Pfade für Shapefile-Input:
1. **Auto-load** (primär): beim Start liest `fs.readFileSync` die ZIPs aus `path.join(__dirname, 'data')`
2. **IPC Dialog** (Fallback): `dialog:openFiles` öffnet nativen Datei-Picker
3. **Drag & Drop** (Fallback): Browser File API → `file.arrayBuffer()`

Node Buffer → ArrayBuffer Konvertierung: `buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)`

## localStorage-Schema
| Key | Inhalt |
|---|---|
| `ne_resolution` | `'10m'` oder `'50m'` — zuletzt gewählte Auflösung |
| `app_mode` | `'region'` oder `'world'` — zuletzt gewählter Modus |
| `combos` | `JSON` — Array von `{ id: number, countries: string[] }` |
| `colors` | `JSON` — Map von Ländername → Hex-Farbe, z.B. `{ "Namibia": "#E8A838" }` |

## SVG-Output
### Region Mode
- ViewBox = exakte Bounding Box der gewählten Länder
- Nur ausgewählte Länder im SVG

### World Mode
- ViewBox = `0 0 2000 1000` (fest)
- Alle Länder im SVG — ausgewählte farbig, Rest `#3a3a3a`
- Sphere-Hintergrund (Ozean) als erstes `<path>`
- Jedes Land als `<path id="country_name">` — einzeln selektierbar in Illustrator/Affinity
- `fill-rule="evenodd"` für korrekte Loch-Darstellung

## Design
- Dark Theme, CSS Custom Properties in `index.html` (`:root`)
- Fonts: **DM Mono** (UI) + **Fraunces** (Titel) — Google Fonts
- Frameless Window (`frame: false`), Drag-Region via `-webkit-app-region: drag` im Titlebar
- Custom Window Controls (─ □ ✕) oben rechts, `-webkit-app-region: no-drag`
- Farbpalette: 20 Farben in `PALETTE` Array in renderer.js
- Mode Toggle (Region / World) ganz oben im linken Panel

## GitHub
`https://github.com/weltenlaeufersteve-create/Map-Projections.git`

## Entwicklung
```
npm install        # einmalig — lädt Electron, shpjs, d3-geo, d3-geo-polygon
npm start          # aus eigenem PowerShell-Terminal — nicht Claude Code Shell
```

## Aktueller Funktionsumfang
| Feature | Status |
|---|---|
| Auto-load NE-Shapefiles aus App-Ordner | ✅ |
| 10m / 50m Auflösungs-Toggle | ✅ |
| Länder-Autocomplete | ✅ |
| Kombis speichern/laden (persistent) | ✅ |
| Farb-Zuweisung pro Land (persistent) | ✅ |
| Region Mode: LAEA / AEQD / Mercator | ✅ |
| World Mode: LAEA / AEQD / Mercator / Natural Earth / Cahill-Keyes | ✅ |
| Inseln-Filter (% des größten Polygons) | ✅ |
| Seen + Flüsse als optionale Layer | ✅ |
| SVG Preview, Download, Copy | ✅ |
| Manueller Datei-Picker (IPC Dialog) | ✅ |
| Drag & Drop Fallback | ✅ |

## Geplante Features

### Globe View (3D rotierbar)
Orthografische Projektion mit Mouse-Drag-Rotation. Eine andere Claude-Instanz hat dazu
bereits etwas entwickelt — erst sichten bevor implementiert wird.
Wahrscheinlich Canvas/WebGL-basiert statt reinem SVG; SVG-Export als Snapshot.
