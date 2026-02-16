# Fix: Screen Flickering Under Compositors

## Problem

The wallpaper exhibited screen flickering/tearing when running under Lively Wallpaper (and potentially other compositors like DWM). This was most noticeable during the search phase when many elements update each frame.

## Root Causes

### 1. No double-buffering

The canvas rendered directly to the visible element. During each frame, the rendering pipeline performed multiple sequential draw operations (clear, draw background, draw terrain, draw roads, draw explored edges, draw path, draw endpoints, draw HUD). The compositor could sample the canvas mid-frame, showing a partially-rendered state.

### 2. Multiple per-frame canvas blits for static content

Each frame composited 3 separate offscreen canvases for static content:

```js
ctx.drawImage(bg, 0, 0, w, h); // background gradient
ctx.drawImage(landLayer, 0, 0, w, h); // terrain/land
ctx.drawImage(roadsLayer, 0, 0, w, h); // roads
```

These layers don't change between frames (only on resize or toggle), but were being composited every frame — 3 large canvas blits that increased the window of time for the compositor to catch a partial frame.

## Fix (commit 8f378e3)

### Double-buffering

All rendering now goes to an offscreen `frame` canvas. At the end of each frame, a single `drawImage` call blits the completed frame to the visible canvas:

```js
// Setup
const screenCtx = canvas.getContext('2d', { alpha: false });
const frame = document.createElement('canvas');
const ctx = frame.getContext('2d', { alpha: false });

// End of render()
screenCtx.drawImage(frame, 0, 0, w, h);
```

The rest of the code continues to use `ctx` unchanged — it just now points to the offscreen frame instead of the visible canvas.

### Static background merging

Background gradient, terrain, and roads are pre-composited into a single `staticBg` offscreen canvas. This canvas is only rebuilt when needed (resize, toggle roads/terrain, data load). Per-frame rendering drops from 3 large canvas blits to 1:

```js
// Before: 3 blits per frame
ctx.drawImage(bg, 0, 0, w, h);
ctx.drawImage(landLayer, 0, 0, w, h);
ctx.drawImage(roadsLayer, 0, 0, w, h);

// After: 1 blit per frame
ctx.drawImage(staticBg, 0, 0, w, h);
```

The `rebuildStaticBg()` function is called from:

- `resize()` — on viewport/DPR change
- Keyboard toggles (`r` for roads, `t` for terrain)
- UI controls (terrain checkbox, roads detail slider)
- Lively property listener (showRoads, showTerrain, roadsDetail)
- Data load callbacks (when terrain or roads finish loading)

## Relevant Code Locations

| Location                    | Purpose                                                   |
| --------------------------- | --------------------------------------------------------- |
| `main.js:screenCtx`         | Context for the visible canvas (only used for final blit) |
| `main.js:frame` / `ctx`     | Offscreen frame canvas where all rendering happens        |
| `main.js:staticBg`          | Pre-composited background + terrain + roads               |
| `main.js:rebuildStaticBg()` | Rebuilds static background when layers change             |
| `main.js:render()`          | Ends with `screenCtx.drawImage(frame, ...)` to blit frame |
