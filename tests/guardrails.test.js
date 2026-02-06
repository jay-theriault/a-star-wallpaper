import test from "node:test";
import assert from "node:assert/strict";

import { updateGuardrails } from "../guardrails.js";

test("guardrails: trigger relaxation after consecutive failures", () => {
  const limits = {
    maxConsecutiveFailures: 2,
    maxConsecutiveResamples: 3,
    relaxCycles: 2,
    relaxedMinStartEndMeters: 1000,
  };

  const s0 = { consecutiveFailures: 0, consecutiveResamples: 0, relaxCyclesRemaining: 0 };
  const r1 = updateGuardrails(s0, "failure", limits);
  assert.equal(r1.triggered, false);
  assert.equal(r1.state.consecutiveFailures, 1);
  assert.equal(r1.state.relaxCyclesRemaining, 0);

  const r2 = updateGuardrails(r1.state, "failure", limits);
  assert.equal(r2.triggered, true);
  assert.equal(r2.state.consecutiveFailures, 0);
  assert.equal(r2.state.relaxCyclesRemaining, 2);
});
