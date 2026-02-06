import test from "node:test";
import assert from "node:assert/strict";

import { buildRoadGraph, findNearestGraphNode, graphNodeLatLon } from "../road-graph.js";
import { haversineMeters, makeAStarStepper } from "../astar.js";

test("road graph: builds nodes/edges and finds shortest path", () => {
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

  const graph = buildRoadGraph(lines, { toleranceMeters: 0.1 });

  assert.equal(graph.nodes.length, 4, "expected 4 unique nodes");
  assert.equal(graph.edges, 6, "expected 3 undirected edges (6 directed)");

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

  assert.ok(result, "expected A* to finish");
  assert.equal(result.status, "found");
  assert.equal(result.path.length, 3, "expected path with 3 nodes");
});
