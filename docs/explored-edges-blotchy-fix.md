# Fix: Blotchy/Disconnected Explored Edges

## Problem

The explored edges layer (gold segments showing A\* search progress) rendered as disconnected, blotchy short dashes instead of smooth road-following lines.

![Screenshot showing blotchy explored edges](../screenshots/explored-edges-blotchy.png)

## Root Causes

Two issues combined to produce the blotchy appearance:

### 1. Stride sampling dropped most edges (primary cause)

`renderExploredEdgesToLayer()` cleared and redrew the entire offscreen canvas every frame, capped at `MAX_RENDER_NODES_PER_SET` (3500) via stride sampling. On large searches with 10,000+ explored nodes, this silently dropped 60-70% of edges. Since the Set iterates in insertion order (temporal, not spatial), the dropped edges created random spatial holes across the explored area.

### 2. Missing via geometry for contracted edges

The road graph uses **edge contraction** — chains of degree-2 nodes between intersections are collapsed into single edges, with removed node positions stored in `edge.via` arrays. The explored edges renderer drew straight lines between contracted graph nodes without using this intermediate geometry:

```js
// Before — straight line between distant intersections
const p1 = cellToXY(k, w, h);
const p2 = cellToXY(pred, w, h);
exploredCtx.moveTo(p1.x, p1.y);
exploredCtx.lineTo(p2.x, p2.y);
```

Since intersections can be far apart, each edge appeared as a short straight dash jumping across the map rather than following the road curve.

## Fix

### Incremental rendering (commit 7553b13) — eliminated the budget cap

Instead of clearing and redrawing all edges every frame, the offscreen canvas now persists and only new edges are appended each frame. This removes the stride sampling entirely — every explored edge is drawn, with minimal per-frame cost since only a handful of new edges are added each step.

Key change: a `exploredDrawnCount` counter tracks how many closedSet entries have been rendered. Each frame skips already-drawn entries and only draws new ones. The counter resets on simulation reset and viewport resize.

### Via geometry (commit 4106490) — edges follow road curves

Added `getViaGeometry()` lookup to the explored edges renderer, matching the pattern already used by `strokePath()` for the final path:

```js
const p1 = cellToXY(pred, w, h);
exploredCtx.moveTo(p1.x, p1.y);

if (useVia) {
  const via = getViaGeometry(pred, k);
  if (via) {
    for (const [lon, lat] of via) {
      const vp = proj(lat, lon);
      exploredCtx.lineTo(vp.x, vp.y);
    }
  }
}

const p2 = cellToXY(k, w, h);
exploredCtx.lineTo(p2.x, p2.y);
```

## If the Problem Persists

### Via geometry lookup direction mismatch

`getViaGeometry(fromId, toId)` searches `roadGraph.adjacency[fromId]` for an edge with `e.to === toId`. On one-way streets, the via geometry may only exist in one direction. If A\* traversed the edge in the opposite direction from how it was stored, the lookup returns `null` and falls back to a straight line. A more robust fix would check both directions:

```js
function getViaGeometry(fromId, toId) {
  if (!isRoadGraphActive()) return null;
  // Try forward direction
  const fwd = roadGraph.adjacency[fromId];
  if (fwd) {
    for (const e of fwd) {
      if (e.to === toId && e.via) return e.via;
    }
  }
  // Try reverse direction (via points need to be reversed)
  const rev = roadGraph.adjacency[toId];
  if (rev) {
    for (const e of rev) {
      if (e.to === fromId && e.via) return [...e.via].reverse();
    }
  }
  return null;
}
```

### Alpha blending over explored layer

`THEME.explored` uses 55% alpha (`rgba(251, 191, 36, 0.55)`). Where segments overlap (e.g. at intersections), they appear brighter than isolated segments, creating visual unevenness. Increasing the alpha (e.g. to 0.8) or using `globalCompositeOperation = 'lighten'` instead of `'source-over'` would make the brightness more uniform.

## Relevant Code Locations

| Location                               | Purpose                                                |
| -------------------------------------- | ------------------------------------------------------ |
| `main.js:renderExploredEdgesToLayer()` | Incrementally draws explored edges to offscreen canvas |
| `main.js:exploredDrawnCount`           | Tracks how many closedSet entries have been rendered   |
| `main.js:getViaGeometry()`             | Looks up intermediate road points for contracted edges |
| `main.js:strokePath()`                 | Draws final path (already had via geometry)            |
| `road-graph.js:contractGraph()`        | Edge contraction that produces `via` arrays            |
| `config.js:THEME.explored`             | Explored edges color/alpha                             |
