import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RUNTIME, parseRuntimeConfig } from '../config.js';

test('parseRuntimeConfig clamps values and falls back on invalid inputs', ()=>{
  const { runtime, warnings } = parseRuntimeConfig(
    '?zoom=999&stepsPerSecond=-5&endHoldMs=abc&endAnimMs=50&minStartEndMeters=-10&hud=maybe&bounds=notapreset',
    DEFAULT_RUNTIME
  );

  // clamps
  assert.equal(runtime.zoom, 6.0);
  assert.equal(runtime.stepsPerSecond, 1);
  assert.equal(runtime.endAnimMs, 50);
  assert.equal(runtime.minStartEndMeters, 0);

  // invalids fall back to defaults
  assert.equal(runtime.endHoldMs, DEFAULT_RUNTIME.endHoldMs);
  assert.equal(runtime.hud, DEFAULT_RUNTIME.hud);
  assert.equal(runtime.bounds, DEFAULT_RUNTIME.bounds);

  assert.ok(warnings.length >= 3);
});
