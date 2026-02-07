import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { parseRoadGraphCache } from '../road-graph.js';

test('road graph cache: v1 schema parses', async () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dataPath = path.resolve(here, './fixtures/roadGraph.v1.json');
  const raw = await readFile(dataPath, 'utf-8');
  const payload = JSON.parse(raw);

  const graph = parseRoadGraphCache(payload);
  assert.ok(graph, 'expected valid road graph cache');
  assert.equal(graph.nodes.length, 3);
  assert.equal(graph.adjacency.length, 3);
  assert.ok(Array.isArray(graph.adjacency[0]));
  assert.equal(graph.adjacency[0][0].to, 1);
});

test('road graph cache: v2 schema with via geometry parses', async () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dataPath = path.resolve(here, './fixtures/roadGraph.v2.json');
  const raw = await readFile(dataPath, 'utf-8');
  const payload = JSON.parse(raw);

  const graph = parseRoadGraphCache(payload);
  assert.ok(graph, 'expected valid v2 road graph cache');
  assert.equal(graph.nodes.length, 2);
  assert.equal(graph.adjacency.length, 2);

  // Check via geometry on first edge.
  const edge = graph.adjacency[0][0];
  assert.equal(edge.to, 1);
  assert.equal(edge.weight, 222000);
  assert.ok(Array.isArray(edge.via), 'edge should have via geometry');
  assert.equal(edge.via.length, 1);
  assert.deepEqual(edge.via[0], [1, 0], 'via point should be [lon, lat]');
});

test('road graph cache: v1 fixture has no via geometry', async () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dataPath = path.resolve(here, './fixtures/roadGraph.v1.json');
  const raw = await readFile(dataPath, 'utf-8');
  const payload = JSON.parse(raw);

  const graph = parseRoadGraphCache(payload);
  assert.ok(graph);

  // v1 edges should not have via property.
  for (const list of graph.adjacency) {
    for (const e of list) {
      assert.equal(e.via, undefined, 'v1 edges should not have via geometry');
    }
  }
});

test('road graph cache: rejects unknown version', () => {
  const payload = {
    format: 'osm-road-graph',
    version: 99,
    nodes: [],
    edges: [],
  };
  const graph = parseRoadGraphCache(payload);
  assert.equal(graph, null, 'should reject unknown version');
});

test('road graph cache: toleranceMeters from options', async () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dataPath = path.resolve(here, './fixtures/roadGraph.v2.json');
  const raw = await readFile(dataPath, 'utf-8');
  const payload = JSON.parse(raw);

  const graph = parseRoadGraphCache(payload);
  assert.equal(graph.toleranceMeters, 10, 'should read toleranceMeters from options');
});
