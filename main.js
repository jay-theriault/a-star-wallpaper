import { haversineMeters, makeAStarStepper } from "./astar.js";

// --- Spec-driven constants (initial proposal; tweak later) ---
const BOUNDS = {
  north: 42.55,
  south: 42.20,
  west: -71.35,
  east: -70.85,
};

const CONFIG = {
  // target ~20 steps/sec
  stepDelayMs: 50,
  // hold after finding the path
  endHoldMs: 1800,
  endAnimMs: 1200,
  // grid density (prototype)
  gridCols: 160,
  gridRows: 100,
  minStartEndMeters: 7000,
  discardIfPathLeavesBounds: true,
  zoom: 1.0,
  showHud: true,
};

// Allow simple runtime configuration via query string.
// Examples:
//   ?sps=30        -> ~30 A* steps/sec
//   ?stepDelayMs=33
//   ?zoom=1.2
//   ?hud=0
{
  const qs = new URLSearchParams(globalThis.location?.search ?? "");

  const sps = Number(qs.get("sps"));
  if (Number.isFinite(sps) && sps > 0) CONFIG.stepDelayMs = Math.round(1000 / sps);

  const stepDelayMs = Number(qs.get("stepDelayMs"));
  if (Number.isFinite(stepDelayMs) && stepDelayMs >= 0) CONFIG.stepDelayMs = stepDelayMs;

  const zoom = Number(qs.get("zoom"));
  if (Number.isFinite(zoom) && zoom > 0) CONFIG.zoom = zoom;

  const hud = qs.get("hud");
  if (hud === "0" || hud === "false") CONFIG.showHud = false;
}

// --- Canvas setup ---
const canvas = document.getElementById("c");
const hud = document.getElementById("hud");
const ctx = canvas.getContext("2d");

function resize() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  canvas.style.width = window.innerWidth + "px";
  canvas.style.height = window.innerHeight + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener("resize", resize);
resize();

// --- Coordinate helpers ---
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

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

function project(lat, lon, bounds, w, h) {
  // Simple equirect projection for prototype
  const x = (lon - bounds.west) / (bounds.east - bounds.west);
  const y = (bounds.north - lat) / (bounds.north - bounds.south);
  return { x: x * w, y: y * h };
}

function inBoundsLatLon(lat, lon, bounds) {
  return lat <= bounds.north && lat >= bounds.south && lon >= bounds.west && lon <= bounds.east;
}

// --- Grid graph (prototype) ---
// We map grid cells to lat/lon centers inside the bounds.
function key(i, j) {
  return `${i},${j}`;
}
function parseKey(k) {
  const [i, j] = k.split(",").map((n) => parseInt(n, 10));
  return { i, j };
}

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

function randomCell(bounds) {
  // uniform in grid for prototype
  const i = Math.floor(Math.random() * CONFIG.gridCols);
  const j = Math.floor(Math.random() * CONFIG.gridRows);
  const ll = cellLatLon(i, j, bounds);
  if (!inBoundsLatLon(ll.lat, ll.lon, bounds)) return randomCell(bounds);
  return key(i, j);
}

function pathLeavesBounds(pathKeys, bounds) {
  for (const k of pathKeys) {
    const { i, j } = parseKey(k);
    const ll = cellLatLon(i, j, bounds);
    if (!inBoundsLatLon(ll.lat, ll.lon, bounds)) return true;
  }
  return false;
}

// --- Simulation state ---
let visibleBounds = applyZoom(BOUNDS, CONFIG.zoom);
let startKey = null;
let goalKey = null;
let stepper = null;
let currentStep = null;
let finalPath = null;
let phase = "search"; // search | end-hold | end-anim
let phaseT = 0;
let lastStepAt = 0;
let cycle = 0;

function pickEndpoints() {
  visibleBounds = applyZoom(BOUNDS, CONFIG.zoom);

  let s, g;
  for (let tries = 0; tries < 5000; tries++) {
    s = randomCell(visibleBounds);
    g = randomCell(visibleBounds);
    const sLL = cellLatLon(...Object.values(parseKey(s)), visibleBounds);
    const gLL = cellLatLon(...Object.values(parseKey(g)), visibleBounds);
    if (haversineMeters(sLL, gLL) >= CONFIG.minStartEndMeters) break;
  }

  startKey = s;
  goalKey = g;
  stepper = makeAStarStepper({
    startKey,
    goalKey,
    neighbors: neighborsOf,
    cost: (a, b) => cost(a, b, visibleBounds),
    heuristic: (a, g2) => heuristic(a, g2, visibleBounds),
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
function drawBackground(w, h) {
  ctx.fillStyle = "#0b0f14";
  ctx.fillRect(0, 0, w, h);
}

function drawGrid(w, h) {
  // subtle grid / road texture
  ctx.strokeStyle = "rgba(255,255,255,0.035)";
  ctx.lineWidth = 1;
  const stepX = w / CONFIG.gridCols;
  const stepY = h / CONFIG.gridRows;

  // draw only every N lines for performance
  const every = 8;
  for (let i = 0; i <= CONFIG.gridCols; i += every) {
    const x = i * stepX;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let j = 0; j <= CONFIG.gridRows; j += every) {
    const y = j * stepY;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
}

function cellToXY(k, w, h) {
  const { i, j } = parseKey(k);
  const ll = cellLatLon(i, j, visibleBounds);
  return project(ll.lat, ll.lon, visibleBounds, w, h);
}

function drawSet(keys, w, h, color, alpha, sizePx) {
  ctx.fillStyle = color;
  ctx.globalAlpha = alpha;
  for (const k of keys) {
    const p = cellToXY(k, w, h);
    ctx.fillRect(p.x - sizePx / 2, p.y - sizePx / 2, sizePx, sizePx);
  }
  ctx.globalAlpha = 1;
}

function drawPath(pathKeys, w, h, t01, color, widthPx) {
  if (!pathKeys || pathKeys.length < 2) return;
  const n = Math.max(2, Math.floor(pathKeys.length * t01));
  ctx.strokeStyle = color;
  ctx.lineWidth = widthPx;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  for (let idx = 0; idx < n; idx++) {
    const p = cellToXY(pathKeys[idx], w, h);
    if (idx === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
}

function drawMarker(k, w, h, fill, stroke) {
  const p = cellToXY(k, w, h);
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

function render(now) {
  const w = window.innerWidth;
  const h = window.innerHeight;

  drawBackground(w, h);
  drawGrid(w, h);

  if (currentStep && currentStep.status === "searching") {
    // closed = visited (purple-ish)
    drawSet(currentStep.closedSet, w, h, "#7c3aed", 0.12, 3);
    // open = frontier (cyan-ish)
    drawSet(currentStep.openSet, w, h, "#22d3ee", 0.18, 3);

    // current expansion
    if (currentStep.current) {
      const p = cellToXY(currentStep.current, w, h);
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.fillRect(p.x - 3, p.y - 3, 6, 6);
    }
  }

  if (finalPath) {
    if (phase === "end-hold") {
      drawPath(finalPath, w, h, 1.0, "rgba(34,211,238,0.95)", 4);
    } else if (phase === "end-anim") {
      const t01 = clamp(phaseT / CONFIG.endAnimMs, 0, 1);
      // draw + pulse glow
      drawPath(finalPath, w, h, 1.0, `rgba(34,211,238,${0.6 + 0.35 * Math.sin(t01 * Math.PI)})`, 6);
      drawPath(finalPath, w, h, 1.0, "rgba(34,211,238,0.95)", 3);
    }
  }

  drawMarker(startKey, w, h, "#10b981", "rgba(16,185,129,0.8)");
  drawMarker(goalKey, w, h, "#ef4444", "rgba(239,68,68,0.8)");

  const openN = currentStep?.openSet?.size ?? 0;
  const closedN = currentStep?.closedSet?.size ?? 0;
  const steps = currentStep?.steps ?? 0;

  if (CONFIG.showHud) {
    hud.style.display = "block";
    hud.innerHTML =
      `<b>A*</b> Greater Boston (prototype grid) <span class="dim">cycle ${cycle}</span><br/>` +
      `phase: <b>${phase}</b> · steps: <b>${steps}</b><br/>` +
      `open: <b>${openN}</b> · closed: <b>${closedN}</b><br/>` +
      `rate: ~<b>${Math.round(1000 / CONFIG.stepDelayMs)}</b> steps/sec`;
  } else {
    hud.style.display = "none";
  }

  requestAnimationFrame(tick);
}

function tick(now) {
  // step A* at fixed rate
  if (phase === "search") {
    if (now - lastStepAt >= CONFIG.stepDelayMs) {
      lastStepAt = now;
      const r = stepper.step();
      currentStep = r;

      if (r.done) {
        if (r.status === "found") {
          // optional bounds enforcement
          if (CONFIG.discardIfPathLeavesBounds && pathLeavesBounds(r.path, visibleBounds)) {
            pickEndpoints();
            requestAnimationFrame(render);
            return;
          }

          finalPath = r.path;
          phase = "end-hold";
          phaseT = 0;
        } else {
          // no path — resample
          pickEndpoints();
        }
      }
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
