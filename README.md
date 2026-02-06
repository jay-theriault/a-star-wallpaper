# A* Desktop Background (for Lively Wallpaper)

A lightweight **HTML/Canvas** wallpaper that animates an A* search (open/closed sets + final path) over the **Greater Boston** bounding box. By default it routes on the cached OSM road graph, with a grid fallback.

This repo is designed to be loaded directly in **Lively Wallpaper (Windows)**.

---

## How to install in Lively (Windows)

### Option A — load the local `index.html` (simplest)
1. Clone or download this folder to your PC.
2. Open **Lively Wallpaper**.
3. **+ Add Wallpaper** → **Browse**.
4. Select:
   - `...\astar-lively\index.html`

Lively will treat it as a Web/HTML wallpaper.

### Option B — build a `dist/` zip (clean import)
1. In this repo folder, run:
   - `npm run build:dist`
2. Zip the `dist/` folder (or download the artifact from GitHub Actions).
3. In Lively: **+ Add Wallpaper** → **Browse** → select the zip.

### Option C — load via a local web server (more reliable for dev)
Some environments are stricter about loading ES modules from `file:///` URLs. If you see a blank screen, use a local server:

1. In this repo folder, start a server:
   - **Python**: `python -m http.server 8000`
   - or **Node**: `npx http-server -p 8000`
2. In Lively: **+ Add Wallpaper** → paste this URL:
   - `http://127.0.0.1:8000/index.html`

---

## Configuration (query params)

You can tweak runtime behavior by adding query-string parameters to the URL you load in Lively.

All params are **optional**. Out-of-range values are **clamped**; non-numeric/invalid values **fall back to defaults** (no errors).

### Supported params
- `mode`: **chill|debug** (preset bundle; explicit params still win)
- `sps` (steps per second): integer **[1, 120]** (default **20**)
- `maxStepsPerFrame`: int **[1, 500]** (default **60**)
- `zoom`: float **[0.5, 2.0]** (default **1.0**)
- `hud`: **0|1** (default **1**)
- `showOpenClosed`: **0|1** (default **1**)
- `showCurrent`: **0|1** (default **1**)
- `showPathDuringSearch`: **0|1** (default **0**)
- `showRoads`: **0|1** (default **1**)
- `graph`: **roads|grid** (default **roads**)
- `endHoldMs`: int **[0, 60000]** (default: whatever `main.js` ships with)
- `endAnimMs`: int **[0, 60000]** (default: whatever `main.js` ships with)
- `minStartEndMeters`: int **[0, 200000]** (default: whatever `main.js` ships with)

### Examples
1) Chill preset (slow pacing + minimal overlays):
- `index.html?mode=chill`

2) Faster search, zoomed in:
- `index.html?zoom=1.2&sps=45&maxStepsPerFrame=120`

3) Clean wallpaper mode (hide HUD + hide open/closed sets):
- `index.html?hud=0&showOpenClosed=0`

4) Show a faint "path hint" during the search (useful for debugging):
- `index.html?showPathDuringSearch=1&sps=25&zoom=1.1`

5) Force grid mode (fallback):
- `index.html?graph=grid`

Tip: press **R** to toggle the roads layer, and **?** to open the help overlay with current settings.

### Edit defaults
Open `main.js` and adjust `DEFAULT_CONFIG` (or other constants) to change the shipped defaults.

---

## Development

### Run locally
Because `index.html` imports ES modules (`type="module"`), the most consistent dev loop is a local server:

```bash
cd path/to/repo
python -m http.server 8000
# then open http://127.0.0.1:8000/index.html
```

### Files of interest
- `index.html` — page + canvas + HUD
- `main.js` — rendering + animation loop + configuration
- `astar.js` — A* implementation and helpers

### OSM roads data
The road layer prefers a compact JSON cache if present, then falls back to GeoJSON:
- `data/osm/roads.compact.json` (compact, faster to load)
- `data/osm/roads.geojson` (GeoJSON fallback)

A precomputed **road graph cache** is optional but recommended for faster startup:
- `data/osm/roadGraph.v1.json` (versioned graph cache)

If the graph cache exists, runtime loads it; otherwise it builds from road lines on the fly.

To refresh road files (dev step only), run:

```bash
# default GeoJSON (Overpass fetch)
node scripts/fetch-osm-roads.js

# compact format
node scripts/fetch-osm-roads.js --format=compact
```

To build the road graph cache:

```bash
node scripts/build-road-graph-cache.js
# Optional:
# --input=data/osm/roads.compact.json
# --output=data/osm/roadGraph.v1.json
# --snapMeters=3
# --quantizeDegrees=0.00005
```

---

## Notes / roadmap
- Current graph defaults to the **OSM road network** (cached). Use `graph=grid` to fall back to the prototype grid.
- Road network layer uses cached OSM data (see above).
