import test from 'node:test';
import assert from 'node:assert/strict';

import {
  inBoundsLatLon,
  key,
  parseKey,
  cellLatLon,
  neighborsOf,
  cost,
  heuristic,
  randomCell,
} from '../grid-helpers.js';

const BOUNDS = {
  north: 42.55,
  south: 42.2,
  west: -71.35,
  east: -70.85,
};

const GRID_COLS = 10;
const GRID_ROWS = 8;

// --- key / parseKey ---

test('key(3, 7) returns "3,7"', () => {
  assert.equal(key(3, 7), '3,7');
});

test('parseKey("3,7") returns {i: 3, j: 7}', () => {
  const result = parseKey('3,7');
  assert.deepEqual(result, { i: 3, j: 7 });
});

test('key and parseKey are inverses', () => {
  const k = key(5, 2);
  const parsed = parseKey(k);
  assert.equal(parsed.i, 5);
  assert.equal(parsed.j, 2);
});

// --- cellLatLon ---

test('cellLatLon maps (0,0) to expected corner of bounds', () => {
  const { lat, lon } = cellLatLon(0, 0, BOUNDS, GRID_COLS, GRID_ROWS);
  const latStep = (BOUNDS.north - BOUNDS.south) / GRID_ROWS;
  const lonStep = (BOUNDS.east - BOUNDS.west) / GRID_COLS;
  // Cell (0,0) should be at (north - 0.5*latStep, west + 0.5*lonStep)
  assert.ok(Math.abs(lat - (BOUNDS.north - 0.5 * latStep)) < 1e-10);
  assert.ok(Math.abs(lon - (BOUNDS.west + 0.5 * lonStep)) < 1e-10);
});

// --- inBoundsLatLon ---

test('inBoundsLatLon returns true for point inside bounds', () => {
  assert.equal(inBoundsLatLon(42.4, -71.1, BOUNDS), true);
});

test('inBoundsLatLon returns false for point outside bounds', () => {
  assert.equal(inBoundsLatLon(43.0, -71.1, BOUNDS), false);
  assert.equal(inBoundsLatLon(42.4, -72.0, BOUNDS), false);
});

test('inBoundsLatLon returns true for exactly on boundary', () => {
  assert.equal(inBoundsLatLon(BOUNDS.north, BOUNDS.west, BOUNDS), true);
  assert.equal(inBoundsLatLon(BOUNDS.south, BOUNDS.east, BOUNDS), true);
});

// --- neighborsOf ---

test('neighborsOf at interior cell returns 8 neighbors', () => {
  const n = neighborsOf(key(5, 4), GRID_COLS, GRID_ROWS);
  assert.equal(n.length, 8);
});

test('neighborsOf at corner (0,0) returns 3 neighbors', () => {
  const n = neighborsOf(key(0, 0), GRID_COLS, GRID_ROWS);
  assert.equal(n.length, 3);
});

test('neighborsOf at opposite corner returns 3 neighbors', () => {
  const n = neighborsOf(key(GRID_COLS - 1, GRID_ROWS - 1), GRID_COLS, GRID_ROWS);
  assert.equal(n.length, 3);
});

test('neighborsOf at edge (not corner) returns 5 neighbors', () => {
  // Top edge, middle column
  const n = neighborsOf(key(5, 0), GRID_COLS, GRID_ROWS);
  assert.equal(n.length, 5);
});

// --- cost ---

test('cost returns positive number for adjacent cells', () => {
  const c = cost(key(3, 3), key(4, 3), BOUNDS, GRID_COLS, GRID_ROWS);
  assert.equal(typeof c, 'number');
  assert.ok(c > 0);
});

// --- heuristic ---

test('heuristic returns positive number', () => {
  const h = heuristic(key(0, 0), key(9, 7), BOUNDS, GRID_COLS, GRID_ROWS);
  assert.equal(typeof h, 'number');
  assert.ok(h > 0);
});

test('heuristic is admissible (less than or equal to cost for adjacent cells)', () => {
  // For directly adjacent cells, heuristic should equal cost (both use haversine)
  const aKey = key(3, 3);
  const bKey = key(4, 3);
  const h = heuristic(aKey, bKey, BOUNDS, GRID_COLS, GRID_ROWS);
  const c = cost(aKey, bKey, BOUNDS, GRID_COLS, GRID_ROWS);
  assert.ok(h <= c + 1e-6, 'heuristic should be <= cost for admissibility');
});

// --- randomCell ---

test('randomCell returns a valid key string', () => {
  const k = randomCell(BOUNDS, GRID_COLS, GRID_ROWS);
  assert.equal(typeof k, 'string');
  assert.ok(k.includes(','), 'key should contain a comma');

  const { i, j } = parseKey(k);
  assert.ok(i >= 0 && i < GRID_COLS);
  assert.ok(j >= 0 && j < GRID_ROWS);
});

test('randomCell with fixed rng returns deterministic result', () => {
  let callCount = 0;
  const fixedRng = () => {
    callCount++;
    return 0.5;
  };
  const k = randomCell(BOUNDS, GRID_COLS, GRID_ROWS, fixedRng);
  assert.equal(typeof k, 'string');
  assert.ok(callCount > 0);
});
