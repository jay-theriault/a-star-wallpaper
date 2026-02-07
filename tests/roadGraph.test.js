import test from 'node:test';
import assert from 'node:assert/strict';

import { buildRoadGraph, findNearestGraphNode, graphNodeLatLon } from '../road-graph.js';
import { haversineMeters, makeAStarStepper } from '../astar.js';

test('road graph: builds nodes/edges and finds shortest path', () => {
  const lines = [
    [
      [0, 0],
      [0, 1],
      [0, 2],
    ],
    [
      [0, 1],
      [1, 1],
    ],
  ];

  const graph = buildRoadGraph(lines, { toleranceMeters: 0.1, contract: false });

  assert.equal(graph.nodes.length, 4, 'expected 4 unique nodes');
  assert.equal(graph.edges, 6, 'expected 3 undirected edges (6 directed)');

  const start = findNearestGraphNode(graph, 0, 0);
  const goal = findNearestGraphNode(graph, 2, 0);
  assert.notEqual(start, null);
  assert.notEqual(goal, null);

  const stepper = makeAStarStepper({
    startKey: start,
    goalKey: goal,
    neighbors: (k) => graph.adjacency[k].map((edge) => edge.to),
    cost: (a, b) => graph.costMaps[a]?.get(b) ?? Infinity,
    heuristic: (a, g) => haversineMeters(graphNodeLatLon(graph, a), graphNodeLatLon(graph, g)),
  });

  let result = null;
  for (let i = 0; i < 50; i++) {
    const r = stepper.step();
    if (r.done) {
      result = r;
      break;
    }
  }

  assert.ok(result, 'expected A* to finish');
  assert.equal(result.status, 'found');
  assert.equal(result.path.length, 3, 'expected path with 3 nodes');
});

test('road graph: oneway=yes creates forward-only edge', () => {
  const lines = [
    {
      coords: [
        [0, 0],
        [1, 0],
      ],
      oneway: 'yes',
    },
  ];

  const graph = buildRoadGraph(lines, { toleranceMeters: 0.1, contract: false });

  assert.equal(graph.nodes.length, 2);

  const nodeA = findNearestGraphNode(graph, 0, 0);
  const nodeB = findNearestGraphNode(graph, 0, 1);

  // A→B should exist.
  assert.ok(graph.costMaps[nodeA].has(nodeB), 'A→B edge should exist');
  // B→A should not exist.
  assert.ok(!graph.costMaps[nodeB].has(nodeA), 'B→A edge should not exist');
});

test('road graph: oneway=-1 creates reverse-only edge', () => {
  const lines = [
    {
      coords: [
        [0, 0],
        [1, 0],
      ],
      oneway: '-1',
    },
  ];

  const graph = buildRoadGraph(lines, { toleranceMeters: 0.1, contract: false });

  assert.equal(graph.nodes.length, 2);

  const nodeA = findNearestGraphNode(graph, 0, 0);
  const nodeB = findNearestGraphNode(graph, 0, 1);

  // B→A should exist (reverse of digitization direction).
  assert.ok(graph.costMaps[nodeB].has(nodeA), 'B→A edge should exist');
  // A→B should not exist.
  assert.ok(!graph.costMaps[nodeA].has(nodeB), 'A→B edge should not exist');
});

test('road graph: oneway=null creates bidirectional edges', () => {
  const lines = [
    {
      coords: [
        [0, 0],
        [1, 0],
      ],
      oneway: null,
    },
  ];

  const graph = buildRoadGraph(lines, { toleranceMeters: 0.1, contract: false });

  const nodeA = findNearestGraphNode(graph, 0, 0);
  const nodeB = findNearestGraphNode(graph, 0, 1);

  assert.ok(graph.costMaps[nodeA].has(nodeB), 'A→B edge should exist');
  assert.ok(graph.costMaps[nodeB].has(nodeA), 'B→A edge should exist');
});

test('road graph: A* with oneway takes longer path around restriction', () => {
  // Triangle: A(0,0), B(1,0), C(0.5,1)
  // A→B is one-way (forward only).
  // B→C and C→A are bidirectional.
  // So A→B directly is fine, but B→A must go B→C→A.
  const lines = [
    {
      coords: [
        [0, 0],
        [1, 0],
      ],
      oneway: 'yes',
    }, // A→B only
    {
      coords: [
        [1, 0],
        [0.5, 1],
      ],
      oneway: null,
    }, // B↔C
    {
      coords: [
        [0.5, 1],
        [0, 0],
      ],
      oneway: null,
    }, // C↔A
  ];

  const graph = buildRoadGraph(lines, { toleranceMeters: 0.1, contract: false });

  const nodeA = findNearestGraphNode(graph, 0, 0);
  const nodeB = findNearestGraphNode(graph, 0, 1);

  // B→A: must go through C (3 nodes in path).
  const stepper = makeAStarStepper({
    startKey: nodeB,
    goalKey: nodeA,
    neighbors: (k) => graph.adjacency[k].map((e) => e.to),
    cost: (a, b) => graph.costMaps[a]?.get(b) ?? Infinity,
    heuristic: (a, g) => haversineMeters(graphNodeLatLon(graph, a), graphNodeLatLon(graph, g)),
  });

  let result = null;
  for (let i = 0; i < 50; i++) {
    const r = stepper.step();
    if (r.done) {
      result = r;
      break;
    }
  }

  assert.ok(result);
  assert.equal(result.status, 'found');
  assert.equal(result.path.length, 3, 'B→A via C should be 3 nodes (B→C→A)');
});
