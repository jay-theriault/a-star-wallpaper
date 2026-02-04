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

## Quick configuration (runtime query params)

You can tweak behavior either by editing constants in `main.js` or by using query-string parameters.

### Query-string parameters
Append these to the URL you load in Lively:

- `bounds` — optional bounds preset
  - Currently supported: `boston`
  - Example: `index.html?bounds=boston`
- `zoom` — zoom into the bounding box (>1 zooms in)
  - Valid range: clamped to `[0.25, 6]`
  - Example: `index.html?zoom=1.25`
- `stepsPerSecond` — target A* steps per second
  - Valid range: clamped to `[1, 240]`
  - Example: `index.html?stepsPerSecond=30`
- `endHoldMs` — how long to hold the completed path before the reveal animation
  - Example: `index.html?endHoldMs=2500`
- `endAnimMs` — how long to run the end reveal animation
  - Example: `index.html?endAnimMs=1600`
- `minStartEndMeters` — minimum start↔goal distance for sampling
  - Example: `index.html?minStartEndMeters=9000`
- `hud` — show/hide the debug HUD (`hud=0` hides)
  - Example: `index.html?hud=0`

Examples:
- `index.html?stepsPerSecond=35&zoom=1.2`
- `http://127.0.0.1:8000/index.html?stepsPerSecond=25&hud=0`

Notes:
- All values are validated/clamped; invalid values fall back to defaults.
- If endpoint sampling can’t satisfy `minStartEndMeters` after N tries, a warning is shown in the HUD and it proceeds with the best pair found.

### Edit constants
Open `main.js` and adjust the `CONFIG` object (e.g. `gridCols`, `gridRows`, styling). Runtime values above are applied first.

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
- Displayed bounds are framed to the **screen aspect ratio** while keeping a fixed center (Boston bbox center).
- Road-network / OSM integration is a later step.
