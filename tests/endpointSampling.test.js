import test from "node:test";
import assert from "node:assert/strict";

import { sampleEndpointPair } from "../main.js";

function makeRng(values) {
  let i = 0;
  return () => {
    const v = values[i % values.length];
    i++;
    return v;
  };
}

test("endpoint sampling: returns first pair that meets min distance within maxTries", () => {
  const keys = ["A", "B", "C"]; // chosen via rng
  const rng = makeRng([
    0.01, // A
    0.34, // B  -> try 1: A-B (distance 1) fails
    0.02, // A
    0.99, // C  -> try 2: A-C (distance 100) meets
  ]);

  const randomKey = (r) => keys[Math.floor(r() * keys.length)];

  const pos = {
    A: { x: 0, y: 0 },
    B: { x: 1, y: 0 },
    C: { x: 100, y: 0 },
  };

  const r = sampleEndpointPair({
    randomKey,
    toLatLon: (k) => pos[k],
    distanceFn: (p, q) => Math.hypot(p.x - q.x, p.y - q.y),
    minMeters: 50,
    maxTries: 10,
    rng,
  });

  assert.equal(r.minDistanceMet, true);
  assert.equal(r.tries, 2);
  assert.equal(r.distanceMeters, 100);
  assert.ok(
    (r.startKey === "A" && r.goalKey === "C") || (r.startKey === "C" && r.goalKey === "A"),
    "expected first satisfying pair to be A-C"
  );
});

test("endpoint sampling: when constraint cannot be met, returns max-distance pair and flags best-effort", () => {
  const seq = ["A", "B", "A", "C", "B", "C"]; // 3 tries: AB, AC, BC
  const randomKey = () => seq.shift();

  const pos = {
    A: { x: 0, y: 0 },
    B: { x: 5, y: 0 },
    C: { x: 9, y: 0 },
  };

  const r = sampleEndpointPair({
    randomKey,
    toLatLon: (k) => pos[k],
    distanceFn: (p, q) => Math.abs(p.x - q.x),
    minMeters: 20, // impossible given max distance 9
    maxTries: 3,
    rng: () => 0.5,
  });

  assert.equal(r.minDistanceMet, false);
  assert.equal(r.distanceMeters, 9);
  assert.equal(new Set([r.startKey, r.goalKey]).size, 2);
  assert.ok(
    (r.startKey === "A" && r.goalKey === "C") || (r.startKey === "C" && r.goalKey === "A"),
    "expected best-effort max-distance pair to be A-C"
  );
});
