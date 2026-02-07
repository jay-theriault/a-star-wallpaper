import test from 'node:test';
import assert from 'node:assert/strict';
import { stepEndPhase } from '../endPhase.js';

test('stepEndPhase transitions through end phases with carry', () => {
  const config = { endHoldMs: 100, endTraceMs: 200, endGlowMs: 300 };

  let state = { phase: 'end-hold', phaseT: 0 };
  state = stepEndPhase(state, 50, config);
  assert.equal(state.phase, 'end-hold');
  assert.equal(state.phaseT, 50);
  assert.equal(state.done, false);

  state = stepEndPhase(state, 60, config);
  assert.equal(state.phase, 'end-trace');
  assert.equal(state.phaseT, 10);

  state = stepEndPhase(state, 250, config);
  assert.equal(state.phase, 'end-glow');
  assert.equal(state.phaseT, 60);

  state = stepEndPhase(state, 400, config);
  assert.equal(state.done, true);
});

test('stepEndPhase skips zero-duration phases', () => {
  const config = { endHoldMs: 0, endTraceMs: 0, endGlowMs: 10 };

  let state = { phase: 'end-hold', phaseT: 0 };
  state = stepEndPhase(state, 0, config);
  assert.equal(state.phase, 'end-glow');
  assert.equal(state.phaseT, 0);
  assert.equal(state.done, false);

  state = stepEndPhase(state, 10, config);
  assert.equal(state.done, true);
});
