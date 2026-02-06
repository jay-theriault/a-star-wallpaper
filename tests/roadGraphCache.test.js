import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { parseRoadGraphCache } from "../road-graph.js";

test("road graph cache: schema parses", async () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dataPath = path.resolve(here, "./fixtures/roadGraph.v1.json");
  const raw = await readFile(dataPath, "utf-8");
  const payload = JSON.parse(raw);

  const graph = parseRoadGraphCache(payload);
  assert.ok(graph, "expected valid road graph cache");
  assert.equal(graph.nodes.length, 3);
  assert.equal(graph.adjacency.length, 3);
  assert.ok(Array.isArray(graph.adjacency[0]));
  assert.equal(graph.adjacency[0][0].to, 1);
});
