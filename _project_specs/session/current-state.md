<!--
CHECKPOINT RULES (from session-management.md):
- Quick update: After any todo completion
- Full checkpoint: After ~20 tool calls or decisions
- Archive: End of session or major feature complete

After each task, ask: Decision made? >10 tool calls? Feature done?
-->

# Current Session State

_Last updated: 2026-02-06 (session 2)_

## Active Task

Pre-baked coastline mask — rendering fixes applied, ready for visual verification.

## Current Status

- **Phase**: fixed, awaiting visual verification
- **Progress**: Build script + rotation mismatch fixed, mask regenerated
- **Branch**: `feature/prebaked-coastline-mask` in `claude-worktree-2`
- **Blocking Issues**: None

## What Was Done This Session

### Session 1 (original implementation)
1-9. Full implementation (see decisions.md for details)

### Session 2 (rendering fixes)
1. **Fixed build script chaining artifacts**: Separated chaining barriers into a dedicated `chainBarrier` grid. Chaining lines still block BFS (contain ocean flood) but are NOT included in output PNG. Only BFS-confirmed ocean pixels appear as water.
2. **Fixed rotation mismatch in buildLandLayer**: Applied canvas rotation (`translate + rotate + translate`) when drawing the mask with `destination-out`, matching `makeProjector`'s screen-space rotation around canvas center.
3. **Regenerated mask**: 4096x3413, 81KB, 14.0% ocean (no chaining artifacts).
4. **Cleaned up main repo**: Stashed `feature/road-graph-contraction` WIP changes, switched back to `main` branch.

## Key Findings

- Chaining lines must go into a separate barrier grid — including them in PNG output creates visible straight lines across water
- Mask must be drawn with the same canvas rotation as makeProjector uses (translate to center, rotate, translate back)
- 14% ocean ratio confirmed correct for Greater Boston

## Files Modified (session 2)

| File | Status | Notes |
|------|--------|-------|
| scripts/build-coastline-mask.js | Fixed | Separate chainBarrier grid, only ocean pixels in output |
| main.js | Fixed | Canvas rotation applied when drawing mask with destination-out |
| data/osm/coastline-mask.png | Regenerated | 81KB, 14% ocean, no chaining artifacts |

## Next Steps

1. [ ] Visual verification: open worktree-2 index.html in browser
2. [ ] Amend commit or create new commit with fixes
3. [ ] Update PR

## Resume Instructions

To continue this work:
1. `cd claude-worktree-2` (branch: `feature/prebaked-coastline-mask`)
2. Tests pass (22/22), lint clean
3. Main repo is on `main` branch, clean state
