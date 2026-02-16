# Fix: Blotchy/Disconnected Explored Edges

## Problem

The explored edges layer (gold segments showing A\* search progress) rendered as disconnected, blotchy short dashes instead of smooth road-following lines.

![Screenshot showing blotchy explored edges](../screenshots/explored-edges-blotchy.png)

## Root Cause

The road graph uses **edge contraction** to simplify the network. Chains of degree-2 nodes (straight road segments between intersections) are collapsed into single edges. The removed intermediate node positions are stored in `edge.via` arrays.

`renderExploredEdgesToLayer()` in `main.js` was drawing straight lines between contracted graph nodes (intersections) without using the `via` intermediate geometry:

```js
// Before fix — straight line between distant intersections
const p1 = cellToXY(k, w, h);
const p2 = cellToXY(pred, w, h);
exploredCtx.moveTo(p1.x, p1.y);
exploredCtx.lineTo(p2.x, p2.y);
```

Since intersections can be far apart, each edge appeared as a short straight dash jumping across the map rather than following the road curve. The `strokePath()` function (used for the final cyan path) already handled this correctly via `getViaGeometry()`.

## Fix (commit 4106490)

Added via geometry lookup to explored edges rendering, matching the pattern already used by `strokePath()`:

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

If explored edges still look blotchy after this fix, check these other contributing factors:

### Stride sampling drops edges at high node counts

`renderExploredEdgesToLayer()` caps rendering at `MAX_RENDER_NODES_PER_SET` (3500). When `closedSet.size` exceeds this, it skips edges using a stride, creating gaps. To test: increase `MAX_RENDER_NODES_PER_SET` at the top of `main.js` (line 38) — try 10000. This trades rendering performance for visual completeness.

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
| `main.js:renderExploredEdgesToLayer()` | Draws explored edges to offscreen canvas               |
| `main.js:getViaGeometry()`             | Looks up intermediate road points for contracted edges |
| `main.js:strokePath()`                 | Draws final path (already had via geometry)            |
| `road-graph.js:contractGraph()`        | Edge contraction that produces `via` arrays            |
| `config.js:THEME.explored`             | Explored edges color/alpha                             |
| `main.js:MAX_RENDER_NODES_PER_SET`     | Rendering budget cap (line 38)                         |
