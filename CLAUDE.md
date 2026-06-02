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
- **Vanilla HTML/CSS/JS** — kein Framework, kein Bundler
- Projektions-Mathe in purem JS (kein proj4 o.ä.) — Lambert AEA, Azimuthal Equidistant, Mercator

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
1. **Auto-load** (primär): beim Start liest `fs.readFileSync` die ZIPs aus `__dirname`
2. **IPC Dialog** (Fallback): `dialog:openFiles` öffnet nativen Datei-Picker
3. **Drag & Drop** (Fallback): Browser File API → `file.arrayBuffer()`

Node Buffer → ArrayBuffer Konvertierung: `buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)`

## localStorage-Schema
| Key | Inhalt |
|---|---|
| `ne_resolution` | `'10m'` oder `'50m'` — zuletzt gewählte Auflösung |
| `combos` | `JSON` — Array von `{ id: number, countries: string[] }` |
| `colors` | `JSON` — Map von Ländername → Hex-Farbe, z.B. `{ "Namibia": "#E8A838" }` |

## Projektionen (renderer.js)
Alle drei Projektionen sind als pure JS implementiert, zentriert auf den Mittelpunkt
der ausgewählten Länder (Bounding Box Center):
- **laea** — Lambert Azimuthal Equal Area (Standard, flächentreu)
- **aeqd** — Azimuthal Equidistant (abstands-korrekt vom Zentrum)
- **merc** — Lokale Mercator (winkeltreu, vertraut)

## SVG-Output
- ViewBox = exakte Bounding Box der Länder (ohne fixen Canvas)
- Jedes Land als `<path id="country_name">` — einzeln selektierbar in Illustrator/Affinity
- Optionale `<g id="lakes">` und `<g id="rivers">` Layer
- `fill-rule="evenodd"` für korrekte Loch-Darstellung (z.B. Seen innerhalb von Ländern)

## Design
- Dark Theme, CSS Custom Properties in `index.html` (`:root`)
- Fonts: **DM Mono** (UI) + **Fraunces** (Titel) — Google Fonts
- Frameless Window (`frame: false`), Drag-Region via `-webkit-app-region: drag` im Titlebar
- Custom Window Controls (─ □ ✕) oben rechts, `-webkit-app-region: no-drag`
- Farbpalette: 20 Farben in `PALETTE` Array in renderer.js

## GitHub
`https://github.com/weltenlaeufersteve-create/Map-Projections.git`

## Entwicklung
```
npm install        # einmalig
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
| Projektionen: LAEA / AEQD / Mercator | ✅ |
| Inseln-Filter (% des größten Polygons) | ✅ |
| Seen + Flüsse als optionale Layer | ✅ |
| SVG Preview, Download, Copy | ✅ |
| Manueller Datei-Picker (IPC Dialog) | ✅ |
| Drag & Drop Fallback | ✅ |

## Geplante Features

### World Mode + Cahill-Keyes Projektion
Zwei Modi im gleichen App-Fenster — Toggle oben im Panel:

**Region Mode** (aktuell): Zoomt auf ausgewählte Länder, LAEA/AEQD/Mercator.

**World Mode** (geplant): Zeigt die ganze Welt, ausgewählte Länder hervorgehoben in ihren
Farben, Rest neutral (z.B. `#3a3a3a`). Länderauswahl + Farbzuweisung bleibt identisch.
Projektionen für World Mode:
- **Cahill-Keyes** (Butterfly/Oktaeder) — Hauptziel, Projektions-Mathe bereits gelöst in
  `c:\Tools\Cahill Keyes Projection\` → portieren
- Ggf. Robinson oder Natural Earth Proj. als weitere World-Optionen

Implementierungshinweis: Größte Herausforderung bei CK sind Polygone die Oktanten-Grenzen
kreuzen (Russland, USA, Kanada) — diese müssen geclipt werden. Die bestehenden CK-HTML-Dateien
lösen das bereits. Unausgewählte Länder trotzdem als `<path>` im SVG ausgeben (neutral color)
damit sie in Illustrator/Affinity einzeln selektierbar bleiben.
