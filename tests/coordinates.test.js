import test from 'node:test';
import assert from 'node:assert/strict';

import { bboxCenter, applyZoom, getRenderBounds, project, makeProjector } from '../coordinates.js';

const BOUNDS = {
  north: 42.55,
  south: 42.2,
  west: -71.35,
  east: -70.85,
};

// --- bboxCenter ---

test('bboxCenter returns midpoint of bounds', () => {
  const c = bboxCenter(BOUNDS);
  assert.equal(c.lat, (42.55 + 42.2) / 2);
  assert.equal(c.lon, (-71.35 + -70.85) / 2);
});

// --- applyZoom ---

test('applyZoom at zoom=1 returns original bounds span', () => {
  const z = applyZoom(BOUNDS, 1);
  const latSpan = z.north - z.south;
  const lonSpan = z.east - z.west;
  assert.ok(Math.abs(latSpan - (BOUNDS.north - BOUNDS.south)) < 1e-10);
  assert.ok(Math.abs(lonSpan - (BOUNDS.east - BOUNDS.west)) < 1e-10);
});

test('applyZoom at zoom=2 halves the span, centered on original center', () => {
  const z = applyZoom(BOUNDS, 2);
  const latSpan = z.north - z.south;
  const lonSpan = z.east - z.west;
  const origLatSpan = BOUNDS.north - BOUNDS.south;
  const origLonSpan = BOUNDS.east - BOUNDS.west;
  assert.ok(Math.abs(latSpan - origLatSpan / 2) < 1e-10);
  assert.ok(Math.abs(lonSpan - origLonSpan / 2) < 1e-10);

  // Center should remain the same
  const c = bboxCenter(BOUNDS);
  const zc = bboxCenter(z);
  assert.ok(Math.abs(zc.lat - c.lat) < 1e-10);
  assert.ok(Math.abs(zc.lon - c.lon) < 1e-10);
});

test('applyZoom with custom center shifts correctly', () => {
  const customCenter = { lat: 42.36, lon: -71.06 };
  const z = applyZoom(BOUNDS, 2, customCenter);
  const zc = bboxCenter(z);
  assert.ok(Math.abs(zc.lat - customCenter.lat) < 1e-10);
  assert.ok(Math.abs(zc.lon - customCenter.lon) < 1e-10);
});

// --- getRenderBounds ---

test('getRenderBounds maintains aspect ratio with wider viewport', () => {
  const rb = getRenderBounds(BOUNDS, 1920, 1080);
  const c = bboxCenter(BOUNDS);
  const cosLat = Math.cos((c.lat * Math.PI) / 180);

  const rbLatSpan = rb.north - rb.south;
  const rbLonSpan = rb.east - rb.west;
  const rbAspect = (rbLonSpan * cosLat) / rbLatSpan;
  const viewAspect = 1920 / 1080;
  assert.ok(Math.abs(rbAspect - viewAspect) < 1e-6);
});

test('getRenderBounds maintains aspect ratio with taller viewport', () => {
  const rb = getRenderBounds(BOUNDS, 1080, 1920);
  const c = bboxCenter(BOUNDS);
  const cosLat = Math.cos((c.lat * Math.PI) / 180);

  const rbLatSpan = rb.north - rb.south;
  const rbLonSpan = rb.east - rb.west;
  const rbAspect = (rbLonSpan * cosLat) / rbLatSpan;
  const viewAspect = 1080 / 1920;
  assert.ok(Math.abs(rbAspect - viewAspect) < 1e-6);
});

// --- project ---

test('project maps center of bounds to center of canvas at rotation=0', () => {
  const c = bboxCenter(BOUNDS);
  const w = 800;
  const h = 600;
  const p = project(c.lat, c.lon, BOUNDS, w, h, 0);
  assert.ok(Math.abs(p.x - w / 2) < 1e-6);
  assert.ok(Math.abs(p.y - h / 2) < 1e-6);
});

test('project with rotation=0 vs rotation=90: center stays fixed, corners move', () => {
  const c = bboxCenter(BOUNDS);
  const w = 800;
  const h = 600;

  // Center should stay at (w/2, h/2) for both rotations
  const p0 = project(c.lat, c.lon, BOUNDS, w, h, 0);
  const p90 = project(c.lat, c.lon, BOUNDS, w, h, 90);
  assert.ok(Math.abs(p0.x - w / 2) < 1e-6);
  assert.ok(Math.abs(p0.y - h / 2) < 1e-6);
  assert.ok(Math.abs(p90.x - w / 2) < 1e-6);
  assert.ok(Math.abs(p90.y - h / 2) < 1e-6);

  // A non-center point should move under rotation
  const corner0 = project(BOUNDS.north, BOUNDS.west, BOUNDS, w, h, 0);
  const corner90 = project(BOUNDS.north, BOUNDS.west, BOUNDS, w, h, 90);
  const moved = Math.abs(corner0.x - corner90.x) > 1 || Math.abs(corner0.y - corner90.y) > 1;
  assert.ok(moved, 'corner should move under 90 degree rotation');
});

// --- makeProjector ---

test('makeProjector produces same results as project (no rotation)', () => {
  const w = 800;
  const h = 600;
  const proj = makeProjector(BOUNDS, w, h, 0);

  const testPoints = [
    { lat: BOUNDS.north, lon: BOUNDS.west },
    { lat: BOUNDS.south, lon: BOUNDS.east },
    { lat: 42.36, lon: -71.06 },
  ];

  for (const { lat, lon } of testPoints) {
    const a = project(lat, lon, BOUNDS, w, h, 0);
    const b = proj(lat, lon);
    assert.ok(Math.abs(a.x - b.x) < 1e-6, `x mismatch at (${lat},${lon})`);
    assert.ok(Math.abs(a.y - b.y) < 1e-6, `y mismatch at (${lat},${lon})`);
  }
});

test('makeProjector produces same results as project (with rotation)', () => {
  const w = 800;
  const h = 600;
  const rotation = 45;
  const proj = makeProjector(BOUNDS, w, h, rotation);

  const testPoints = [
    { lat: BOUNDS.north, lon: BOUNDS.west },
    { lat: BOUNDS.south, lon: BOUNDS.east },
    { lat: 42.36, lon: -71.06 },
  ];

  for (const { lat, lon } of testPoints) {
    const a = project(lat, lon, BOUNDS, w, h, rotation);
    const b = proj(lat, lon);
    assert.ok(Math.abs(a.x - b.x) < 1e-6, `x mismatch at (${lat},${lon})`);
    assert.ok(Math.abs(a.y - b.y) < 1e-6, `y mismatch at (${lat},${lon})`);
  }
});
