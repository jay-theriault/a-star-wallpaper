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

## Configuration (query params)

You can tweak runtime behavior by adding query-string parameters to the URL you load in Lively.

All params are **optional**. Out-of-range values are **clamped**; non-numeric/invalid values **fall back to defaults** (no errors).

### Supported params
- `sps` (steps per second): integer **[1, 120]** (default **20**)
- `zoom`: float **[0.5, 2.0]** (default **1.0**)
- `hud`: **0|1** (default **1**)
- `endHoldMs`: int **[0, 60000]** (default: whatever `main.js` ships with)
- `endAnimMs`: int **[0, 60000]** (default: whatever `main.js` ships with)
- `minStartEndMeters`: int **[0, 200000]** (default: whatever `main.js` ships with)

### Examples
1) Faster search, zoomed in:
- `index.html?zoom=1.2&sps=30`

2) Hide the HUD (good for “clean” wallpaper mode):
- `index.html?zoom=1.2&sps=30&hud=0`

3) Longer end hold + minimum start/end distance:
- `index.html?endHoldMs=5000&endAnimMs=1500&minStartEndMeters=12000`

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

---

## Notes / roadmap
- Current graph is a **regular grid** (prototype).
- Road-network / OSM integration is a later step.
