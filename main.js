import { haversineMeters, makeAStarStepper } from "./astar.js";

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

  open: "#22d3ee", // cyan
  closed: "#a78bfa", // violet
  current: "#ffffff",

  pathCore: "rgba(70, 245, 255, 0.96)",
  pathGlow: "rgba(70, 245, 255, 0.42)",

  start: "#34d399",
  goal: "#fb7185",
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
};

// --- Canvas setup ---
const canvas = document.getElementById("c");
const hud = document.getElementById("hud");
const ctx = canvas.getContext("2d", { alpha: false });

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

function aspectFitBounds(bounds, w, h) {
  // Adjust displayed bounds to match viewport aspect ratio so the map isn't stretched.
  // Approximation: treat spans in degrees but correct lon scale by cos(latitude_of_center).
  const c = bboxCenter(bounds);
  const latSpan0 = bounds.north - bounds.south;
  const lonSpan0 = bounds.east - bounds.west;

  const viewportAspect = w / Math.max(1e-6, h);
  const cosLat = Math.max(1e-6, Math.cos((c.lat * Math.PI) / 180));

  // Effective lon-span in "lat degrees".
  const effLonSpan0 = lonSpan0 * cosLat;
  const effAspect0 = effLonSpan0 / Math.max(1e-6, latSpan0);

  let latSpan = latSpan0;
  let lonSpan = lonSpan0;

  if (effAspect0 < viewportAspect) {
    // Too "tall" / narrow; expand longitude span.
    const effLonSpanTarget = latSpan0 * viewportAspect;
    lonSpan = effLonSpanTarget / cosLat;
  } else if (effAspect0 > viewportAspect) {
    // Too "wide"; expand latitude span.
    latSpan = effLonSpan0 / viewportAspect;
  }

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
// Keep simulation bounds stable during a cycle; compute separate render bounds per-frame for aspect fit.
let simBounds = applyZoom(BOUNDS, CONFIG.zoom);
let renderBounds = simBounds;
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
  simBounds = applyZoom(BOUNDS, CONFIG.zoom);

  let s, g;
  for (let tries = 0; tries < 5000; tries++) {
    s = randomCell(simBounds);
    g = randomCell(simBounds);
    const sLL = cellLatLon(...Object.values(parseKey(s)), simBounds);
    const gLL = cellLatLon(...Object.values(parseKey(g)), simBounds);
    if (haversineMeters(sLL, gLL) >= CONFIG.minStartEndMeters) break;
  }

  startKey = s;
  goalKey = g;
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

  // Road-like network: curvy arterials + lighter minor streets.
  const drawRoad = ({ x0, y0, x1, y1, width, alpha, dash }) => {
    const cx0 = x0 + (x1 - x0) * (0.30 + 0.10 * (Math.random() - 0.5));
    const cy0 = y0 + (y1 - y0) * (0.30 + CONFIG.roadCurviness * (Math.random() - 0.5)) * 220;
    const cx1 = x0 + (x1 - x0) * (0.70 + 0.10 * (Math.random() - 0.5));
    const cy1 = y0 + (y1 - y0) * (0.70 + CONFIG.roadCurviness * (Math.random() - 0.5)) * 220;

    bctx.save();
    bctx.globalAlpha = alpha;
    bctx.lineCap = "round";
    bctx.lineJoin = "round";

    // Asphalt body (soft).
    bctx.strokeStyle = THEME.road;
    bctx.lineWidth = width;
    bctx.shadowColor = "rgba(0,0,0,0.45)";
    bctx.shadowBlur = 10;
    bctx.beginPath();
    bctx.moveTo(x0, y0);
    bctx.bezierCurveTo(cx0, cy0, cx1, cy1, x1, y1);
    bctx.stroke();

    if (dash) {
      // Center dash.
      bctx.shadowBlur = 0;
      bctx.setLineDash([10, 12]);
      bctx.lineDashOffset = Math.random() * 22;
      bctx.strokeStyle = THEME.roadDash;
      bctx.lineWidth = Math.max(1, width * 0.12);
      bctx.beginPath();
      bctx.moveTo(x0, y0);
      bctx.bezierCurveTo(cx0, cy0, cx1, cy1, x1, y1);
      bctx.stroke();
    }
    bctx.restore();
  };

  const randEdgePoint = () => {
    const side = (Math.random() * 4) | 0;
    if (side === 0) return { x: -30, y: Math.random() * h };
    if (side === 1) return { x: w + 30, y: Math.random() * h };
    if (side === 2) return { x: Math.random() * w, y: -30 };
    return { x: Math.random() * w, y: h + 30 };
  };

  // Major roads.
  for (let i = 0; i < CONFIG.roadMajorCount; i++) {
    const a = randEdgePoint();
    const b = randEdgePoint();
    drawRoad({ x0: a.x, y0: a.y, x1: b.x, y1: b.y, width: 14 + 12 * Math.random(), alpha: 0.38, dash: true });
  }

  // Minor roads.
  for (let i = 0; i < CONFIG.roadMinorCount; i++) {
    const a = { x: Math.random() * w, y: Math.random() * h };
    const b = randEdgePoint();
    drawRoad({ x0: a.x, y0: a.y, x1: b.x, y1: b.y, width: 6 + 6 * Math.random(), alpha: 0.22, dash: false });
  }

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

function cellToXY(k, w, h) {
  const { i, j } = parseKey(k);
  const ll = cellLatLon(i, j, simBounds);
  return project(ll.lat, ll.lon, renderBounds, w, h);
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

  for (const k of keys) {
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

  ctx.save();
  ctx.globalCompositeOperation = "lighter";

  // Outer pulse.
  ctx.globalAlpha = 0.20 + 0.28 * pulse;
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = 2;
  ctx.shadowColor = "rgba(255,255,255,0.6)";
  ctx.shadowBlur = 16;
  ctx.beginPath();
  ctx.arc(p.x, p.y, 10 + 8 * pulse, 0, Math.PI * 2);
  ctx.stroke();

  // Core.
  ctx.globalAlpha = 0.9;
  ctx.shadowBlur = 0;
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.beginPath();
  ctx.arc(p.x, p.y, 3.4, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function render(now) {
  const w = window.innerWidth;
  const h = window.innerHeight;

  // Aspect-ratio aware framing for display (doesn't affect the simulation bounds).
  renderBounds = aspectFitBounds(simBounds, w, h);

  // Static background.
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  ctx.drawImage(bg, 0, 0, w, h);

  // Film grain.
  ctx.save();
  ctx.globalAlpha = CONFIG.noiseAlpha;
  ctx.globalCompositeOperation = "overlay";
  ctx.fillStyle = ctx.createPattern(noise, "repeat");
  ctx.fillRect(0, 0, w, h);
  ctx.restore();

  if (currentStep && currentStep.status === "searching") {
    drawSet(currentStep, currentStep.closedSet, w, h, THEME.closed, 0.07);
    drawSet(currentStep, currentStep.openSet, w, h, THEME.open, 0.10);
    drawCurrent(currentStep.current, w, h, now);
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

  hud.innerHTML =
    `<b>A*</b> Greater Boston <span class="dim">· prototype grid · cycle ${cycle}</span><br/>` +
    `phase: <b>${phase}</b> <span class="dim">·</span> steps: <b>${steps}</b><br/>` +
    `<span class="key">open</span>: <b>${openN}</b> <span class="dim">·</span> <span class="key">closed</span>: <b>${closedN}</b><br/>` +
    `<span class="dim">rate</span>: ~<b>${Math.round(1000 / CONFIG.stepDelayMs)}</b> steps/sec`;

  requestAnimationFrame(tick);
}

function tick(now) {
  // step A* at fixed rate
  if (phase === "search") {
    if (now - lastStepAt >= CONFIG.stepDelayMs) {
      lastStepAt = now;
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
