import { haversineMeters, makeAStarStepper, reconstructPath } from './astar.js';
import { DEFAULT_GUARDRAILS, updateGuardrails } from './guardrails.js';
import { stepEndPhase } from './endPhase.js';
import { extractRoadLinesWithMeta } from './roads-data.js';
import {
  buildRoadGraph,
  graphNodeLatLon,
  randomGraphNode,
  parseRoadGraphCache,
} from './road-graph.js';
import { BOUNDS, THEME, clamp, parseRuntimeConfig } from './config.js';
import { applyZoom, project, makeProjector } from './coordinates.js';
import { ENDPOINT_SAMPLING_MAX_TRIES, sampleEndpointPair } from './endpoint-sampling.js';
import {
  inBoundsLatLon,
  parseKey,
  cellLatLon,
  neighborsOf,
  cost,
  heuristic,
  randomCell,
} from './grid-helpers.js';
import {
  latLonToCellKey,
  snapLatLonToRoadPoint,
  buildRoadPointCacheFromGeojson,
  buildRoadPointCacheFromGraph,
} from './road-point-cache.js';
import { extractLandPolys, extractCoastlineLines, extractParksPolys } from './terrain-data.js';

const CONFIG = parseRuntimeConfig(typeof window !== 'undefined' ? window.location?.search : '');
const CENTER_OVERRIDE =
  CONFIG.centerLat != null && CONFIG.centerLon != null
    ? { lat: CONFIG.centerLat, lon: CONFIG.centerLon }
    : null;

const MAX_RENDER_NODES_PER_SET = 3500;
// Safety cap for pre-rendering OSM roads into an offscreen canvas.
// With zoomed-in defaults we can afford a higher ceiling, but we still keep a cap
// to avoid locking up weaker machines.
const MAX_ROAD_SEGMENTS = 1200000;
const MIN_ROAD_SEGMENTS = 150000;
const MAX_SEGMENTS_PER_LINE_HI = 6000;
const MAX_SEGMENTS_PER_LINE_LO = 1200;

// --- Canvas setup ---
if (typeof window !== 'undefined') {
  const canvas = document.getElementById('c');
  const hud = document.getElementById('hud');
  const help = document.getElementById('help');
  const controls = document.getElementById('controls');
  const ctx = canvas.getContext('2d', { alpha: false });

  const ROADS_GEO_URL = './data/osm/roads.geojson';
  const ROADS_COMPACT_URL = './data/osm/roads.compact.json';
  const ROAD_GRAPH_URL = './data/osm/roadGraph.v1.json';
  const LAND_URL = './data/osm/land.geojson';
  const COASTLINE_URL = './data/osm/coastline.geojson';
  const PARKS_URL = './data/osm/parks.geojson';
  const roadsLayer = document.createElement('canvas');
  const roadsCtx = roadsLayer.getContext('2d', { alpha: true });

  const landLayer = document.createElement('canvas');
  const landCtx = landLayer.getContext('2d', { alpha: true });
  let landPolys = []; // water polys (kind=water)
  let landReady = false;

  const exploredLayer = document.createElement('canvas');
  const exploredCtx = exploredLayer.getContext('2d', { alpha: true });
  let exploredLayerStep = -1;

  let noisePattern = null;
  let lastHudUpdate = 0;

  let coastlineLines = []; // [[lon,lat]...]
  let parksPolys = []; // polygons (geojson-style coords)

  let roadsLines = [];
  let roadsLinesMeta = [];
  let roadsReady = false;
  let roadsPointCache = { points: [], keys: [] };
  let roadGraph = null;
  let roadGraphReady = false;
  let showRoads = CONFIG.showRoads;
  let showTerrain = CONFIG.showTerrain;
  let roadsDetail = CONFIG.roadsDetail;

  let helpVisible = false;

  if (hud && CONFIG.hud === 0) {
    hud.style.display = 'none';
  }

  if (help) {
    help.style.display = 'none';
  }

  if (controls && CONFIG.hud === 0) {
    controls.style.display = 'none';
  }

  function rebuildRoadsLayerSoon() {
    if (!roadsReady) return;
    buildRoadsLayer(roadsCtx, roadsLayer.width, roadsLayer.height);
  }

  function initControls() {
    if (!controls || CONFIG.hud === 0) return;

    controls.innerHTML =
      `<label style="display:flex;align-items:center;gap:8px;">` +
      `<input id="showTerrain" type="checkbox" ${showTerrain ? 'checked' : ''} />` +
      `<b>Display terrain</b>` +
      `</label>` +
      `<div style="height:10px"></div>` +
      `<div><b>Road detail</b> <span class="dim">(coverage vs fidelity)</span></div>` +
      `<div style="display:flex;align-items:center;gap:10px;margin-top:6px;">` +
      `<input id="roadsDetail" type="range" min="0" max="100" step="1" value="${roadsDetail}" />` +
      `<span class="key" id="roadsDetailVal">${roadsDetail}</span>` +
      `</div>`;

    const terrain = controls.querySelector('#showTerrain');
    if (terrain) {
      terrain.addEventListener('change', () => {
        showTerrain = terrain.checked ? 1 : 0;
        requestAnimationFrame(render);
      });
    }

    const slider = controls.querySelector('#roadsDetail');
    const label = controls.querySelector('#roadsDetailVal');
    if (slider) {
      slider.addEventListener('input', () => {
        const v = Number.parseInt(slider.value, 10);
        if (!Number.isFinite(v)) return;
        roadsDetail = clamp(v, 0, 100);
        if (label) label.textContent = String(roadsDetail);
        rebuildRoadsLayerSoon();
        requestAnimationFrame(render);
      });
    }
  }

  initControls();

  // Background layers cached into offscreen canvases (rebuilt on resize).
  const bg = document.createElement('canvas');
  const bgCtx = bg.getContext('2d', { alpha: false });
  const noise = document.createElement('canvas');
  const noiseCtx = noise.getContext('2d');

  let dpr = 1;

  function resize() {
    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Build background at CSS-pixel resolution (we draw it 1:1 each frame).
    bg.width = Math.max(1, Math.floor(window.innerWidth));
    bg.height = Math.max(1, Math.floor(window.innerHeight));
    buildBackground(bgCtx, bg.width, bg.height);

    buildNoise(noiseCtx);
    noisePattern = ctx.createPattern(noise, 'repeat');

    roadsLayer.width = Math.max(1, Math.floor(window.innerWidth));
    roadsLayer.height = Math.max(1, Math.floor(window.innerHeight));
    if (roadsReady) buildRoadsLayer(roadsCtx, roadsLayer.width, roadsLayer.height);

    landLayer.width = Math.max(1, Math.floor(window.innerWidth));
    landLayer.height = Math.max(1, Math.floor(window.innerHeight));
    if (landReady) buildLandLayer(landCtx, landLayer.width, landLayer.height);

    exploredLayer.width = Math.max(1, Math.floor(window.innerWidth));
    exploredLayer.height = Math.max(1, Math.floor(window.innerHeight));
    exploredLayerStep = -1;
  }
  window.addEventListener('resize', resize);
  resize();

  window.addEventListener('keydown', (e) => {
    if (e.key?.toLowerCase() === 'r') {
      showRoads = showRoads ? 0 : 1;
    }

    if (e.key?.toLowerCase() === 't') {
      showTerrain = showTerrain ? 0 : 1;
      if (controls && CONFIG.hud !== 0) {
        const box = controls.querySelector('#showTerrain');
        if (box) box.checked = !!showTerrain;
      }
      requestAnimationFrame(render);
    }

    if (e.key === '?') {
      helpVisible = !helpVisible;
      if (help) help.style.display = helpVisible ? 'block' : 'none';
    }
  });

  loadLand();
  loadRoads();

  function randomRoadKey(rng = Math.random) {
    if (!roadsPointCache?.keys?.length) return null;
    return roadsPointCache.keys[Math.floor(rng() * roadsPointCache.keys.length)];
  }

  function hashSeedToUint32(seed) {
    const s = String(seed ?? '');
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const RNG = CONFIG.seed != null ? mulberry32(hashSeedToUint32(CONFIG.seed)) : Math.random;

  function isRoadGraphActive() {
    return CONFIG.graph === 'roads' && roadGraphReady && roadGraph?.nodes?.length > 0;
  }

  function keyToLatLon(k, bounds) {
    if (isRoadGraphActive()) {
      return graphNodeLatLon(roadGraph, k);
    }
    const { i, j } = parseKey(k);
    return cellLatLon(i, j, bounds, CONFIG.gridCols, CONFIG.gridRows);
  }

  let graphProjectionCache = {
    key: '',
    points: [],
  };

  function graphProjectionKey(bounds, w, h) {
    return `${bounds.north.toFixed(5)},${bounds.south.toFixed(5)},${bounds.west.toFixed(5)},${bounds.east.toFixed(5)}|${w}x${h}`;
  }

  function ensureGraphProjection(w, h) {
    if (!isRoadGraphActive()) return;
    const key = graphProjectionKey(simBounds, w, h);
    if (
      graphProjectionCache.key === key &&
      graphProjectionCache.points.length === roadGraph.nodes.length
    )
      return;

    const proj = makeProjector(simBounds, w, h, CONFIG.rotation);
    const points = new Array(roadGraph.nodes.length);
    for (const node of roadGraph.nodes) {
      points[node.id] = proj(node.lat, node.lon);
    }

    graphProjectionCache = { key, points };
  }

  function keyToXY(k, w, h) {
    if (isRoadGraphActive()) {
      ensureGraphProjection(w, h);
      const p = graphProjectionCache.points[k];
      if (p) return p;
    }

    const ll = keyToLatLon(k, simBounds);
    if (!ll) return { x: -1000, y: -1000 };
    return project(ll.lat, ll.lon, simBounds, w, h, CONFIG.rotation);
  }

  function pathLeavesBounds(pathKeys, bounds) {
    for (const k of pathKeys) {
      const ll = keyToLatLon(k, bounds);
      if (!ll || !inBoundsLatLon(ll.lat, ll.lon, bounds)) return true;
    }
    return false;
  }

  function pathLengthMeters(pathKeys, bounds) {
    if (!pathKeys || pathKeys.length < 2) return 0;
    let total = 0;
    for (let i = 1; i < pathKeys.length; i++) {
      const a = keyToLatLon(pathKeys[i - 1], bounds);
      const b = keyToLatLon(pathKeys[i], bounds);
      if (!a || !b) continue;
      total += haversineMeters(a, b);
    }
    return total;
  }

  // --- Simulation state ---
  // simBounds affects sampling + A* costs/heuristics only.
  let simBounds = applyZoom(BOUNDS, CONFIG.zoom, CENTER_OVERRIDE);
  let startKey = null;
  let goalKey = null;
  let stepper = null;
  let currentStep = null;
  let finalPath = null;
  let lastSearchStep = null; // preserved closedSet + cameFrom for end-phase gold edges
  let phase = 'search'; // search | end-hold | end-trace | end-glow
  let phaseT = 0;
  let lastStepAt = 0;
  let lastFrameAt = 0;
  let cycle = 0;
  let endpointSamplingBestEffort = false;
  let endpointSamplingDistanceMeters = 0;
  let endpointSamplingTries = 0;
  let lastPathLengthMeters = 0;

  const GUARDRAILS = DEFAULT_GUARDRAILS;
  let guardrailState = {
    consecutiveFailures: 0,
    consecutiveResamples: 0,
    relaxCyclesRemaining: 0,
  };

  let effectiveMinStartEndMeters = CONFIG.minStartEndMeters;
  let effectiveDiscardIfPathLeavesBounds = CONFIG.discardIfPathLeavesBounds;

  let soakStats = {
    cyclesCompleted: 0,
    failures: 0,
    resamples: 0,
    totalSteps: 0,
    totalSearchMs: 0,
  };

  function pickEndpoints() {
    simBounds = applyZoom(BOUNDS, CONFIG.zoom, CENTER_OVERRIDE);

    const useRoadGraph = isRoadGraphActive();
    const useRoadKeys = CONFIG.endpointMode === 'roads' && roadsPointCache.keys.length > 0;

    const randomKey = (rng) => {
      if (useRoadGraph) return randomGraphNode(roadGraph, rng);
      if (useRoadKeys) return randomRoadKey(rng);

      let k = randomCell(simBounds, CONFIG.gridCols, CONFIG.gridRows, rng);
      if (CONFIG.endpointMode === 'random' && roadsPointCache.points.length > 0) {
        const ll = cellLatLon(
          ...Object.values(parseKey(k)),
          simBounds,
          CONFIG.gridCols,
          CONFIG.gridRows,
        );
        const snapped = snapLatLonToRoadPoint(ll.lat, ll.lon, roadsPointCache.points);
        if (snapped) {
          const snappedKey = latLonToCellKey(
            snapped.lat,
            snapped.lon,
            simBounds,
            CONFIG.gridCols,
            CONFIG.gridRows,
          );
          if (snappedKey) k = snappedKey;
        }
      }

      return k;
    };

    const relaxed = CONFIG.soak !== 0 && guardrailState.relaxCyclesRemaining > 0;
    effectiveMinStartEndMeters = relaxed
      ? Math.min(CONFIG.minStartEndMeters, GUARDRAILS.relaxedMinStartEndMeters)
      : CONFIG.minStartEndMeters;
    effectiveDiscardIfPathLeavesBounds = relaxed ? false : CONFIG.discardIfPathLeavesBounds;

    const sampled = sampleEndpointPair({
      maxTries: ENDPOINT_SAMPLING_MAX_TRIES,
      minMeters: effectiveMinStartEndMeters,
      randomKey: (rng) => randomKey(rng || RNG),
      toLatLon: (k) => keyToLatLon(k, simBounds),
    });

    startKey = sampled.startKey;
    goalKey = sampled.goalKey;
    endpointSamplingBestEffort = !sampled.minDistanceMet;
    endpointSamplingDistanceMeters = sampled.distanceMeters;
    endpointSamplingTries = sampled.tries;

    if (useRoadGraph) {
      const neighborKeys = roadGraph.adjacency.map((edges) => edges.map((e) => e.to));
      stepper = makeAStarStepper({
        startKey,
        goalKey,
        neighbors: (k) => neighborKeys[k],
        cost: (a, b) => {
          const w = roadGraph.costMaps[a]?.get(b);
          if (Number.isFinite(w)) return w;
          const aLL = graphNodeLatLon(roadGraph, a);
          const bLL = graphNodeLatLon(roadGraph, b);
          return aLL && bLL ? haversineMeters(aLL, bLL) : Infinity;
        },
        heuristic: (a, g2) =>
          haversineMeters(graphNodeLatLon(roadGraph, a), graphNodeLatLon(roadGraph, g2)),
        isValidNode: (k) => roadGraph?.nodes?.[k] != null,
      });
    } else {
      stepper = makeAStarStepper({
        startKey,
        goalKey,
        neighbors: (k) => neighborsOf(k, CONFIG.gridCols, CONFIG.gridRows),
        cost: (a, b) => cost(a, b, simBounds, CONFIG.gridCols, CONFIG.gridRows),
        heuristic: (a, g2) => heuristic(a, g2, simBounds, CONFIG.gridCols, CONFIG.gridRows),
      });
    }

    currentStep = null;
    finalPath = null;
    lastSearchStep = null;
    exploredCtx.clearRect(0, 0, exploredLayer.width, exploredLayer.height);
    exploredLayerStep = -1;
    phase = 'search';
    phaseT = 0;
    lastStepAt = performance.now();
    lastFrameAt = lastStepAt;
    cycle += 1;

    if (CONFIG.soak !== 0 && guardrailState.relaxCyclesRemaining > 0) {
      guardrailState.relaxCyclesRemaining -= 1;
    }
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
    bctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < 5; i++) {
      const x = (0.15 + 0.7 * Math.random()) * w;
      const y = (0.15 + 0.7 * Math.random()) * h;
      const r = (0.22 + 0.25 * Math.random()) * Math.min(w, h);
      const rg = bctx.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, 'rgba(56,189,248,0.07)');
      rg.addColorStop(1, 'rgba(56,189,248,0.0)');
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
    const vg = bctx.createRadialGradient(
      w / 2,
      h / 2,
      Math.min(w, h) * 0.2,
      w / 2,
      h / 2,
      Math.max(w, h) * 0.75,
    );
    vg.addColorStop(0, 'rgba(0,0,0,0.0)');
    vg.addColorStop(1, `rgba(0,0,0,${CONFIG.vignetteAlpha})`);
    bctx.fillStyle = vg;
    bctx.fillRect(0, 0, w, h);
    bctx.restore();
  }

  // --- OSM land/water overlay ---
  async function loadLand() {
    try {
      const [waterRes, coastRes, parksRes] = await Promise.all([
        fetch(LAND_URL),
        fetch(COASTLINE_URL),
        fetch(PARKS_URL),
      ]);

      if (waterRes.ok) {
        const geojson = await waterRes.json();
        landPolys = extractLandPolys(geojson);
      }

      if (coastRes.ok) {
        const coast = await coastRes.json();
        coastlineLines = extractCoastlineLines(coast);
      }

      if (parksRes.ok) {
        const parks = await parksRes.json();
        parksPolys = extractParksPolys(parks);
      }

      landReady = true;
      buildLandLayer(landCtx, landLayer.width, landLayer.height);
    } catch (err) {
      console.warn('Failed to load land overlay', err);
    }
  }

  function buildCoastlineMask(w, h) {
    // Low-res mask for flood fill.
    // Increase resolution to avoid narrow channels getting "sealed" by thick lines.
    const mw = 2048;
    const mh = Math.round((mw * h) / w);
    const mask = document.createElement('canvas');
    mask.width = mw;
    mask.height = mh;
    const mctx = mask.getContext('2d');

    // 1) draw coastlines as barrier pixels
    mctx.clearRect(0, 0, mw, mh);
    mctx.save();
    mctx.strokeStyle = 'rgba(0,0,0,1)';
    mctx.lineWidth = 1;
    mctx.lineCap = 'round';
    mctx.lineJoin = 'round';

    const maskProj = makeProjector(simBounds, mw, mh, CONFIG.rotation);
    for (const line of coastlineLines) {
      if (!line || line.length < 2) continue;
      mctx.beginPath();
      for (let i = 0; i < line.length; i++) {
        const [lon, lat] = line[i];
        const p = maskProj(lat, lon);
        if (i === 0) mctx.moveTo(p.x, p.y);
        else mctx.lineTo(p.x, p.y);
      }
      mctx.stroke();
    }
    mctx.restore();

    const img = mctx.getImageData(0, 0, mw, mh);
    const data = img.data;
    const barrier = new Uint8Array(mw * mh);

    // Threshold very high so antialiasing doesn't create fat barriers that close harbor mouths.
    for (let i = 0; i < mw * mh; i++) {
      const a = data[i * 4 + 3];
      barrier[i] = a > 245 ? 1 : 0;
    }

    // 2) flood-fill ocean from the full east edge (robust: doesn't depend on a single seed point).
    const ocean = new Uint8Array(mw * mh);
    const qx = new Int32Array(mw * mh);
    const qy = new Int32Array(mw * mh);
    let qh = 0;
    let qt = 0;

    const push = (x, y) => {
      if (x < 0 || y < 0 || x >= mw || y >= mh) return;
      const idx = y * mw + x;
      if (ocean[idx]) return;
      if (barrier[idx]) return;
      ocean[idx] = 1;
      qx[qt] = x;
      qy[qt] = y;
      qt++;
    };

    // Seed a 3px-wide band on the east edge.
    for (let y = 0; y < mh; y++) {
      push(mw - 1, y);
      push(mw - 2, y);
      push(mw - 3, y);
    }
    while (qh < qt) {
      const x = qx[qh];
      const y = qy[qh];
      qh++;
      push(x + 1, y);
      push(x - 1, y);
      push(x, y + 1);
      push(x, y - 1);
    }

    return { mw, mh, ocean, barrier };
  }

  function buildLandLayer(lctx, w, h) {
    lctx.clearRect(0, 0, w, h);

    // If we have coastlines, do a coastline-based land mask.
    if (coastlineLines.length) {
      const { mw, mh, ocean, barrier } = buildCoastlineMask(w, h);

      // Paint land pixels (complement of ocean) as tint.
      const img = lctx.createImageData(mw, mh);
      const d = img.data;
      for (let i = 0; i < mw * mh; i++) {
        const isOcean = ocean[i] === 1;
        const isBarrier = barrier[i] === 1;
        if (isOcean || isBarrier) {
          d[i * 4 + 3] = 0;
          continue;
        }
        // land tint
        d[i * 4 + 0] = 40;
        d[i * 4 + 1] = 110;
        d[i * 4 + 2] = 70;
        d[i * 4 + 3] = Math.round(255 * 0.18);
      }

      // Draw mask scaled up.
      const tmp = document.createElement('canvas');
      tmp.width = mw;
      tmp.height = mh;
      const tctx = tmp.getContext('2d');
      tctx.putImageData(img, 0, 0);
      lctx.drawImage(tmp, 0, 0, w, h);
    } else {
      // Fallback: global tint (previous behavior)
      lctx.save();
      lctx.fillStyle = THEME.landFill;
      lctx.fillRect(0, 0, w, h);
      lctx.restore();
    }

    const landProj = makeProjector(simBounds, w, h, CONFIG.rotation);

    // Water polygons on top.
    if (landPolys.length) {
      lctx.save();
      lctx.fillStyle = THEME.waterFill;
      for (const poly of landPolys) {
        for (const ring of poly.rings) {
          if (!ring || ring.length < 3) continue;
          lctx.beginPath();
          for (let i = 0; i < ring.length; i++) {
            const [lon, lat] = ring[i];
            const p = landProj(lat, lon);
            if (i === 0) lctx.moveTo(p.x, p.y);
            else lctx.lineTo(p.x, p.y);
          }
          lctx.closePath();
          lctx.fill();
        }
      }
      lctx.restore();
    }

    // Parks/green overlay.
    if (parksPolys.length) {
      lctx.save();
      lctx.fillStyle = 'rgba(70, 170, 95, 0.12)';
      for (const poly of parksPolys) {
        const rings = poly || [];
        for (const ring of rings) {
          if (!ring || ring.length < 3) continue;
          lctx.beginPath();
          for (let i = 0; i < ring.length; i++) {
            const [lon, lat] = ring[i];
            const p = landProj(lat, lon);
            if (i === 0) lctx.moveTo(p.x, p.y);
            else lctx.lineTo(p.x, p.y);
          }
          lctx.closePath();
          lctx.fill();
        }
      }
      lctx.restore();
    }
  }

  // --- OSM roads layer ---
  async function loadRoads() {
    const cacheBounds = applyZoom(BOUNDS, CONFIG.zoom, CENTER_OVERRIDE);

    // 1) Try to load a precomputed road graph cache (dev-time generated).
    try {
      const res = await fetch(ROAD_GRAPH_URL);
      if (res.ok) {
        const cached = parseRoadGraphCache(await res.json());
        if (cached) {
          roadGraph = cached;
          roadGraphReady = roadGraph.nodes.length > 0;
          roadsPointCache = buildRoadPointCacheFromGraph(
            roadGraph,
            cacheBounds,
            CONFIG.gridCols,
            CONFIG.gridRows,
          );
        }
      }
    } catch (err) {
      console.warn('Failed to load road graph cache', err);
    }

    // 2) Load road lines (compact preferred; GeoJSON fallback) for rendering,
    // and as a fallback graph source if cache isn't available.
    try {
      let data = null;
      let res = await fetch(ROADS_COMPACT_URL);
      if (res.ok) {
        data = await res.json();
      } else {
        res = await fetch(ROADS_GEO_URL);
        if (!res.ok) throw new Error(`roads fetch failed: ${res.status}`);
        data = await res.json();
      }

      roadsLinesMeta = extractRoadLinesWithMeta(data);
      roadsLines = roadsLinesMeta.map((l) => l.coords);
      roadsReady = roadsLines.length > 0;

      if (!roadsReady) return;

      // Always build the roads layer from lines.
      buildRoadsLayer(roadsCtx, roadsLayer.width, roadsLayer.height);

      // If we didn't get a cached road graph, build one from the lines.
      if (!roadGraphReady) {
        roadGraph = buildRoadGraph(roadsLines, {
          toleranceMeters: 8,
          bounds: cacheBounds,
        });
        roadGraphReady = roadGraph.nodes.length > 0;
      }

      // Ensure we have a point cache for snapping/endpoint sampling.
      if (!roadsPointCache.keys.length) {
        roadsPointCache = buildRoadPointCacheFromGeojson(
          data,
          cacheBounds,
          CONFIG.gridCols,
          CONFIG.gridRows,
        );
      }

      if (
        (CONFIG.graph === 'roads' && roadGraphReady) ||
        (CONFIG.endpointMode === 'roads' && roadsPointCache.keys.length > 0)
      ) {
        pickEndpoints();
      }
    } catch (err) {
      console.warn('Failed to load roads layer', err);
    }
  }

  function roadClassPriority(highway) {
    switch (highway) {
      case 'motorway':
        return 0;
      case 'trunk':
        return 1;
      case 'primary':
        return 2;
      case 'secondary':
        return 3;
      case 'tertiary':
        return 4;
      case 'unclassified':
        return 5;
      case 'residential':
        return 6;
      case 'living_street':
        return 7;
      default:
        return 50;
    }
  }

  function buildRoadsLayer(rctx, w, h) {
    if (!roadsLinesMeta.length) return;
    rctx.clearRect(0, 0, w, h);
    rctx.save();
    rctx.strokeStyle = THEME.osmRoad;
    rctx.lineWidth = 1.0;
    rctx.lineCap = 'round';
    rctx.lineJoin = 'round';

    const t = roadsDetail / 100;
    const effectiveMaxSegments = Math.round(
      MIN_ROAD_SEGMENTS + t * (MAX_ROAD_SEGMENTS - MIN_ROAD_SEGMENTS),
    );

    // Goal: avoid a single very-long polyline consuming the entire segment budget.
    // We downsample long lines so we draw (at least) a little bit of everything.
    const MAX_SEGMENTS_PER_LINE = Math.round(
      MAX_SEGMENTS_PER_LINE_LO + t * (MAX_SEGMENTS_PER_LINE_HI - MAX_SEGMENTS_PER_LINE_LO),
    );

    // Prioritize major roads first so if we hit the budget, the "shape" of the map is still there.
    const ordered = [...roadsLinesMeta].sort((a, b) => {
      const pa = roadClassPriority(a.highway);
      const pb = roadClassPriority(b.highway);
      if (pa !== pb) return pa - pb;
      // tie-break: longer lines first (helps major arterials show up)
      return (b.coords?.length ?? 0) - (a.coords?.length ?? 0);
    });

    const roadsProj = makeProjector(simBounds, w, h, CONFIG.rotation);
    let segments = 0;

    for (const item of ordered) {
      const line = item?.coords;
      if (!line || line.length < 2) continue;
      if (segments >= effectiveMaxSegments) break;

      const stride =
        line.length > MAX_SEGMENTS_PER_LINE ? Math.ceil(line.length / MAX_SEGMENTS_PER_LINE) : 1;

      rctx.beginPath();
      let first = true;

      for (let i = 0; i < line.length; i += stride) {
        const [lon, lat] = line[i];
        const p = roadsProj(lat, lon);
        if (first) {
          rctx.moveTo(p.x, p.y);
          first = false;
        } else {
          rctx.lineTo(p.x, p.y);
        }

        segments += 1;
        if (segments >= effectiveMaxSegments) break;
      }

      rctx.stroke();
    }

    rctx.restore();
  }

  function cellToXY(k, w, h) {
    return keyToXY(k, w, h);
  }

  function renderExploredEdgesToLayer(step, w, h, budget = MAX_RENDER_NODES_PER_SET) {
    if (!step?.closedSet || !step?.cameFrom) return;

    exploredCtx.clearRect(0, 0, w, h);
    exploredCtx.save();
    exploredCtx.globalCompositeOperation = 'source-over';
    exploredCtx.strokeStyle = THEME.explored;
    exploredCtx.lineWidth = 2;
    exploredCtx.lineCap = 'round';
    exploredCtx.lineJoin = 'round';

    const total = step.closedSet.size ?? 0;
    const limit = Math.min(budget, MAX_RENDER_NODES_PER_SET);
    const stride = total > limit ? Math.ceil(total / limit) : 1;
    let idx = 0;
    let drawn = 0;

    exploredCtx.beginPath();
    for (const k of step.closedSet) {
      if (stride > 1 && idx % stride !== 0) {
        idx += 1;
        continue;
      }
      idx += 1;
      drawn += 1;
      if (drawn > limit) break;

      const pred = step.cameFrom.get(k);
      if (pred == null) continue;

      const p1 = cellToXY(k, w, h);
      const p2 = cellToXY(pred, w, h);
      exploredCtx.moveTo(p1.x, p1.y);
      exploredCtx.lineTo(p2.x, p2.y);
    }
    exploredCtx.stroke();

    exploredCtx.restore();
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

  function drawPath(keys, w, h, t01) {
    if (!keys || keys.length < 2) return;

    const n = Math.max(2, Math.floor(keys.length * clamp(t01, 0, 1)));

    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.strokeStyle = THEME.pathCore;
    ctx.lineWidth = 3;
    strokePath(keys, w, h, n);
    ctx.stroke();

    ctx.restore();
  }

  function drawPathDot(keys, w, h, t01) {
    if (!keys || keys.length < 2) return;
    const clamped = clamp(t01, 0, 1);
    const idx = Math.min(keys.length - 2, Math.floor(clamped * (keys.length - 1)));
    const nextIdx = idx + 1;
    const localT = clamped * (keys.length - 1) - idx;
    const p0 = cellToXY(keys[idx], w, h);
    const p1 = cellToXY(keys[nextIdx], w, h);
    const x = p0.x + (p1.x - p0.x) * localT;
    const y = p0.y + (p1.y - p0.y) * localT;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.shadowColor = 'rgba(255,255,255,0.75)';
    ctx.shadowBlur = 18;
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.beginPath();
    ctx.arc(x, y, 3.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawMarker(k, w, h, fill, ring) {
    const p = cellToXY(k, w, h);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

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
    ctx.globalCompositeOperation = 'source-over';

    // Ring.
    ctx.globalAlpha = 0.45 + 0.35 * pulse;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 7 + 3 * pulse, 0, Math.PI * 2);
    ctx.stroke();

    // Core dot.
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function render(now) {
    const w = window.innerWidth;
    const h = window.innerHeight;

    // Static background.
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.drawImage(bg, 0, 0, w, h);

    if (showTerrain && landReady) {
      ctx.drawImage(landLayer, 0, 0, w, h);
    }

    if (showRoads && roadsReady) {
      ctx.drawImage(roadsLayer, 0, 0, w, h);
    }

    // Film grain.
    if (noisePattern) {
      ctx.save();
      ctx.globalAlpha = CONFIG.noiseAlpha;
      ctx.globalCompositeOperation = 'overlay';
      ctx.fillStyle = noisePattern;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }

    if (currentStep && currentStep.status === 'searching') {
      if (CONFIG.showOpenClosed !== 0) {
        const stepCount = currentStep.steps ?? 0;
        if (stepCount !== exploredLayerStep) {
          renderExploredEdgesToLayer(currentStep, w, h);
          exploredLayerStep = stepCount;
        }
        ctx.drawImage(exploredLayer, 0, 0, w, h);
      }

      if (CONFIG.showPathDuringSearch !== 0) {
        const partial = reconstructPath(currentStep.cameFrom, currentStep.current);
        ctx.save();
        ctx.globalAlpha = 0.2;
        drawPath(partial, w, h, 1.0);
        ctx.restore();
      }

      if (CONFIG.showCurrent !== 0) {
        drawCurrent(currentStep.current, w, h, now);
      }
    }

    // Draw explored edges (gold) during end phases from saved search state.
    // exploredLayer persists from final search step — just composite it.
    if (lastSearchStep && (phase === 'end-hold' || phase === 'end-trace' || phase === 'end-glow')) {
      ctx.drawImage(exploredLayer, 0, 0, w, h);
    }

    if (finalPath) {
      if (phase === 'end-hold') {
        drawPath(finalPath, w, h, 1.0);
      } else if (phase === 'end-trace') {
        const t01 = CONFIG.endTraceMs > 0 ? clamp(phaseT / CONFIG.endTraceMs, 0, 1) : 1;
        drawPath(finalPath, w, h, t01);
        drawPathDot(finalPath, w, h, t01);
      } else if (phase === 'end-glow') {
        const t01 = CONFIG.endGlowMs > 0 ? clamp(phaseT / CONFIG.endGlowMs, 0, 1) : 1;
        const fade = 1 - t01;
        ctx.save();
        ctx.globalAlpha = fade;
        drawPath(finalPath, w, h, 1.0);
        ctx.restore();
      }
    }

    drawMarker(startKey, w, h, THEME.start, 'rgba(52,211,153,0.55)');
    drawMarker(goalKey, w, h, THEME.goal, 'rgba(251,113,133,0.55)');

    if (now - lastHudUpdate > 200) {
      lastHudUpdate = now;

      const openN = currentStep?.openSet?.size ?? 0;
      const closedN = currentStep?.closedSet?.size ?? 0;
      const steps = currentStep?.steps ?? 0;

      const samplingLine =
        `sample: <b>${Math.round(endpointSamplingDistanceMeters)}</b>m <span class="dim">·</span> tries: <b>${endpointSamplingTries}</b>` +
        (endpointSamplingBestEffort
          ? ` <span class="dim">·</span> <b style="color:#fb7185">min-distance not met; best-effort</b>`
          : '');

      const avgSps =
        soakStats.totalSearchMs > 0 ? soakStats.totalSteps / (soakStats.totalSearchMs / 1000) : 0;
      const soakLine =
        CONFIG.soak !== 0
          ? ` <span class="dim">·</span> <span class="key">soak</span>: cycles=<b>${soakStats.cyclesCompleted}</b> fail=<b>${soakStats.failures}</b> resamp=<b>${soakStats.resamples}</b> avgSPS=<b>${avgSps.toFixed(1)}</b>` +
            ` <span class="dim">·</span> gr(f=${guardrailState.consecutiveFailures},r=${guardrailState.consecutiveResamples},relax=${guardrailState.relaxCyclesRemaining})` +
            (guardrailState.relaxCyclesRemaining > 0 ? ` <b style="color:#fbbf24">RELAXED</b>` : '')
          : '';

      const graphStats = isRoadGraphActive()
        ? `<span class="key">graph</span>: <b>roads</b>` +
          ` <span class="dim">·</span> <span class="key">nodes</span>: <b>${roadGraph.nodes.length}</b>` +
          ` <span class="dim">·</span> <span class="key">edges</span>: <b>${roadGraph.edges}</b>`
        : CONFIG.graph === 'roads'
          ? `<span class="key">graph</span>: <b>roads</b>` +
            ` <span class="dim">·</span> <span class="key">nodes</span>: <b class="dim">loading</b>`
          : `<span class="key">graph</span>: <b>grid</b>` +
            ` <span class="dim">·</span> <span class="key">cells</span>: <b>${CONFIG.gridCols * CONFIG.gridRows}</b>`;

      const graphLabel = isRoadGraphActive()
        ? 'roads'
        : CONFIG.graph === 'roads'
          ? 'roads (loading)'
          : 'grid';

      const statsLine =
        `<span class="key">path</span>: <b>${Math.round(lastPathLengthMeters)}</b>m` +
        ` <span class="dim">·</span> ${graphStats}` +
        ` <span class="dim">·</span> <span class="key">roads pts</span>: <b>${roadsPointCache.points.length}</b>` +
        ` <span class="dim">·</span> <span class="key">endpointMode</span>: <b>${CONFIG.endpointMode}</b>` +
        soakLine;

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
          ` roads=<b>${showRoads ? 1 : 0}</b>` +
          ` terrain=<b>${showTerrain ? 1 : 0}</b>`;

        hud.innerHTML =
          `<b>A*</b> Greater Boston <span class="dim">· graph ${graphLabel} · cycle ${cycle}</span><br/>` +
          `phase: <b>${phase}</b> <span class="dim">·</span> steps: <b>${steps}</b><br/>` +
          `${samplingLine}<br/>` +
          `${statsLine}<br/>` +
          `${openClosedLine}<br/>` +
          `${vizLine}<br/>` +
          `<span class="dim">cfg</span>: sps=<b>${CONFIG.stepsPerSecond}</b> maxStepsPerFrame=<b>${CONFIG.maxStepsPerFrame}</b> zoom=<b>${CONFIG.zoom.toFixed(2)}</b><br/>` +
          `<span class="dim">cfg</span>: minDist=<b>${CONFIG.minStartEndMeters}</b>m`;
      }

      if (help) {
        const modeLabel = CONFIG.mode ?? 'default';
        const togglesLine =
          `hud=<b>${CONFIG.hud ? 1 : 0}</b>` +
          ` openClosed=<b>${CONFIG.showOpenClosed ? 1 : 0}</b>` +
          ` current=<b>${CONFIG.showCurrent ? 1 : 0}</b>` +
          ` pathDuring=<b>${CONFIG.showPathDuringSearch ? 1 : 0}</b>` +
          ` roads=<b>${showRoads ? 1 : 0}</b>` +
          ` terrain=<b>${showTerrain ? 1 : 0}</b>`;

        const paramsLine =
          `mode=<b>${modeLabel}</b>` +
          ` sps=<b>${CONFIG.stepsPerSecond}</b>` +
          ` maxStepsPerFrame=<b>${CONFIG.maxStepsPerFrame}</b>` +
          ` zoom=<b>${CONFIG.zoom.toFixed(2)}</b>` +
          ` endHoldMs=<b>${CONFIG.endHoldMs}</b>` +
          ` endAnimMs=<b>${CONFIG.endAnimMs}</b>` +
          ` minStartEndMeters=<b>${CONFIG.minStartEndMeters}</b>` +
          ` graph=<b>${CONFIG.graph}</b>`;

        help.innerHTML =
          `<b>Help</b> <span class="dim">· toggle with ?</span><br/>` +
          `<span class="dim">keys</span>: <span class="key">r</span> roads <span class="dim">·</span> <span class="key">t</span> terrain <span class="dim">·</span> <span class="key">?</span> help<br/>` +
          `<span class="dim">toggles</span>: ${togglesLine}<br/>` +
          `<span class="dim">query params</span>: ${paramsLine}<br/>` +
          `<span class="dim">query params</span>: mode, sps, maxStepsPerFrame, zoom, endHoldMs, endAnimMs, minStartEndMeters, graph, hud, showOpenClosed, showCurrent, showPathDuringSearch, showRoads, showTerrain`;
      }
    } // end HUD throttle

    requestAnimationFrame(tick);
  }

  function tick(now) {
    const dt = Math.min(1000, Math.max(0, now - lastFrameAt));
    lastFrameAt = now;
    // step A* at fixed rate (but allow multiple steps per frame when frames are slow)
    if (phase === 'search') {
      let stepsThisFrame = 0;

      while (now - lastStepAt >= CONFIG.stepDelayMs && stepsThisFrame < CONFIG.maxStepsPerFrame) {
        lastStepAt += CONFIG.stepDelayMs;
        stepsThisFrame += 1;

        const r = stepper.step();
        currentStep = r;

        if (r.done) {
          if (r.status === 'found') {
            // optional bounds enforcement
            if (effectiveDiscardIfPathLeavesBounds && pathLeavesBounds(r.path, simBounds)) {
              if (CONFIG.soak !== 0) {
                soakStats.resamples += 1;
                const u = updateGuardrails(guardrailState, 'resample', GUARDRAILS);
                guardrailState = u.state;
              }
              pickEndpoints();
              requestAnimationFrame(render);
              return;
            }

            if (CONFIG.soak !== 0) {
              const searchMs = performance.now() - lastStepAt;
              soakStats.cyclesCompleted += 1;
              soakStats.totalSteps += r.steps ?? 0;
              soakStats.totalSearchMs += Math.max(0, searchMs);
              const u = updateGuardrails(guardrailState, 'success', GUARDRAILS);
              guardrailState = u.state;
            }

            finalPath = r.path;
            lastPathLengthMeters = pathLengthMeters(r.path, simBounds);
            // Preserve explored edges for rendering during end phases.
            lastSearchStep = {
              closedSet: new Set(r.closedSet),
              cameFrom: new Map(r.cameFrom),
            };
            phase = 'end-hold';
            phaseT = 0;
          } else {
            // no path — resample
            if (CONFIG.soak !== 0) {
              soakStats.failures += 1;
              const u = updateGuardrails(guardrailState, 'failure', GUARDRAILS);
              guardrailState = u.state;
            }
            pickEndpoints();
          }
          break;
        }
      }

      // If the tab was backgrounded, avoid an enormous catch-up loop.
      if (now - lastStepAt > CONFIG.stepDelayMs * CONFIG.maxStepsPerFrame) {
        lastStepAt = now;
      }
    } else if (phase === 'end-hold' || phase === 'end-trace' || phase === 'end-glow') {
      const next = stepEndPhase({ phase, phaseT }, dt, CONFIG);
      phase = next.phase;
      phaseT = next.phaseT;
      if (next.done) {
        pickEndpoints();
      }
    }

    render(now);
  }

  requestAnimationFrame(tick);
}
