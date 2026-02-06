#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_BOUNDS = {
  north: 42.55,
  south: 42.20,
  west: -71.35,
  east: -70.85,
};

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

function parseBoundsFromArgs(args) {
  const out = { ...DEFAULT_BOUNDS };
  for (const arg of args) {
    const [key, value] = arg.split("=");
    if (!value) continue;
    const v = Number.parseFloat(value);
    if (!Number.isFinite(v)) continue;
    if (key === "--north") out.north = v;
    if (key === "--south") out.south = v;
    if (key === "--west") out.west = v;
    if (key === "--east") out.east = v;
  }
  return out;
}

function parseOutputPathFromArgs(args) {
  for (const arg of args) {
    if (arg.startsWith("--out=")) return arg.split("=")[1];
  }
  return null;
}

function expandBounds(bounds, marginDeg = 0.2) {
  return {
    north: bounds.north + marginDeg,
    south: bounds.south - marginDeg,
    west: bounds.west - marginDeg,
    east: bounds.east + marginDeg,
  };
}

function buildQuery(bounds) {
  const b = expandBounds(bounds, 0.2);
  const { south, west, north, east } = b;

  // Coastline is a LineString network; we fetch ways + recurse to ensure we get geometry.
  return `[
    out:json][timeout:180];
    (
      way["natural"="coastline"](${south},${west},${north},${east});
    );
    out geom;`;
}

function collectCoastlineLines(osm) {
  const lines = [];
  for (const el of osm.elements || []) {
    if (el.type !== "way") continue;
    if (el.tags?.natural !== "coastline") continue;
    if (!Array.isArray(el.geometry) || el.geometry.length < 2) continue;
    const coords = el.geometry
      .map((p) => [p.lon, p.lat])
      .filter((c) => Number.isFinite(c[0]) && Number.isFinite(c[1]));
    if (coords.length >= 2) lines.push(coords);
  }

  return {
    type: "FeatureCollection",
    format: "osm-coastline-geojson",
    version: 1,
    features: lines.map((coords, i) => ({
      type: "Feature",
      properties: { id: i },
      geometry: { type: "LineString", coordinates: coords },
    })),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const bounds = parseBoundsFromArgs(args);
  const outOverride = parseOutputPathFromArgs(args);

  const query = buildQuery(bounds);
  const res = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=UTF-8" },
    body: query,
  });

  if (!res.ok) throw new Error(`Overpass error: ${res.status} ${res.statusText}`);

  const osm = await res.json();
  const fc = collectCoastlineLines(osm);
  fc.bounds = bounds;

  const outPath = path.resolve(outOverride || "data/osm/coastline.geojson");
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(fc));

  console.log(`Wrote ${fc.features.length} coastline lines to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
