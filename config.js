// Runtime config parsing + small geo framing helpers.
// Keep this buildless: pure JS utilities consumed by main.js and node tests.

export const BOUNDS_PRESETS = {
  // Greater Boston (prototype)
  boston: {
    north: 42.55,
    south: 42.2,
    west: -71.35,
    east: -70.85,
  },
};

export const DEFAULT_RUNTIME = {
  bounds: "boston",
  zoom: 1.0,
  stepsPerSecond: 20,
  endHoldMs: 1800,
  endAnimMs: 1200,
  minStartEndMeters: 7000,
  hud: true,

  // Endpoint sampling behavior
  endpointTries: 5000,
};

export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function parseBoolish(v) {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
  if (["1", "true", "t", "yes", "y", "on"].includes(s)) return true;
  if (["0", "false", "f", "no", "n", "off"].includes(s)) return false;
  return null;
}

function parseFiniteNumber(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse runtime config from a query string.
 *
 * Supported params (documented):
 * - bounds: preset name (e.g. "boston")
 * - zoom
 * - stepsPerSecond
 * - endHoldMs
 * - endAnimMs
 * - minStartEndMeters
 * - hud
 *
 * Returns: { runtime, warnings }
 */
export function parseRuntimeConfig(search, defaults = DEFAULT_RUNTIME) {
  const warnings = [];
  const sp = new URLSearchParams((search ?? "").startsWith("?") ? search : `?${search ?? ""}`);

  const out = { ...defaults };

  // bounds preset
  if (sp.has("bounds")) {
    const name = String(sp.get("bounds") ?? "").trim().toLowerCase();
    if (name && BOUNDS_PRESETS[name]) out.bounds = name;
    else warnings.push(`Invalid bounds preset: "${name}" (using "${defaults.bounds}")`);
  }

  // zoom
  if (sp.has("zoom")) {
    const z = parseFiniteNumber(sp.get("zoom"));
    if (z == null) warnings.push(`Invalid zoom: "${sp.get("zoom")}" (using ${defaults.zoom})`);
    else out.zoom = clamp(z, 0.25, 6.0);
  }

  // stepsPerSecond
  if (sp.has("stepsPerSecond")) {
    const sps = parseFiniteNumber(sp.get("stepsPerSecond"));
    if (sps == null) warnings.push(`Invalid stepsPerSecond: "${sp.get("stepsPerSecond")}" (using ${defaults.stepsPerSecond})`);
    else out.stepsPerSecond = clamp(sps, 1, 240);
  }
  // Back-compat alias (not documented in v0.2): sps
  if (!sp.has("stepsPerSecond") && sp.has("sps")) {
    const sps = parseFiniteNumber(sp.get("sps"));
    if (sps != null) out.stepsPerSecond = clamp(sps, 1, 240);
  }

  // end timings
  if (sp.has("endHoldMs")) {
    const v = parseFiniteNumber(sp.get("endHoldMs"));
    if (v == null) warnings.push(`Invalid endHoldMs: "${sp.get("endHoldMs")}" (using ${defaults.endHoldMs})`);
    else out.endHoldMs = clamp(v, 0, 60000);
  }

  if (sp.has("endAnimMs")) {
    const v = parseFiniteNumber(sp.get("endAnimMs"));
    if (v == null) warnings.push(`Invalid endAnimMs: "${sp.get("endAnimMs")}" (using ${defaults.endAnimMs})`);
    else out.endAnimMs = clamp(v, 0, 60000);
  }

  if (sp.has("minStartEndMeters")) {
    const v = parseFiniteNumber(sp.get("minStartEndMeters"));
    if (v == null)
      warnings.push(`Invalid minStartEndMeters: "${sp.get("minStartEndMeters")}" (using ${defaults.minStartEndMeters})`);
    else out.minStartEndMeters = clamp(v, 0, 200000);
  }

  if (sp.has("hud")) {
    const b = parseBoolish(sp.get("hud"));
    if (b == null) warnings.push(`Invalid hud: "${sp.get("hud")}" (using ${defaults.hud ? 1 : 0})`);
    else out.hud = b;
  }

  return { runtime: out, warnings };
}

export function bboxCenter(bounds) {
  return {
    lat: (bounds.north + bounds.south) / 2,
    lon: (bounds.east + bounds.west) / 2,
  };
}

/**
 * Aspect-ratio-aware framing around a fixed center.
 *
 * The "base" bounds define the unzoomed extent. We apply zoom, then expand
 * either latitude or longitude span so that projected meters roughly match the
 * screen aspect ratio. (Uses cos(latitude) correction for longitude.)
 */
export function framedBounds({ baseBounds, center, zoom, aspect }) {
  const z = Math.max(1e-6, zoom);
  let latSpan = (baseBounds.north - baseBounds.south) / z;
  let lonSpan = (baseBounds.east - baseBounds.west) / z;

  const latC = center.lat;
  const cosLat = Math.max(0.15, Math.cos((latC * Math.PI) / 180));

  const currentAspect = (lonSpan * cosLat) / Math.max(1e-9, latSpan);
  if (Number.isFinite(aspect) && aspect > 0) {
    if (currentAspect < aspect) {
      // Too tall: widen lon span.
      lonSpan = (aspect * latSpan) / cosLat;
    } else if (currentAspect > aspect) {
      // Too wide: increase lat span.
      latSpan = (lonSpan * cosLat) / aspect;
    }
  }

  return {
    north: center.lat + latSpan / 2,
    south: center.lat - latSpan / 2,
    west: center.lon - lonSpan / 2,
    east: center.lon + lonSpan / 2,
  };
}
