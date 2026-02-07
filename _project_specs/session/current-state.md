<!--
CHECKPOINT RULES (from session-management.md):
- Quick update: After any todo completion
- Full checkpoint: After ~20 tool calls or decisions
- Archive: End of session or major feature complete

After each task, ask: Decision made? >10 tool calls? Feature done?
-->

# Current Session State

_Last updated: 2026-02-06_

## Active Task

Pre-baked coastline mask — all implementation complete, ready for commit.

## Current Status

- **Phase**: complete
- **Progress**: All 6 implementation steps done + documentation
- **Branch**: `feature/prebaked-coastline-mask` in `claude-worktree-2`
- **Blocking Issues**: None

## What Was Done This Session

1. Extracted `getRenderBounds()` from `project()`/`makeProjector()` in `coordinates.js`
2. Added `MASK_BOUNDS` to `config.js` (BOUNDS + 0.2° margin)
3. Installed `pngjs` dev dependency
4. Created `scripts/build-coastline-mask.js` with Bresenham rasterization + greedy endpoint chaining + BFS flood-fill
5. Generated `data/osm/coastline-mask.png` (4096x3413, 150KB, ~15% ocean)
6. Rewrote `loadLand()` and `buildLandLayer()` in `main.js` to use pre-baked mask with `destination-out` compositing
7. Removed ~75 lines of runtime `buildCoastlineMask()` + coastline loading code
8. Defaulted `showTerrain: 1` in DEFAULT_CONFIG and all presets
9. Added `build:coastline-mask` npm script

## Key Findings

- OSM coastline.geojson contains 799 separate LineStrings with gaps up to 0.065° (~300px at 4096px)
- Simple Bresenham 1px lines leave gaps that BFS flood leaks through
- Greedy end→start chaining solves this (each segment end connects to nearest unused start)
- Edge sealing (top/bottom/west barriers) prevents BFS leaking around coastline extent
- 15.1% ocean ratio is correct for Greater Boston area at MASK_BOUNDS scale

## Files Modified

| File                            | Status    | Notes                                                                       |
| ------------------------------- | --------- | --------------------------------------------------------------------------- |
| coordinates.js                  | Modified  | Extracted `getRenderBounds()`, refactored `project()` and `makeProjector()` |
| config.js                       | Modified  | Added `MASK_BOUNDS`, changed `showTerrain` default to 1, updated presets    |
| main.js                         | Modified  | Rewrote loadLand/buildLandLayer, removed buildCoastlineMask + dead code     |
| package.json                    | Modified  | Added `pngjs` dev dep, `build:coastline-mask` script                        |
| scripts/build-coastline-mask.js | Created   | Build script for coastline mask PNG                                         |
| data/osm/coastline-mask.png     | Generated | Pre-baked mask (water=opaque, land=transparent)                             |

## Next Steps

1. [ ] Visual verification: open index.html in browser with `?showTerrain=1`
2. [ ] Test different zoom levels and aspect ratios
3. [ ] Commit all changes
4. [ ] Create PR

## Resume Instructions

To continue this work:

1. `cd claude-worktree-2` (branch: `feature/prebaked-coastline-mask`)
2. All code changes are complete and tested (22/22 tests pass, lint clean)
3. Ready for visual verification and commit
