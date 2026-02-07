<!--
UPDATE WHEN:
- Adding new entry points or key files
- Introducing new patterns
- Discovering non-obvious behavior

Helps quickly navigate the codebase when resuming work.
-->

# Code Landmarks

Quick reference to important parts of the codebase.

## Entry Points

| Location   | Purpose                                  |
| ---------- | ---------------------------------------- |
| index.html | Main HTML page with canvas + HUD         |
| main.js    | Rendering, animation loop, configuration |

## Core Business Logic

| Location      | Purpose                              |
| ------------- | ------------------------------------ |
| astar.js      | A\* algorithm implementation         |
| road-graph.js | Road graph construction and querying |
| roads-data.js | OSM road data loading                |
| endPhase.js   | End-of-search phase handling         |
| guardrails.js | Runtime guardrails/validation        |

## Configuration

| Location                 | Purpose                               |
| ------------------------ | ------------------------------------- |
| main.js (DEFAULT_CONFIG) | Runtime defaults, query param parsing |

## Data

| Location  | Purpose                                            |
| --------- | -------------------------------------------------- |
| data/osm/ | OSM road data (GeoJSON, compact JSON, graph cache) |

## Build Scripts

| Location                           | Purpose                                   |
| ---------------------------------- | ----------------------------------------- |
| scripts/build-dist.js              | Package for Lively Wallpaper distribution |
| scripts/build-road-graph-cache.js  | Precompute road graph cache               |
| scripts/build-coastline-mask.js    | Generate pre-baked coastline mask PNG      |
| scripts/fetch-osm-coastline.js     | Fetch coastline data from OSM             |
| scripts/fetch-osm-land.js          | Fetch land polygon data from OSM          |

## Testing

| Location | Purpose                            |
| -------- | ---------------------------------- |
| tests/   | Node.js built-in test runner tests |

## Gotchas & Non-Obvious Behavior

| Location   | Issue                  | Notes                                                                                            |
| ---------- | ---------------------- | ------------------------------------------------------------------------------------------------ |
| index.html | ES modules             | Must serve via HTTP, not file://                                                                 |
| main.js    | Query params           | All config is URL query-param driven                                                             |
| coastline  | 799 disconnected segs  | OSM coastline.geojson has 799 separate LineStrings with gaps up to 300px; greedy chaining needed |
| mask       | destination-out        | Coastline mask uses white=water, transparent=land; composited with destination-out in Canvas     |
