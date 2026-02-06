import { haversineMeters, makeAStarStepper, reconstructPath } from "./astar.js";

// --- Spec-driven constants (initial proposal; tweak later) ---
const BOUNDS = {
  north: 42.55,
  south: 42.20,
  west: -71.35,
  east: -70.85,
};

const THEME = {
  bg0: "#070a10",
  bg1: "#0b1020",
  grid: "rgba(255,255,255,0.035)",
  road: "rgba(210,225,255,0.055)",
  roadDash: "rgba(255,255,255,0.08)",
  osmRoad: "rgba(90,100,110,0.45)",

  // Tuned for legibility on dark background (open/closed/current are distinct).
  open: "#22d3ee", // cyan
  closed: "#fbbf24", // amber
  current: "#ffffff",

  pathCore: "rgba(70, 245, 255, 0.96)",
  pathGlow: "rgba(70, 245, 255, 0.42)",

  start: "#34d399",
  goal: "#fb7185",
};

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// --- Runtime configuration (query params) ---
//
// Supported query params (invalid values fall back to defaults):
//   - sps: integer [1, 120] (steps per second)
//   - zoom: float [0.5, 2.0]
//   - hud: 0|1
//   - endHoldMs: int [0, 60000]
//   - endAnimMs: int [0, 60000]
//   - minStartEndMeters: int [0, 200000]
//   - showOpenClosed: 0|1 (default 1)
//   - showCurrent: 0|1 (default 1)
//   - showPathDuringSearch: 0|1 (default 0)
//   - showRoads: 0|1 (default 1)
//   - maxStepsPerFrame: int [1, 500] (default 60)
//   - endpointMode: roads|random (default roads)
//   - showHud: 0|1 (alias for hud)

const DEFAULT_CONFIG = {
  stepsPerSecond: 20,
  maxStepsPerFrame: 60,

  // hold after finding the path
  endHoldMs: 1800,
  endAnimMs: 1200,

  // grid density (prototype)
  gridCols: 160,
  gridRows: 100,

  // visuals
  gridEvery: 8,
  pointSizePx: 3.0,
  pointSoftness: 0.9,
  roadMajorCount: 8,
  roadMinorCount: 14,
  roadCurviness: 0.35,
  noiseAlpha: 0.06,
  vignetteAlpha: 0.42,

  minStartEndMeters: 7000,
  discardIfPathLeavesBounds: true,
  zoom: 1.0,
  hud: 1,

  // viz toggles
  showOpenClosed: 1,
  showCurrent: 1,
  showPathDuringSearch: 0,
  showRoads: 1,
  endpointMode: "roads",
};

function parseRuntimeConfig(search) {
  const params = new URLSearchParams(search || "");

  const readInt = (name, def, lo, hi) => {
    const raw = params.get(name);
    if (raw == null) return def;
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n)) return def;
    return clamp(Math.trunc(n), lo, hi);
  };

  const readFloat = (name, def, lo, hi) => {
    const raw = params.get(name);
    if (raw == null) return def;
    const n = Number.parseFloat(raw);
    if (!Number.isFinite(n)) return def;
    return clamp(n, lo, hi);
  };

  const read01 = (name, def01) => {
    const raw = params.get(name);
    if (raw == null) return def01;
    if (raw === "0") return 0;
    if (raw === "1") return 1;
    return def01;
  };

  const readEnum = (name, def, allowed) => {
    const raw = params.get(name);
    if (raw == null) return def;
    return allowed.has(raw) ? raw : def;
  };

  const stepsPerSecond = readInt("sps", DEFAULT_CONFIG.stepsPerSecond, 1, 120);
  const maxStepsPerFrame = readInt("maxStepsPerFrame", DEFAULT_CONFIG.maxStepsPerFrame, 1, 500);

  const hud = read01("hud", read01("showHud", DEFAULT_CONFIG.hud));
  const endpointMode = readEnum("endpointMode", DEFAULT_CONFIG.endpointMode, new Set(["roads", "random"]));

  return {
    ...DEFAULT_CONFIG,
    stepsPerSecond,
    maxStepsPerFrame,
    // use a delay to drive the fixed-rate stepping loop
    stepDelayMs: 1000 / stepsPerSecond,
    zoom: readFloat("zoom", DEFAULT_CONFIG.zoom, 0.5, 2.0),
    hud,
    endpointMode,
    endHoldMs: readInt("endHoldMs", DEFAULT_CONFIG.endHoldMs, 0, 60000),
    endAnimMs: readInt("endAnimMs", DEFAULT_CONFIG.endAnimMs, 0, 60000),
    minStartEndMeters: readInt("minStartEndMeters", DEFAULT_CONFIG.minStartEndMeters, 0, 200000),

    showOpenClosed: read01("showOpenClosed", DEFAULT_CONFIG.showOpenClosed),
    showCurrent: read01("showCurrent", DEFAULT_CONFIG.showCurrent),
    showPathDuringSearch: read01("showPathDuringSearch", DEFAULT_CONFIG.showPathDuringSearch),
    showRoads: read01("showRoads", DEFAULT_CONFIG.showRoads),
  };
}

const CONFIG = parseRuntimeConfig(typeof window !== "undefined" ? window.location?.search : "");

// --- Endpoint sampling ---
export const ENDPOINT_SAMPLING_MAX_TRIES = 5000;

const MAX_RENDER_NODES_PER_SET = 3500;
const MAX_ROAD_SEGMENTS = 120000;
const ROAD_POINT_STRIDE = 2;
const MAX_ROAD_POINTS = 7000;

/**
 * Attempt to sample endpoints that satisfy `minMeters` for up to `maxTries`.
 * If not possible, returns the best-effort (max-distance) pair found.
 *
 * Pure/testable: pass in `randomKey`, `toLatLon`, and optionally `rng`.
 */
export function sampleEndpointPair({
  randomKey,
  toLatLon,
  minMeters,
  maxTries = ENDPOINT_SAMPLING_MAX_TRIES,
  rng = Math.random,
  distanceFn = haversineMeters,
}) {
  let best = { startKey: null, goalKey: null, distanceMeters: -Infinity, minDistanceMet: false, tries: 0 };

  for (let tries = 0; tries < maxTries; tries++) {
    const startKey = randomKey(rng);
    const goalKey = randomKey(rng);
    const sLL = toLatLon(startKey);
    const gLL = toLatLon(goalKey);
    const d = distanceFn(sLL, gLL);

    if (d > best.distanceMeters) best = { startKey, goalKey, distanceMeters: d, minDistanceMet: d >= minMeters, tries: tries + 1 };

    if (d >= minMeters) {
      return { startKey, goalKey, distanceMeters: d, minDistanceMet: true, tries: tries + 1 };
    }
  }

  return best;
}

// --- Roads + grid helpers (shared with tests) ---
function inBoundsLatLon(lat, lon, bounds) {
  return lat <= bounds.north && lat >= bounds.south && lon >= bounds.west && lon <= bounds.east;
}

function key(i, j) {
  return `${i},${j}`;
}
function parseKey(k) {
  const [i, j] = k.split(",").map((n) => parseInt(n, 10));
  return { i, j };
}

export function latLonToCellKey(lat, lon, bounds, cols = CONFIG.gridCols, rows = CONFIG.gridRows) {
  if (!inBoundsLatLon(lat, lon, bounds)) return null;
  const i = Math.floor(((lon - bounds.west) / (bounds.east - bounds.west)) * cols);
  const j = Math.floor(((bounds.north - lat) / (bounds.north - bounds.south)) * rows);
  if (i < 0 || j < 0 || i >= cols || j >= rows) return null;
  return key(i, j);
}

export function snapLatLonToRoadPoint(lat, lon, roadPoints) {
  if (!roadPoints || roadPoints.length === 0) return null;
  let best = null;
  let bestD = Infinity;
  for (const p of roadPoints) {
    const d = (p.lat - lat) * (p.lat - lat) + (p.lon - lon) * (p.lon - lon);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

function extractRoadLines(geojson) {
  const lines = [];
  if (!geojson || geojson.type !== "FeatureCollection" || !Array.isArray(geojson.features)) return lines;

  for (const feature of geojson.features) {
    const geom = feature?.geometry;
    if (!geom) continue;
    if (geom.type === "LineString" && Array.isArray(geom.coordinates)) {
      lines.push(geom.coordinates);
    } else if (geom.type === "MultiLineString" && Array.isArray(geom.coordinates)) {
      for (const line of geom.coordinates) {
        if (Array.isArray(line)) lines.push(line);
      }
    }
  }

  return lines;
}

export function buildRoadPointCacheFromGeojson(
  geojson,
  bounds,
  cols = CONFIG.gridCols,
  rows = CONFIG.gridRows,
  { stride = ROAD_POINT_STRIDE, maxPoints = MAX_ROAD_POINTS } = {}
) {
  const lines = extractRoadLines(geojson);
  const points = [];

  for (const line of lines) {
    if (!line || line.length < 2) continue;
    for (let i = 0; i < line.length; i += Math.max(1, stride)) {
      const [lon, lat] = line[i];
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      if (!inBoundsLatLon(lat, lon, bounds)) continue;
      points.push({ lat, lon });
    }
  }

  if (points.length > maxPoints) {
    const step = Math.ceil(points.length / maxPoints);
    const slim = [];
    for (let i = 0; i < points.length; i += step) slim.push(points[i]);
    points.length = 0;
    points.push(...slim);
  }

  const keySet = new Set();
  for (const p of points) {
    const k = latLonToCellKey(p.lat, p.lon, bounds, cols, rows);
    if (k) keySet.add(k);
  }

  return { points, keys: Array.from(keySet) };
}

// --- Canvas setup ---
if (typeof window !== "undefined") {
const canvas = document.getElementById("c");
const hud = document.getElementById("hud");
const ctx = canvas.getContext("2d", { alpha: false });

const ROADS_URL = "./data/osm/roads.geojson";
const roadsLayer = document.createElement("canvas");
const roadsCtx = roadsLayer.getContext("2d", { alpha: true });
let roadsLines = [];
let roadsReady = false;
let roadsPointCache = { points: [], keys: [] };
let showRoads = CONFIG.showRoads;

if (hud && CONFIG.hud === 0) {
  hud.style.display = "none";
}

// Background layers cached into offscreen canvases (rebuilt on resize).
const bg = document.createElement("canvas");
const bgCtx = bg.getContext("2d", { alpha: false });
const noise = document.createElement("canvas");
const noiseCtx = noise.getContext("2d");

let dpr = 1;

function resize() {
  dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  canvas.style.width = window.innerWidth + "px";
  canvas.style.height = window.innerHeight + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Build background at CSS-pixel resolution (we draw it 1:1 each frame).
  bg.width = Math.max(1, Math.floor(window.innerWidth));
  bg.height = Math.max(1, Math.floor(window.innerHeight));
  buildBackground(bgCtx, bg.width, bg.height);

  buildNoise(noiseCtx);

  roadsLayer.width = Math.max(1, Math.floor(window.innerWidth));
  roadsLayer.height = Math.max(1, Math.floor(window.innerHeight));
  if (roadsReady) buildRoadsLayer(roadsCtx, roadsLayer.width, roadsLayer.height);
}
window.addEventListener("resize", resize);
resize();

window.addEventListener("keydown", (e) => {
  if (e.key?.toLowerCase() === "r") {
    showRoads = showRoads ? 0 : 1;
  }
});

loadRoads();

// --- Coordinate helpers ---
function bboxCenter(bounds) {
  return {
    lat: (bounds.north + bounds.south) / 2,
    lon: (bounds.east + bounds.west) / 2,
  };
}

function applyZoom(bounds, zoom) {
  const c = bboxCenter(bounds);
  const latSpan = (bounds.north - bounds.south) / zoom;
  const lonSpan = (bounds.east - bounds.west) / zoom;
  return {
    north: c.lat + latSpan / 2,
    south: c.lat - latSpan / 2,
    west: c.lon - lonSpan / 2,
    east: c.lon + lonSpan / 2,
  };
}

function project(lat, lon, simBounds, w, h) {
  const c = bboxCenter(simBounds);
  const cosLat = Math.cos((c.lat * Math.PI) / 180);

  // Aspect-ratio-aware render framing:
  // Treat 1° lon as cos(lat) "narrower" than 1° lat (equirectangular scale).
  // Expand the axis that would otherwise stretch so the map letterboxes instead.
  const latSpan = simBounds.north - simBounds.south;
  const lonSpan = simBounds.east - simBounds.west;
  const simAspect = (lonSpan * cosLat) / latSpan;
  const viewAspect = w / h;

  let renderLatSpan = latSpan;
  let renderLonSpan = lonSpan;
  if (viewAspect > simAspect) {
    // viewport is wider → expand longitude span
    renderLonSpan = (latSpan * viewAspect) / cosLat;
  } else {
    // viewport is taller → expand latitude span
    renderLatSpan = (lonSpan * cosLat) / viewAspect;
  }

  const renderBounds = {
    north: c.lat + renderLatSpan / 2,
    south: c.lat - renderLatSpan / 2,
    west: c.lon - renderLonSpan / 2,
    east: c.lon + renderLonSpan / 2,
  };

  const x = (lon - renderBounds.west) / (renderBounds.east - renderBounds.west);
  const y = (renderBounds.north - lat) / (renderBounds.north - renderBounds.south);
  return { x: x * w, y: y * h };
}

// --- Grid graph (prototype) ---
// We map grid cells to lat/lon centers inside the bounds.
function cellLatLon(i, j, bounds) {
  const lat = bounds.north - (j + 0.5) * ((bounds.north - bounds.south) / CONFIG.gridRows);
  const lon = bounds.west + (i + 0.5) * ((bounds.east - bounds.west) / CONFIG.gridCols);
  return { lat, lon };
}

function neighborsOf(k) {
  const { i, j } = parseKey(k);
  const out = [];
  for (const [di, dj] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ]) {
    const ni = i + di;
    const nj = j + dj;
    if (ni < 0 || nj < 0 || ni >= CONFIG.gridCols || nj >= CONFIG.gridRows) continue;
    out.push(key(ni, nj));
  }
  return out;
}

function cost(aKey, bKey, bounds) {
  const a = cellLatLon(...Object.values(parseKey(aKey)), bounds);
  const b = cellLatLon(...Object.values(parseKey(bKey)), bounds);
  return haversineMeters(a, b);
}

function heuristic(aKey, goalKey, bounds) {
  const a = cellLatLon(...Object.values(parseKey(aKey)), bounds);
  const g = cellLatLon(...Object.values(parseKey(goalKey)), bounds);
  return haversineMeters(a, g);
}

function randomCell(bounds, rng = Math.random) {
  // uniform in grid for prototype
  const i = Math.floor(rng() * CONFIG.gridCols);
  const j = Math.floor(rng() * CONFIG.gridRows);
  const ll = cellLatLon(i, j, bounds);
  if (!inBoundsLatLon(ll.lat, ll.lon, bounds)) return randomCell(bounds, rng);
  return key(i, j);
}

function randomRoadKey(rng = Math.random) {
  if (!roadsPointCache?.keys?.length) return null;
  return roadsPointCache.keys[Math.floor(rng() * roadsPointCache.keys.length)];
}

function pathLeavesBounds(pathKeys, bounds) {
  for (const k of pathKeys) {
    const { i, j } = parseKey(k);
    const ll = cellLatLon(i, j, bounds);
    if (!inBoundsLatLon(ll.lat, ll.lon, bounds)) return true;
  }
  return false;
}

function pathLengthMeters(pathKeys, bounds) {
  if (!pathKeys || pathKeys.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < pathKeys.length; i++) {
    const a = cellLatLon(...Object.values(parseKey(pathKeys[i - 1])), bounds);
    const b = cellLatLon(...Object.values(parseKey(pathKeys[i])), bounds);
    total += haversineMeters(a, b);
  }
  return total;
}

// --- Simulation state ---
// simBounds affects sampling + A* costs/heuristics only.
let simBounds = applyZoom(BOUNDS, CONFIG.zoom);
let startKey = null;
let goalKey = null;
let stepper = null;
let currentStep = null;
let finalPath = null;
let phase = "search"; // search | end-hold | end-anim
let phaseT = 0;
let lastStepAt = 0;
let cycle = 0;
let endpointSamplingBestEffort = false;
let endpointSamplingDistanceMeters = 0;
let endpointSamplingTries = 0;
let lastPathLengthMeters = 0;

function pickEndpoints() {
  simBounds = applyZoom(BOUNDS, CONFIG.zoom);

  const useRoadKeys = CONFIG.endpointMode === "roads" && roadsPointCache.keys.length > 0;

  const randomKey = (rng) => {
    if (useRoadKeys) return randomRoadKey(rng);

    let k = randomCell(simBounds, rng);
    if (CONFIG.endpointMode === "random" && roadsPointCache.points.length > 0) {
      const ll = cellLatLon(...Object.values(parseKey(k)), simBounds);
      const snapped = snapLatLonToRoadPoint(ll.lat, ll.lon, roadsPointCache.points);
      if (snapped) {
        const snappedKey = latLonToCellKey(snapped.lat, snapped.lon, simBounds);
        if (snappedKey) k = snappedKey;
      }
    }

    return k;
  };

  const sampled = sampleEndpointPair({
    maxTries: ENDPOINT_SAMPLING_MAX_TRIES,
    minMeters: CONFIG.minStartEndMeters,
    randomKey,
    toLatLon: (k) => cellLatLon(...Object.values(parseKey(k)), simBounds),
  });

  startKey = sampled.startKey;
  goalKey = sampled.goalKey;
  endpointSamplingBestEffort = !sampled.minDistanceMet;
  endpointSamplingDistanceMeters = sampled.distanceMeters;
  endpointSamplingTries = sampled.tries;

  stepper = makeAStarStepper({
    startKey,
    goalKey,
    neighbors: neighborsOf,
    cost: (a, b) => cost(a, b, simBounds),
    heuristic: (a, g2) => heuristic(a, g2, simBounds),
  });

  currentStep = null;
  finalPath = null;
  phase = "search";
  phaseT = 0;
  lastStepAt = performance.now();
  cycle += 1;
}

pickEndpoints();

// --- Rendering ---
function buildNoise(nctx) {
  // Small tileable noise texture (repeated across screen).
  const s = 128;
  noise.width = s;
  noise.height = s;
  const img = nctx.createImageData(s, s);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = (Math.random() * 255) | 0;
    img.data[i + 0] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  nctx.putImageData(img, 0, 0);
}

function buildBackground(bctx, w, h) {
  // Base gradient.
  const g = bctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, THEME.bg1);
  g.addColorStop(1, THEME.bg0);
  bctx.fillStyle = g;
  bctx.fillRect(0, 0, w, h);

  // A few soft bloom blobs (gives depth behind the grid/roads).
  bctx.save();
  bctx.globalCompositeOperation = "screen";
  for (let i = 0; i < 5; i++) {
    const x = (0.15 + 0.7 * Math.random()) * w;
    const y = (0.15 + 0.7 * Math.random()) * h;
    const r = (0.22 + 0.25 * Math.random()) * Math.min(w, h);
    const rg = bctx.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, "rgba(56,189,248,0.07)");
    rg.addColorStop(1, "rgba(56,189,248,0.0)");
    bctx.fillStyle = rg;
    bctx.beginPath();
    bctx.arc(x, y, r, 0, Math.PI * 2);
    bctx.fill();
  }
  bctx.restore();


  // Subtle grid on top.
  bctx.save();
  bctx.strokeStyle = THEME.grid;
  bctx.lineWidth = 1;
  const stepX = w / CONFIG.gridCols;
  const stepY = h / CONFIG.gridRows;
  const every = CONFIG.gridEvery;
  for (let i = 0; i <= CONFIG.gridCols; i += every) {
    const x = i * stepX;
    bctx.beginPath();
    bctx.moveTo(x, 0);
    bctx.lineTo(x, h);
    bctx.stroke();
  }
  for (let j = 0; j <= CONFIG.gridRows; j += every) {
    const y = j * stepY;
    bctx.beginPath();
    bctx.moveTo(0, y);
    bctx.lineTo(w, y);
    bctx.stroke();
  }
  bctx.restore();

  // Vignette.
  bctx.save();
  const vg = bctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.2, w / 2, h / 2, Math.max(w, h) * 0.75);
  vg.addColorStop(0, "rgba(0,0,0,0.0)");
  vg.addColorStop(1, `rgba(0,0,0,${CONFIG.vignetteAlpha})`);
  bctx.fillStyle = vg;
  bctx.fillRect(0, 0, w, h);
  bctx.restore();
}

// --- OSM roads layer ---
async function loadRoads() {
  try {
    const res = await fetch(ROADS_URL);
    if (!res.ok) throw new Error(`roads fetch failed: ${res.status}`);
    const geojson = await res.json();
    roadsLines = extractRoadLines(geojson);
    roadsReady = roadsLines.length > 0;
    if (roadsReady) {
      const cacheBounds = applyZoom(BOUNDS, CONFIG.zoom);
      roadsPointCache = buildRoadPointCacheFromGeojson(geojson, cacheBounds);
      buildRoadsLayer(roadsCtx, roadsLayer.width, roadsLayer.height);
      if (CONFIG.endpointMode === "roads" && roadsPointCache.keys.length > 0) {
        pickEndpoints();
      }
    }
  } catch (err) {
    console.warn("Failed to load roads layer", err);
  }
}

function buildRoadsLayer(rctx, w, h) {
  if (!roadsLines.length) return;
  rctx.clearRect(0, 0, w, h);
  rctx.save();
  rctx.strokeStyle = THEME.osmRoad;
  rctx.lineWidth = 1.0;
  rctx.lineCap = "round";
  rctx.lineJoin = "round";

  let segments = 0;

  for (const line of roadsLines) {
    if (!line || line.length < 2) continue;
    rctx.beginPath();
    for (let i = 0; i < line.length; i++) {
      const [lon, lat] = line[i];
      const p = project(lat, lon, simBounds, w, h);
      if (i === 0) rctx.moveTo(p.x, p.y);
      else rctx.lineTo(p.x, p.y);
      segments += 1;
      if (segments >= MAX_ROAD_SEGMENTS) break;
    }
    rctx.stroke();
    if (segments >= MAX_ROAD_SEGMENTS) break;
  }

  rctx.restore();
}

function cellToXY(k, w, h) {
  const { i, j } = parseKey(k);
  const ll = cellLatLon(i, j, simBounds);
  return project(ll.lat, ll.lon, simBounds, w, h);
}

function norm01(v, lo, hi) {
  if (!Number.isFinite(v)) return 0;
  if (hi <= lo) return 0;
  return clamp((v - lo) / (hi - lo), 0, 1);
}

let scoreRange = { fLo: 0, fHi: 1, gLo: 0, gHi: 1 };
function computeScoreRange(step) {
  if (!step?.fScore || !step?.gScore) return;
  let fLo = Infinity,
    fHi = -Infinity,
    gLo = Infinity,
    gHi = -Infinity;

  const visit = (k) => {
    const f = step.fScore.get(k);
    const g = step.gScore.get(k);
    if (Number.isFinite(f)) {
      fLo = Math.min(fLo, f);
      fHi = Math.max(fHi, f);
    }
    if (Number.isFinite(g)) {
      gLo = Math.min(gLo, g);
      gHi = Math.max(gHi, g);
    }
  };

  for (const k of step.openSet) visit(k);
  for (const k of step.closedSet) visit(k);

  if (!Number.isFinite(fLo)) fLo = 0;
  if (!Number.isFinite(fHi)) fHi = 1;
  if (!Number.isFinite(gLo)) gLo = 0;
  if (!Number.isFinite(gHi)) gHi = 1;
  scoreRange = { fLo, fHi, gLo, gHi };
}

function drawNodeDot(p, r, color, a) {
  ctx.save();
  ctx.globalAlpha = a;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawSet(step, keys, w, h, color, baseAlpha) {
  // Draw with "soft" additive style for better readability.
  ctx.save();
  ctx.globalCompositeOperation = "lighter";

  const total = keys?.size ?? keys?.length ?? 0;
  const stride = total > MAX_RENDER_NODES_PER_SET ? Math.ceil(total / MAX_RENDER_NODES_PER_SET) : 1;
  let idx = 0;
  let drawn = 0;

  for (const k of keys) {
    if (stride > 1 && idx % stride !== 0) {
      idx += 1;
      continue;
    }
    idx += 1;
    drawn += 1;
    if (drawn > MAX_RENDER_NODES_PER_SET) break;

    const p = cellToXY(k, w, h);
    const f = step?.fScore?.get(k);
    const t = 1 - norm01(f, scoreRange.fLo, scoreRange.fHi); // "better" nodes glow more

    const a = baseAlpha * (0.45 + 0.75 * t);
    const r = CONFIG.pointSizePx * (0.7 + 0.9 * t);

    // Outer softness.
    ctx.globalAlpha = a * (0.40 + CONFIG.pointSoftness * 0.35);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 1.7, 0, Math.PI * 2);
    ctx.fill();

    // Core.
    ctx.globalAlpha = a;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function strokePath(keys, w, h, count) {
  const n = Math.min(keys.length, Math.max(2, count));
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const p = cellToXY(keys[i], w, h);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
}

function drawPath(keys, w, h, t01, glowPulse01 = 0) {
  if (!keys || keys.length < 2) return;

  const n = Math.max(2, Math.floor(keys.length * clamp(t01, 0, 1)));

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Big glow.
  ctx.shadowColor = THEME.pathGlow;
  ctx.shadowBlur = 22 + 18 * glowPulse01;
  ctx.strokeStyle = THEME.pathGlow;
  ctx.lineWidth = 11 + 6 * glowPulse01;
  strokePath(keys, w, h, n);
  ctx.stroke();

  // Mid glow.
  ctx.shadowBlur = 12 + 10 * glowPulse01;
  ctx.strokeStyle = "rgba(34, 211, 238, 0.20)";
  ctx.lineWidth = 7 + 3 * glowPulse01;
  strokePath(keys, w, h, n);
  ctx.stroke();

  // Core.
  ctx.shadowBlur = 0;
  ctx.strokeStyle = THEME.pathCore;
  ctx.lineWidth = 2.75;
  strokePath(keys, w, h, n);
  ctx.stroke();

  ctx.restore();
}

function drawMarker(k, w, h, fill, ring) {
  const p = cellToXY(k, w, h);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";

  // Glow ring.
  ctx.strokeStyle = ring;
  ctx.lineWidth = 2;
  ctx.shadowColor = ring;
  ctx.shadowBlur = 14;
  ctx.beginPath();
  ctx.arc(p.x, p.y, 8.5, 0, Math.PI * 2);
  ctx.stroke();

  // Core.
  ctx.shadowBlur = 0;
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(p.x, p.y, 5.2, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawCurrent(k, w, h, now) {
  if (!k) return;
  const p = cellToXY(k, w, h);
  const t = (now % 900) / 900;
  const pulse = 0.5 - 0.5 * Math.cos(t * Math.PI * 2);

  // Make current *unambiguous* even when open/closed sets get dense.
  // Use a high-contrast "target" marker with an outline pass.
  ctx.save();

  // Outline (source-over) to separate from dense additive dots.
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = "rgba(0,0,0,0.65)";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(p.x, p.y, 11 + 8 * pulse, 0, Math.PI * 2);
  ctx.stroke();

  ctx.globalCompositeOperation = "lighter";

  // Outer pulse ring.
  ctx.globalAlpha = 0.30 + 0.34 * pulse;
  ctx.strokeStyle = "rgba(255,255,255,0.95)";
  ctx.lineWidth = 2;
  ctx.shadowColor = "rgba(255,255,255,0.65)";
  ctx.shadowBlur = 18;
  ctx.beginPath();
  ctx.arc(p.x, p.y, 11 + 8 * pulse, 0, Math.PI * 2);
  ctx.stroke();

  // Crosshair (helps when ring overlaps lots of points).
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 0.60;
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(p.x - 9, p.y);
  ctx.lineTo(p.x + 9, p.y);
  ctx.moveTo(p.x, p.y - 9);
  ctx.lineTo(p.x, p.y + 9);
  ctx.stroke();

  // Core dot.
  ctx.globalAlpha = 0.95;
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.beginPath();
  ctx.arc(p.x, p.y, 3.6, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function render(now) {
  const w = window.innerWidth;
  const h = window.innerHeight;

  // Static background.
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  ctx.drawImage(bg, 0, 0, w, h);

  if (showRoads && roadsReady) {
    ctx.drawImage(roadsLayer, 0, 0, w, h);
  }

  // Film grain.
  ctx.save();
  ctx.globalAlpha = CONFIG.noiseAlpha;
  ctx.globalCompositeOperation = "overlay";
  ctx.fillStyle = ctx.createPattern(noise, "repeat");
  ctx.fillRect(0, 0, w, h);
  ctx.restore();

  if (currentStep && currentStep.status === "searching") {
    if (CONFIG.showOpenClosed !== 0) {
      drawSet(currentStep, currentStep.closedSet, w, h, THEME.closed, 0.08);
      drawSet(currentStep, currentStep.openSet, w, h, THEME.open, 0.11);
    }

    if (CONFIG.showPathDuringSearch !== 0) {
      // Draw the current "cameFrom" chain as a faint hint.
      // (Not the final path — just the best-known predecessor chain to `current`.)
      const partial = reconstructPath(currentStep.cameFrom, currentStep.current);
      ctx.save();
      ctx.globalAlpha = 0.20;
      drawPath(partial, w, h, 1.0, 0.0);
      ctx.restore();
    }

    if (CONFIG.showCurrent !== 0) {
      drawCurrent(currentStep.current, w, h, now);
    }
  }

  if (finalPath) {
    if (phase === "end-hold") {
      drawPath(finalPath, w, h, 1.0, 0.1);
    } else if (phase === "end-anim") {
      const t01 = clamp(phaseT / CONFIG.endAnimMs, 0, 1);
      const pulse = 0.5 - 0.5 * Math.cos(t01 * Math.PI * 2);
      // Reveal + highlight head.
      drawPath(finalPath, w, h, t01, pulse);
      // subtle full path hint behind
      ctx.save();
      ctx.globalAlpha = 0.22;
      drawPath(finalPath, w, h, 1.0, 0.0);
      ctx.restore();
    }
  }

  drawMarker(startKey, w, h, THEME.start, "rgba(52,211,153,0.55)");
  drawMarker(goalKey, w, h, THEME.goal, "rgba(251,113,133,0.55)");

  const openN = currentStep?.openSet?.size ?? 0;
  const closedN = currentStep?.closedSet?.size ?? 0;
  const steps = currentStep?.steps ?? 0;

  const samplingLine =
    `sample: <b>${Math.round(endpointSamplingDistanceMeters)}</b>m <span class="dim">·</span> tries: <b>${endpointSamplingTries}</b>` +
    (endpointSamplingBestEffort ? ` <span class="dim">·</span> <b style="color:#fb7185">min-distance not met; best-effort</b>` : "");

  const statsLine =
    `<span class="key">path</span>: <b>${Math.round(lastPathLengthMeters)}</b>m` +
    ` <span class="dim">·</span> <span class="key">roads pts</span>: <b>${roadsPointCache.points.length}</b>` +
    ` <span class="dim">·</span> <span class="key">endpointMode</span>: <b>${CONFIG.endpointMode}</b>`;

  if (hud && CONFIG.hud !== 0) {
    const openClosedLine =
      CONFIG.showOpenClosed !== 0
        ? `<span class="key">open</span>: <b>${openN}</b> <span class="dim">·</span> <span class="key">closed</span>: <b>${closedN}</b>`
        : `<span class="key">open/closed</span>: <b class="dim">hidden</b>`;

    const vizLine =
      `<span class="dim">viz</span>:` +
      ` openClosed=<b>${CONFIG.showOpenClosed ? 1 : 0}</b>` +
      ` current=<b>${CONFIG.showCurrent ? 1 : 0}</b>` +
      ` pathDuring=<b>${CONFIG.showPathDuringSearch ? 1 : 0}</b>` +
      ` roads=<b>${showRoads ? 1 : 0}</b>`;

    hud.innerHTML =
      `<b>A*</b> Greater Boston <span class="dim">· prototype grid · cycle ${cycle}</span><br/>` +
      `phase: <b>${phase}</b> <span class="dim">·</span> steps: <b>${steps}</b><br/>` +
      `${samplingLine}<br/>` +
      `${statsLine}<br/>` +
      `${openClosedLine}<br/>` +
      `${vizLine}<br/>` +
      `<span class="dim">cfg</span>: sps=<b>${CONFIG.stepsPerSecond}</b> maxStepsPerFrame=<b>${CONFIG.maxStepsPerFrame}</b> zoom=<b>${CONFIG.zoom.toFixed(2)}</b><br/>` +
      `<span class="dim">cfg</span>: minDist=<b>${CONFIG.minStartEndMeters}</b>m`;
  }

  requestAnimationFrame(tick);
}

function tick(now) {
  // step A* at fixed rate (but allow multiple steps per frame when frames are slow)
  if (phase === "search") {
    let stepsThisFrame = 0;

    while (now - lastStepAt >= CONFIG.stepDelayMs && stepsThisFrame < CONFIG.maxStepsPerFrame) {
      lastStepAt += CONFIG.stepDelayMs;
      stepsThisFrame += 1;

      const r = stepper.step();
      currentStep = r;
      if (!r.done && r.status === "searching") computeScoreRange(r);

      if (r.done) {
        if (r.status === "found") {
          // optional bounds enforcement
          if (CONFIG.discardIfPathLeavesBounds && pathLeavesBounds(r.path, simBounds)) {
            pickEndpoints();
            requestAnimationFrame(render);
            return;
          }

          finalPath = r.path;
          lastPathLengthMeters = pathLengthMeters(r.path, simBounds);
          phase = "end-hold";
          phaseT = 0;
        } else {
          // no path — resample
          pickEndpoints();
        }
        break;
      }
    }

    // If the tab was backgrounded, avoid an enormous catch-up loop.
    if (now - lastStepAt > CONFIG.stepDelayMs * CONFIG.maxStepsPerFrame) {
      lastStepAt = now;
    }
  } else if (phase === "end-hold") {
    phaseT += 16.67;
    if (phaseT >= CONFIG.endHoldMs) {
      phase = "end-anim";
      phaseT = 0;
    }
  } else if (phase === "end-anim") {
    phaseT += 16.67;
    if (phaseT >= CONFIG.endAnimMs) {
      pickEndpoints();
    }
  }

  render(now);
}

requestAnimationFrame(tick);
}
