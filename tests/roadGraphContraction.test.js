import test from 'node:test';
import assert from 'node:assert/strict';

import { buildRoadGraph, findNearestGraphNode, graphNodeLatLon } from '../road-graph.js';
import { haversineMeters, makeAStarStepper } from '../astar.js';

test('contraction: chain A--M1--M2--B contracts to 2 nodes with via geometry', () => {
  // Linear chain: 4 nodes, degree-2 in the middle.
  // A(0,0) -- M1(0,1) -- M2(0,2) -- B(0,3)
  const lines = [
    [
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
    ],
  ];

  const graph = buildRoadGraph(lines, { toleranceMeters: 0.1, contract: true });

  // Should contract M1 and M2, leaving only A and B.
  assert.equal(graph.nodes.length, 2, 'expected 2 nodes after contraction');

  // Should have bidirectional edge with via geometry.
  assert.equal(graph.adjacency[0].length, 1, 'A should have 1 outgoing edge');
  assert.equal(graph.adjacency[1].length, 1, 'B should have 1 outgoing edge');
  assert.ok(graph.adjacency[0][0].via, 'forward edge should have via geometry');
  assert.ok(graph.adjacency[1][0].via, 'reverse edge should have via geometry');
  assert.equal(graph.adjacency[0][0].via.length, 2, 'via should have 2 intermediate points');
});

test('contraction: T-intersection preserved (degree-3 node not contracted)', () => {
  // T-shape: A--M--B with C branching off M.
  // M has 3 neighbors, so it should NOT be contracted.
  const lines = [
    [
      [0, 0],
      [1, 0],
      [2, 0],
    ],
    [
      [1, 0],
      [1, 1],
    ],
  ];

  const graph = buildRoadGraph(lines, { toleranceMeters: 0.1, contract: true });

  // All 4 nodes should be preserved (M has degree 3).
  assert.equal(graph.nodes.length, 4, 'expected 4 nodes (no contraction at T-junction)');
});

test('contraction: node IDs are dense 0..N-1 after contraction', () => {
  // Chain: 5 nodes, endpoints + 3 middle → should contract to 2.
  const lines = [
    [
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
      [4, 0],
    ],
  ];

  const graph = buildRoadGraph(lines, { toleranceMeters: 0.1, contract: true });

  for (let i = 0; i < graph.nodes.length; i++) {
    assert.equal(graph.nodes[i].id, i, `node ${i} should have id=${i}`);
  }

  // All edge targets should be valid indices.
  for (const list of graph.adjacency) {
    for (const e of list) {
      assert.ok(e.to >= 0 && e.to < graph.nodes.length, `edge target ${e.to} should be valid`);
    }
  }
});

test('contraction: via geometry has correct lon/lat of removed nodes', () => {
  // A(lon=0,lat=0) -- M(lon=5,lat=0) -- B(lon=10,lat=0)
  const lines = [
    [
      [0, 0],
      [5, 0],
      [10, 0],
    ],
  ];

  const graph = buildRoadGraph(lines, { toleranceMeters: 0.1, contract: true });

  assert.equal(graph.nodes.length, 2);
  const via = graph.adjacency[0][0].via;
  assert.ok(via, 'should have via geometry');
  assert.equal(via.length, 1, '1 intermediate point');
  // via is [lon, lat] order.
  assert.equal(via[0][0], 5, 'via lon should be 5');
  assert.equal(via[0][1], 0, 'via lat should be 0');
});

test('contraction: oneway chain A→M→B gives only forward shortcut', () => {
  const lines = [
    {
      coords: [
        [0, 0],
        [1, 0],
        [2, 0],
      ],
      oneway: 'yes',
    },
  ];

  const graph = buildRoadGraph(lines, { toleranceMeters: 0.1, contract: true });

  assert.equal(graph.nodes.length, 2);

  // Find which node is A (lon~0) and which is B (lon~2).
  const nodeA = graph.nodes.find((n) => Math.abs(n.lon) < 0.5);
  const nodeB = graph.nodes.find((n) => Math.abs(n.lon - 2) < 0.5);
  assert.ok(nodeA, 'should find node A');
  assert.ok(nodeB, 'should find node B');

  // A→B should exist.
  const edgeAB = graph.adjacency[nodeA.id].find((e) => e.to === nodeB.id);
  assert.ok(edgeAB, 'A→B edge should exist');

  // B→A should NOT exist.
  const edgeBA = graph.adjacency[nodeB.id].find((e) => e.to === nodeA.id);
  assert.equal(edgeBA, undefined, 'B→A edge should not exist');
});

test('contraction: cost preservation (shortcut weight = sum of individual edges)', () => {
  // Three points along a line, each ~111km apart.
  const lines = [
    [
      [0, 0],
      [0, 1],
      [0, 2],
    ],
  ];

  const graphUncontracted = buildRoadGraph(lines, { toleranceMeters: 0.1, contract: false });
  const graphContracted = buildRoadGraph(lines, { toleranceMeters: 0.1, contract: true });

  // Sum of original edges.
  const w01 = graphUncontracted.costMaps[0].get(1);
  const w12 = graphUncontracted.costMaps[1].get(2);
  assert.ok(Number.isFinite(w01) && Number.isFinite(w12));

  // Contracted shortcut weight.
  assert.equal(graphContracted.nodes.length, 2);
  const shortcutWeight = graphContracted.adjacency[0][0].weight;
  assert.ok(
    Math.abs(shortcutWeight - (w01 + w12)) < 0.01,
    'shortcut weight should equal sum of parts',
  );
});

test('contraction: contract=false flag skips contraction', () => {
  const lines = [
    [
      [0, 0],
      [1, 0],
      [2, 0],
    ],
  ];

  const graph = buildRoadGraph(lines, { toleranceMeters: 0.1, contract: false });
  assert.equal(graph.nodes.length, 3, 'all 3 nodes should remain without contraction');
});

test('contraction: cycle of degree-2 nodes is gracefully skipped', () => {
  // Triangle where all nodes have exactly degree 2.
  const lines = [
    [
      [0, 0],
      [1, 0],
    ],
    [
      [1, 0],
      [0.5, 1],
    ],
    [
      [0.5, 1],
      [0, 0],
    ],
  ];

  const graph = buildRoadGraph(lines, { toleranceMeters: 0.1, contract: true });
  // All 3 nodes should remain since the ring can't be contracted.
  assert.equal(graph.nodes.length, 3, 'cycle of degree-2 nodes should not be contracted');
});

test('contraction: end-to-end A* on contracted graph finds valid path', () => {
  // Build a network with a true intersection:
  // A(0,0)--M1(1,0)--B(2,0)--M2(3,0)--C(4,0)
  //                   |
  //                   D(2,1)
  // B has 3 undirected neighbors (M1, M2, D) → degree 3 → preserved.
  const lines = [
    [
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
      [4, 0],
    ],
    [
      [2, 0],
      [2, 1],
    ],
  ];

  const graph = buildRoadGraph(lines, { toleranceMeters: 0.1, contract: true });

  // A, B (intersection), C, D remain. M1 and M2 contracted.
  assert.equal(graph.nodes.length, 4, 'expected 4 nodes: A, B(intersection), C, D');

  const start = findNearestGraphNode(graph, 0, 0);
  const goal = findNearestGraphNode(graph, 1, 2);

  const stepper = makeAStarStepper({
    startKey: start,
    goalKey: goal,
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

  assert.ok(result, 'A* should finish');
  assert.equal(result.status, 'found');
  assert.ok(result.path.length >= 2, 'path should have at least 2 nodes');
});
