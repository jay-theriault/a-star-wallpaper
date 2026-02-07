<!--
LOG DECISIONS WHEN:
- Choosing between architectural approaches
- Selecting libraries or tools
- Making security-related choices
- Deviating from standard patterns

This is append-only. Never delete entries.
-->

# Decision Log

Track key architectural and implementation decisions.

## Format

```
## [YYYY-MM-DD] Decision Title

**Decision**: What was decided
**Context**: Why this decision was needed
**Options Considered**: What alternatives existed
**Choice**: Which option was chosen
**Reasoning**: Why this choice was made
**Trade-offs**: What we gave up
**References**: Related code/docs
```

---

## [2026-02-06] Guardrails Tooling Selection

**Decision**: Use ESLint + Prettier + Husky + lint-staged + commitlint
**Context**: Project had no linting, formatting, or commit validation
**Options Considered**: ESLint only, ESLint+Prettier, full guardrails suite
**Choice**: Full suite with conventional commits
**Reasoning**: Consistent code quality and commit history without overhead (all automated via hooks)
**Trade-offs**: Additional devDependencies, but zero runtime impact
**References**: package.json, eslint.config.js, .prettierrc, commitlint.config.js

## [2026-02-06] Pre-baked Coastline Mask Strategy

**Decision**: Move coastline mask generation from runtime to build time using a pre-baked PNG
**Context**: Runtime flood-fill was fragile (4+ iterations of fixes for harbor channels, seed points, resolution, alpha thresholds). Terrain was defaulted OFF.
**Options Considered**: (1) Keep runtime flood-fill with more fixes, (2) Pre-bake mask at build time, (3) Use vector polygon clipping
**Choice**: Pre-baked PNG mask with `destination-out` Canvas compositing
**Reasoning**: Eliminates all runtime fragility. 69-150KB PNG loads fast. `destination-out` elegantly punches water holes through land tint.
**Trade-offs**: Requires build step (`npm run build:coastline-mask`). Mask is resolution-fixed at 4096px (sufficient for wallpaper use). Some coastal detail (harbor mouths, island separation) is lost in the mask but handled by water polygons.
**References**: scripts/build-coastline-mask.js, main.js (buildLandLayer), config.js (MASK_BOUNDS)

## [2026-02-06] Greedy Endpoint Chaining for Coastline Segments

**Decision**: Connect 799 OSM coastline LineString segments using greedy nearest-end→start matching
**Context**: OSM coastline.geojson contains 799 separate LineStrings with gaps up to 0.065° (~300px at 4096px mask). Simple 1px Bresenham lines leave gaps where BFS flood leaks through.
**Options Considered**: (1) Thicker lines only, (2) Per-row sealing, (3) Fixed threshold endpoint matching, (4) Greedy chaining
**Choice**: Greedy chaining (each segment end connects to nearest unused segment start)
**Reasoning**: Handles arbitrary gap sizes without over-sealing. Per-row sealing was too aggressive (filled islands as land). Fixed threshold missed gaps > threshold.
**Trade-offs**: Some island-mainland connections are bridged (treated as land), but water polygons from land.geojson render harbor/bay details separately.
**References**: scripts/build-coastline-mask.js
