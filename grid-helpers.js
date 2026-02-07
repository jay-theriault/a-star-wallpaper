import { haversineMeters } from './astar.js';

// --- Roads + grid helpers ---
export function inBoundsLatLon(lat, lon, bounds) {
  return lat <= bounds.north && lat >= bounds.south && lon >= bounds.west && lon <= bounds.east;
}

export function key(i, j) {
  return `${i},${j}`;
}

export function parseKey(k) {
  const [i, j] = k.split(',').map((n) => parseInt(n, 10));
  return { i, j };
}

// --- Grid graph (prototype) ---
// We map grid cells to lat/lon centers inside the bounds.
export function cellLatLon(i, j, bounds, gridCols, gridRows) {
  const lat = bounds.north - (j + 0.5) * ((bounds.north - bounds.south) / gridRows);
  const lon = bounds.west + (i + 0.5) * ((bounds.east - bounds.west) / gridCols);
  return { lat, lon };
}

export function neighborsOf(k, gridCols, gridRows) {
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
    if (ni < 0 || nj < 0 || ni >= gridCols || nj >= gridRows) continue;
    out.push(key(ni, nj));
  }
  return out;
}

export function cost(aKey, bKey, bounds, gridCols, gridRows) {
  const a = cellLatLon(...Object.values(parseKey(aKey)), bounds, gridCols, gridRows);
  const b = cellLatLon(...Object.values(parseKey(bKey)), bounds, gridCols, gridRows);
  return haversineMeters(a, b);
}

export function heuristic(aKey, goalKey, bounds, gridCols, gridRows) {
  const a = cellLatLon(...Object.values(parseKey(aKey)), bounds, gridCols, gridRows);
  const g = cellLatLon(...Object.values(parseKey(goalKey)), bounds, gridCols, gridRows);
  return haversineMeters(a, g);
}

export function randomCell(bounds, gridCols, gridRows, rng = Math.random) {
  // uniform in grid for prototype
  const i = Math.floor(rng() * gridCols);
  const j = Math.floor(rng() * gridRows);
  const ll = cellLatLon(i, j, bounds, gridCols, gridRows);
  if (!inBoundsLatLon(ll.lat, ll.lon, bounds)) return randomCell(bounds, gridCols, gridRows, rng);
  return key(i, j);
}
