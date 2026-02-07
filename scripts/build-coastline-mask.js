#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

import { MASK_BOUNDS } from '../config.js';
import { extractCoastlineLines } from '../terrain-data.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

const COASTLINE_PATH = path.join(repoRoot, 'data', 'osm', 'coastline.geojson');
const OUTPUT_PATH = path.join(repoRoot, 'data', 'osm', 'coastline-mask.png');

const MASK_WIDTH = 4096;

// Set a pixel and its 4-connected neighbors for ~3px thick lines.
function setThick(x, y, grid, w, h) {
  if (x >= 0 && x < w && y >= 0 && y < h) grid[y * w + x] = 1;
  if (x - 1 >= 0 && y >= 0 && y < h) grid[y * w + x - 1] = 1;
  if (x + 1 < w && y >= 0 && y < h) grid[y * w + x + 1] = 1;
  if (x >= 0 && x < w && y - 1 >= 0) grid[(y - 1) * w + x] = 1;
  if (x >= 0 && x < w && y + 1 < h) grid[(y + 1) * w + x] = 1;
}

// Bresenham's line algorithm — rasterize a line segment into the barrier grid.
function bresenham(x0, y0, x1, y1, grid, w, h) {
  x0 = Math.round(x0);
  y0 = Math.round(y0);
  x1 = Math.round(x1);
  y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  while (true) {
    setThick(x0, y0, grid, w, h);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x0 += sx;
    }
    if (e2 < dx) {
      err += dx;
      y0 += sy;
    }
  }
}

async function main() {
  console.log('Reading coastline.geojson...');
  const raw = await readFile(COASTLINE_PATH, 'utf8');
  const geojson = JSON.parse(raw);
  const lines = extractCoastlineLines(geojson);
  console.log(`  ${lines.length} coastline segments`);

  const latSpan = MASK_BOUNDS.north - MASK_BOUNDS.south;
  const lonSpan = MASK_BOUNDS.east - MASK_BOUNDS.west;
  const mw = MASK_WIDTH;
  const mh = Math.round(mw * (latSpan / lonSpan));
  console.log(`Mask dimensions: ${mw} x ${mh}`);

  // 1) Rasterize coastline segments as barrier pixels.
  // Also connect nearby endpoints between segments to close gaps.
  const barrier = new Uint8Array(mw * mh);

  const toPixel = (lon, lat) => ({
    px: ((lon - MASK_BOUNDS.west) / lonSpan) * (mw - 1),
    py: ((MASK_BOUNDS.north - lat) / latSpan) * (mh - 1),
  });

  // Rasterize all coastline segments.
  for (const line of lines) {
    if (!line || line.length < 2) continue;
    for (let i = 1; i < line.length; i++) {
      const p0 = toPixel(line[i - 1][0], line[i - 1][1]);
      const p1 = toPixel(line[i][0], line[i][1]);
      bresenham(p0.px, p0.py, p1.px, p1.py, barrier, mw, mh);
    }
  }

  // Connect all segment endpoints to form a continuous barrier chain.
  // Greedy: repeatedly find the closest unmatched start to any unmatched end.
  const starts = [];
  const ends = [];
  for (const line of lines) {
    if (!line || line.length < 2) continue;
    starts.push(toPixel(line[0][0], line[0][1]));
    ends.push(toPixel(line[line.length - 1][0], line[line.length - 1][1]));
  }
  const usedStart = new Uint8Array(starts.length);
  for (let e = 0; e < ends.length; e++) {
    let bestDist = Infinity;
    let bestIdx = -1;
    for (let s = 0; s < starts.length; s++) {
      if (usedStart[s] || s === e) continue;
      const dx = ends[e].px - starts[s].px;
      const dy = ends[e].py - starts[s].py;
      const d = dx * dx + dy * dy;
      if (d > 0.25 && d < bestDist) {
        bestDist = d;
        bestIdx = s;
      }
    }
    if (bestIdx >= 0) {
      usedStart[bestIdx] = 1;
      bresenham(ends[e].px, ends[e].py, starts[bestIdx].px, starts[bestIdx].py, barrier, mw, mh);
    }
  }

  // Seal the top and bottom edges of the mask as barrier so the east-edge
  // BFS flood can't leak around the coastline's north/south extent.
  // Also seal the west edge — everything beyond the coastline to the west is inland.
  for (let x = 0; x < mw; x++) {
    barrier[x] = 1; // top row
    barrier[(mh - 1) * mw + x] = 1; // bottom row
  }
  for (let y = 0; y < mh; y++) {
    barrier[y * mw] = 1; // west edge
  }

  let barrierCount = 0;
  for (let i = 0; i < mw * mh; i++) if (barrier[i]) barrierCount++;
  console.log(`  ${barrierCount} barrier pixels`);

  // 2) BFS flood-fill ocean from east edge.
  const ocean = new Uint8Array(mw * mh);
  const qx = new Int32Array(mw * mh);
  const qy = new Int32Array(mw * mh);
  let qHead = 0;
  let qTail = 0;

  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= mw || y >= mh) return;
    const idx = y * mw + x;
    if (ocean[idx] || barrier[idx]) return;
    ocean[idx] = 1;
    qx[qTail] = x;
    qy[qTail] = y;
    qTail++;
  };

  // Seed from east edge (3px band).
  for (let y = 0; y < mh; y++) {
    push(mw - 1, y);
    push(mw - 2, y);
    push(mw - 3, y);
  }

  while (qHead < qTail) {
    const x = qx[qHead];
    const y = qy[qHead];
    qHead++;
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }

  let oceanCount = 0;
  for (let i = 0; i < mw * mh; i++) if (ocean[i]) oceanCount++;
  console.log(`  ${oceanCount} ocean pixels (${((oceanCount / (mw * mh)) * 100).toFixed(1)}%)`);

  // 3) Write PNG: water/barrier = white opaque, land = transparent.
  const png = new PNG({ width: mw, height: mh });
  for (let i = 0; i < mw * mh; i++) {
    const isWater = ocean[i] === 1 || barrier[i] === 1;
    const off = i * 4;
    if (isWater) {
      png.data[off] = 255;
      png.data[off + 1] = 255;
      png.data[off + 2] = 255;
      png.data[off + 3] = 255;
    } else {
      png.data[off] = 0;
      png.data[off + 1] = 0;
      png.data[off + 2] = 0;
      png.data[off + 3] = 0;
    }
  }

  const buf = PNG.sync.write(png);
  await writeFile(OUTPUT_PATH, buf);
  console.log(`Wrote ${OUTPUT_PATH} (${(buf.length / 1024).toFixed(0)} KB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
