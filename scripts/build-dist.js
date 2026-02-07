import { mkdirSync, rmSync, cpSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const dist = resolve(root, 'dist');

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const files = [
  'index.html',
  'main.js',
  'astar.js',
  'guardrails.js',
  'endPhase.js',
  'roads-data.js',
  'road-graph.js',
  'config.js',
  'coordinates.js',
  'endpoint-sampling.js',
  'grid-helpers.js',
  'road-point-cache.js',
  'terrain-data.js',
];
for (const file of files) {
  cpSync(resolve(root, file), resolve(dist, file));
}

cpSync(resolve(root, 'data'), resolve(dist, 'data'), { recursive: true });

console.log('dist/ ready for Lively import');
