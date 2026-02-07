// --- Spec-driven constants (initial proposal; tweak later) ---
export const BOUNDS = {
  north: 42.55,
  south: 42.2,
  west: -71.35,
  east: -70.85,
};

export const THEME = {
  // Treat the base background gradient as "ocean" so land tint + water polygons read distinctly.
  bg0: '#050a12',
  bg1: '#07162a',
  grid: 'rgba(255,255,255,0.035)',
  road: 'rgba(210,225,255,0.055)',
  roadDash: 'rgba(255,255,255,0.08)',
  osmRoad: 'rgba(90,100,110,0.45)',
  // Land tint on top of ocean background.
  landFill: 'rgba(40, 110, 70, 0.18)',
  // Water polygons (rivers/harbor) on top of land tint.
  waterFill: 'rgba(45, 140, 210, 0.22)',

  // Tuned for legibility on dark background (open/closed/current are distinct).
  open: '#22d3ee', // cyan
  closed: '#fbbf24', // amber
  current: '#ffffff',

  // Edge-based explored roads color (gold).
  explored: 'rgba(251, 191, 36, 0.55)',

  pathCore: 'rgba(56, 189, 248, 0.9)',
  pathGlow: 'rgba(70, 245, 255, 0.42)',

  start: '#34d399',
  goal: '#fb7185',
};

export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// --- Runtime configuration (query params) ---
//
// Supported query params (invalid values fall back to defaults):
//   - mode: chill|debug (preset bundle)
//   - sps: integer [1, 120] (steps per second)
//   - zoom: float [0.5, 2.0]
//   - hud: 0|1
//   - endHoldMs: int [0, 60000]
//   - endAnimMs: int [0, 60000] (legacy total; split into trace+glow)
//   - endTraceMs: int [0, 60000]
//   - endGlowMs: int [0, 60000]
//   - minStartEndMeters: int [0, 200000]
//   - showOpenClosed: 0|1 (default 1)
//   - showCurrent: 0|1 (default 1)
//   - showPathDuringSearch: 0|1 (default 0)
//   - showRoads: 0|1 (default 1)
//   - showTerrain: 0|1 (default 1)
//   - roadsDetail: int [0,100] (default 70) (UI slider when HUD is enabled)
//   - seed: string|int (deterministic endpoints)
//   - centerLat / centerLon: float (override bbox center)
//   - rotation: float [-180, 180] (clockwise degrees, default 15)
//   - maxStepsPerFrame: int [1, 500] (default 60)
//   - endpointMode: roads|random (default roads)
//   - graph: roads|grid (default roads)
//   - showHud: 0|1 (alias for hud)
//   - soak: 0|1 (default 0)

export const DEFAULT_CONFIG = {
  stepsPerSecond: 5,
  maxStepsPerFrame: 15,

  // hold after finding the path
  endHoldMs: 1800,
  // legacy total anim duration (kept for compatibility)
  endAnimMs: 1200,
  // end animation breakdown (trace + glow)
  endTraceMs: 720,
  endGlowMs: 480,

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
  zoom: 2.0,
  hud: 0,

  // viz toggles
  showOpenClosed: 1,
  showCurrent: 1,
  showPathDuringSearch: 0,
  showRoads: 1,
  showTerrain: 1,
  roadsDetail: 70,
  // Determinism + viewport control
  seed: null,
  centerLat: 42.3601,
  centerLon: -71.0942,
  rotation: 15,

  endpointMode: 'roads',
  graph: 'roads',
  soak: 0,
};

export const PRESET_CONFIG = {
  chill: {
    stepsPerSecond: 12,
    maxStepsPerFrame: 30,
    endHoldMs: 3000,
    endAnimMs: 2000,
    hud: 0,
    showOpenClosed: 0,
    showCurrent: 0,
    showPathDuringSearch: 0,
    showRoads: 1,
    showTerrain: 1,
    roadsDetail: 70,
  },
  debug: {
    stepsPerSecond: 45,
    maxStepsPerFrame: 140,
    endHoldMs: 900,
    endAnimMs: 700,
    hud: 1,
    showOpenClosed: 1,
    showCurrent: 1,
    showPathDuringSearch: 1,
    showRoads: 1,
    showTerrain: 1,
    roadsDetail: 100,
  },
};

export function parseRuntimeConfig(search) {
  const params = new URLSearchParams(search || '');

  const modeRaw = params.get('mode');
  const mode = modeRaw === 'chill' || modeRaw === 'debug' ? modeRaw : null;
  const preset = mode ? PRESET_CONFIG[mode] : null;
  const base = { ...DEFAULT_CONFIG, ...(preset || {}) };

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
    if (raw === '0') return 0;
    if (raw === '1') return 1;
    return def01;
  };

  const readEnum = (name, def, allowed) => {
    const raw = params.get(name);
    if (raw == null) return def;
    return allowed.has(raw) ? raw : def;
  };

  const stepsPerSecond = readInt('sps', base.stepsPerSecond, 1, 120);
  const maxStepsPerFrame = readInt('maxStepsPerFrame', base.maxStepsPerFrame, 1, 500);

  const hud = read01('hud', read01('showHud', base.hud));
  const endpointMode = readEnum('endpointMode', base.endpointMode, new Set(['roads', 'random']));
  const graph = readEnum('graph', base.graph, new Set(['roads', 'grid']));
  const soak = read01('soak', base.soak);
  const roadsDetail = readInt('roadsDetail', base.roadsDetail, 0, 100);

  const seed = params.get('seed') ?? base.seed;
  const centerLatRaw = params.get('centerLat');
  const centerLonRaw = params.get('centerLon');
  const centerLat = centerLatRaw == null ? base.centerLat : Number.parseFloat(centerLatRaw);
  const centerLon = centerLonRaw == null ? base.centerLon : Number.parseFloat(centerLonRaw);
  const centerLatOk = Number.isFinite(centerLat);
  const centerLonOk = Number.isFinite(centerLon);
  const rotation = readFloat('rotation', base.rotation ?? 0, -180, 180);

  // End animation timing
  // - Legacy endAnimMs is still supported.
  // - If endTraceMs/endGlowMs not provided, split endAnimMs 60/40 by default.
  const endAnimMs = readInt('endAnimMs', base.endAnimMs, 0, 60000);
  const endTraceMs = readInt('endTraceMs', Math.round(endAnimMs * 0.6), 0, 60000);
  const endGlowMs = readInt('endGlowMs', Math.max(0, endAnimMs - endTraceMs), 0, 60000);

  return {
    ...base,
    mode,
    stepsPerSecond,
    maxStepsPerFrame,
    // use a delay to drive the fixed-rate stepping loop
    stepDelayMs: 1000 / stepsPerSecond,
    zoom: readFloat('zoom', base.zoom, 0.5, 50.0),
    hud,
    endpointMode,
    graph,
    soak,
    roadsDetail,
    seed,
    centerLat: centerLatOk ? centerLat : null,
    centerLon: centerLonOk ? centerLon : null,
    rotation,
    endHoldMs: readInt('endHoldMs', base.endHoldMs, 0, 60000),
    endAnimMs,
    endTraceMs,
    endGlowMs,
    minStartEndMeters: readInt('minStartEndMeters', base.minStartEndMeters, 0, 200000),

    showOpenClosed: read01('showOpenClosed', base.showOpenClosed),
    showCurrent: read01('showCurrent', base.showCurrent),
    showPathDuringSearch: read01('showPathDuringSearch', base.showPathDuringSearch),
    showRoads: read01('showRoads', base.showRoads),
    showTerrain: read01('showTerrain', base.showTerrain),
  };
}
