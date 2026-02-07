import test from 'node:test';
import assert from 'node:assert/strict';
import { makeAStarStepper } from '../astar.js';

function gridKey(i, j) {
  return `${i},${j}`;
}
function parseKey(k) {
  const [i, j] = k.split(',').map(Number);
  return { i, j };
}

function makeGrid({ cols, rows }) {
  const inBounds = (i, j) => i >= 0 && j >= 0 && i < cols && j < rows;
  const neighbors = (k) => {
    const { i, j } = parseKey(k);
    const out = [];
    for (const [di, dj] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const ni = i + di,
        nj = j + dj;
      if (inBounds(ni, nj)) out.push(gridKey(ni, nj));
    }
    return out;
  };
  const cost = () => 1;
  const heuristic = (a, g) => {
    const A = parseKey(a),
      G = parseKey(g);
    return Math.abs(A.i - G.i) + Math.abs(A.j - G.j);
  };
  return {
    neighbors,
    cost,
    heuristic,
    isValidNode: (k) => {
      const { i, j } = parseKey(k);
      return inBounds(i, j);
    },
  };
}

function runToEnd(stepper, maxIters = 1e6) {
  for (let i = 0; i < maxIters; i++) {
    const r = stepper.step();
    if (r.done) return r;
  }
  throw new Error('did not terminate');
}

function isNeighbor(a, b, neighbors) {
  return neighbors(a).includes(b);
}

test('A* finds shortest path on empty grid (Manhattan)', () => {
  const { neighbors, cost, heuristic, isValidNode } = makeGrid({ cols: 10, rows: 10 });
  const start = gridKey(0, 0);
  const goal = gridKey(9, 9);
  const stepper = makeAStarStepper({
    startKey: start,
    goalKey: goal,
    neighbors,
    cost,
    heuristic,
    isValidNode,
  });
  const r = runToEnd(stepper);
  assert.equal(r.status, 'found');
  // shortest length in nodes is 19 (18 moves)
  assert.equal(r.path.length, 19);
  // path adjacency
  for (let i = 1; i < r.path.length; i++)
    assert.ok(isNeighbor(r.path[i - 1], r.path[i], neighbors));
});

test('A* returns invalid-endpoints when endpoints fail validation', () => {
  const { neighbors, cost, heuristic, isValidNode } = makeGrid({ cols: 5, rows: 5 });
  const stepper = makeAStarStepper({
    startKey: '99,99',
    goalKey: gridKey(1, 1),
    neighbors,
    cost,
    heuristic,
    isValidNode,
  });
  const r = stepper.step();
  assert.equal(r.done, true);
  assert.equal(r.status, 'invalid-endpoints');
});

test('A* stops with max-steps', () => {
  const { neighbors, cost, heuristic, isValidNode } = makeGrid({ cols: 50, rows: 50 });
  const stepper = makeAStarStepper({
    startKey: gridKey(0, 0),
    goalKey: gridKey(49, 49),
    neighbors,
    cost,
    heuristic,
    isValidNode,
    maxSteps: 10,
  });
  const r = runToEnd(stepper, 1000);
  assert.equal(r.status, 'max-steps');
});
