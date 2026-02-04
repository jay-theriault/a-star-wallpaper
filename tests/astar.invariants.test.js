import test from 'node:test';
import assert from 'node:assert/strict';
import { makeAStarStepper } from '../astar.js';

function runToEnd(stepper, maxIters = 1e6) {
  for (let i = 0; i < maxIters; i++) {
    const r = stepper.step();
    if (r.done) return r;
  }
  throw new Error('did not terminate');
}

function pathCost(path, cost) {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += cost(path[i - 1], path[i]);
  return total;
}

test('A* path starts at startKey and ends at goalKey (when found)', () => {
  // Simple line graph: A -> B -> C
  const neighbors = (k) => (k === 'A' ? ['B'] : k === 'B' ? ['A', 'C'] : ['B']);
  const cost = () => 1;
  const heuristic = () => 0;
  const isValidNode = (k) => ['A', 'B', 'C'].includes(k);

  const stepper = makeAStarStepper({
    startKey: 'A',
    goalKey: 'C',
    neighbors,
    cost,
    heuristic,
    isValidNode,
  });

  const r = runToEnd(stepper);
  assert.equal(r.status, 'found');
  assert.equal(r.path[0], 'A');
  assert.equal(r.path[r.path.length - 1], 'C');
});

test('A* returns no-path when graph is disconnected (but endpoints valid)', () => {
  // Two isolated nodes with no edges.
  const neighbors = () => [];
  const cost = () => 1;
  const heuristic = () => 0;
  const isValidNode = (k) => k === 'A' || k === 'B';

  const stepper = makeAStarStepper({
    startKey: 'A',
    goalKey: 'B',
    neighbors,
    cost,
    heuristic,
    isValidNode,
  });

  const r = runToEnd(stepper, 10);
  assert.equal(r.status, 'no-path');
});

test('A* prefers lower total cost over fewer steps when heuristic is admissible (zero)', () => {
  // Graph:
  //   A --(100)--> G
  //   A -> B -> C -> G (each cost 1)
  // Shorter in steps is expensive; longer is cheaper.
  const edges = new Map([
    ['A', ['G', 'B']],
    ['B', ['C']],
    ['C', ['G']],
    ['G', []],
  ]);
  const neighbors = (k) => edges.get(k) ?? [];
  const cost = (a, b) => (a === 'A' && b === 'G' ? 100 : 1);
  const heuristic = () => 0; // ensures optimality for arbitrary non-negative costs
  const isValidNode = (k) => edges.has(k);

  const stepper = makeAStarStepper({
    startKey: 'A',
    goalKey: 'G',
    neighbors,
    cost,
    heuristic,
    isValidNode,
  });

  const r = runToEnd(stepper);
  assert.equal(r.status, 'found');
  assert.deepEqual(r.path, ['A', 'B', 'C', 'G']);
  assert.equal(pathCost(r.path, cost), 3);
});

test('A* returns invalid-endpoints when goal fails validation', () => {
  const neighbors = () => [];
  const cost = () => 1;
  const heuristic = () => 0;
  const isValidNode = (k) => k === 'A';

  const stepper = makeAStarStepper({
    startKey: 'A',
    goalKey: 'B',
    neighbors,
    cost,
    heuristic,
    isValidNode,
  });

  const r = stepper.step();
  assert.equal(r.done, true);
  assert.equal(r.status, 'invalid-endpoints');
});

test('A* max-steps result includes step count (equals maxSteps)', () => {
  // A long line; maxSteps should stop the search.
  const N = 100;
  const startKey = 0;
  const goalKey = N - 1;
  const neighbors = (k) => {
    const out = [];
    if (k > 0) out.push(k - 1);
    if (k < N - 1) out.push(k + 1);
    return out;
  };
  const cost = () => 1;
  const heuristic = () => 0;
  const isValidNode = (k) => Number.isInteger(k) && k >= 0 && k < N;

  const maxSteps = 10;
  const stepper = makeAStarStepper({
    startKey,
    goalKey,
    neighbors,
    cost,
    heuristic,
    isValidNode,
    maxSteps,
  });

  const r = runToEnd(stepper, 1000);
  assert.equal(r.status, 'max-steps');
  assert.equal(r.steps, maxSteps);
});
