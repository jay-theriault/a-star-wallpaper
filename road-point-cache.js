import { extractRoadLines } from './roads-data.js';
import { inBoundsLatLon, key } from './grid-helpers.js';

export const ROAD_POINT_STRIDE = 2;
export const MAX_ROAD_POINTS = 7000;

export function latLonToCellKey(lat, lon, bounds, cols, rows) {
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

export function buildRoadPointCacheFromGeojson(
  geojson,
  bounds,
  cols,
  rows,
  { stride = ROAD_POINT_STRIDE, maxPoints = MAX_ROAD_POINTS } = {},
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

export function buildRoadPointCacheFromGraph(
  graph,
  bounds,
  cols,
  rows,
  { maxPoints = MAX_ROAD_POINTS } = {},
) {
  if (!graph?.nodes?.length) return { points: [], keys: [] };
  const points = [];
  for (const node of graph.nodes) {
    const lat = node?.lat;
    const lon = node?.lon;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (!inBoundsLatLon(lat, lon, bounds)) continue;
    points.push({ lat, lon });
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
