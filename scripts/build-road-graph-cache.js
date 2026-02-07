#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractRoadLinesWithMeta } from '../roads-data.js';
import { buildRoadGraphFromLines, ROAD_GRAPH_FORMAT, ROAD_GRAPH_VERSION } from '../road-graph.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

function readArg(name) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((v) => v.startsWith(prefix));
  if (!arg) return null;
  return arg.slice(prefix.length);
}

function readFlag(name) {
  return process.argv.includes(`--${name}`);
}

function parseNumber(raw) {
  if (raw == null) return null;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : null;
}

const inputArg = readArg('input');
const outputArg = readArg('output');
const snapMeters = parseNumber(readArg('snapMeters'));
const quantizeDegrees = parseNumber(readArg('quantizeDegrees'));

const defaultCompact = path.resolve(repoRoot, 'data/osm/roads.compact.json');
const defaultGeo = path.resolve(repoRoot, 'data/osm/roads.geojson');
const defaultOut = path.resolve(repoRoot, 'data/osm/roadGraph.v2.json');

const inputPath = inputArg
  ? path.resolve(repoRoot, inputArg)
  : (await exists(defaultCompact))
    ? defaultCompact
    : defaultGeo;
const outputPath = outputArg ? path.resolve(repoRoot, outputArg) : defaultOut;

if (readFlag('help')) {
  console.log(
    `Usage: node scripts/build-road-graph-cache.js [--input=PATH] [--output=PATH] [--snapMeters=3] [--quantizeDegrees=0.00005]`,
  );
  process.exit(0);
}

const raw = await readFile(inputPath, 'utf-8');
const data = JSON.parse(raw);
const lines = extractRoadLinesWithMeta(data);

const graph = buildRoadGraphFromLines(lines, {
  snapToleranceMeters: snapMeters ?? 3,
  quantizeDegrees,
});

console.log(`Graph: ${graph.nodes.length} nodes, ${graph.edges} directed edges`);

const payload = {
  format: ROAD_GRAPH_FORMAT,
  version: ROAD_GRAPH_VERSION,
  generatedAt: new Date().toISOString(),
  source: { input: path.relative(repoRoot, inputPath) },
  options: { toleranceMeters: snapMeters ?? 3 },
  nodes: graph.nodes,
  edges: graph.adjacency.map((list) => {
    return list.map((e) => {
      const tuple = [e.to, e.weight];
      if (e.via) tuple.push(e.via);
      return tuple;
    });
  }),
};

await writeFile(outputPath, `${JSON.stringify(payload)}\n`, 'utf-8');
console.log(`Wrote road graph cache: ${path.relative(repoRoot, outputPath)}`);

async function exists(p) {
  try {
    await readFile(p, 'utf-8');
    return true;
  } catch {
    return false;
  }
}
