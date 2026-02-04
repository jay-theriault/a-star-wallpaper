# A* Desktop Background (for Lively Wallpaper)

A lightweight **HTML/Canvas** wallpaper that animates an A* search (open/closed sets + final path) over a prototype grid mapped to the **Greater Boston** bounding box.

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

### Option B — load via a local web server (more reliable for dev)
Some environments are stricter about loading ES modules from `file:///` URLs. If you see a blank screen, use a local server:

1. In this repo folder, start a server:
   - **Python**: `python -m http.server 8000`
   - or **Node**: `npx http-server -p 8000`
2. In Lively: **+ Add Wallpaper** → paste this URL:
   - `http://127.0.0.1:8000/index.html`

---

## Quick configuration (speed, zoom, HUD)

You can tweak behavior either by editing constants in `main.js` or by using query-string parameters.

### Query-string parameters
Append these to the URL you load in Lively:

- `sps` — steps per second (approx)
  - Example: `index.html?sps=30`
- `stepDelayMs` — delay between A* steps (overrides `sps`)
  - Example: `index.html?stepDelayMs=25`
- `zoom` — zoom into the Boston bounding box (>1 zooms in)
  - Example: `index.html?zoom=1.25`
- `hud` — show/hide the debug HUD (`hud=0` hides)
  - Example: `index.html?hud=0`

Examples:
- `index.html?sps=35&zoom=1.2`
- `http://127.0.0.1:8000/index.html?sps=25&hud=0`

### Edit constants
Open `main.js` and adjust the `CONFIG` object (e.g. `stepDelayMs`, `zoom`, `gridCols`, `gridRows`).

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

---

## Notes / roadmap
- Current graph is a **regular grid** (prototype).
- Road-network / OSM integration is a later step.
