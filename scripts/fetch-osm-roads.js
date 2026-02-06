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

const ALLOWED_HIGHWAYS = new Set([
  "motorway",
  "trunk",
  "primary",
  "secondary",
  "tertiary",
]);

function parseBoundsFromArgs(args) {
  // --north= --south= --west= --east=
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

function buildQuery(bounds) {
  const { south, west, north, east } = bounds;
  return `[
    out:json][timeout:25];
    (
      way["highway"~"motorway|trunk|primary|secondary|tertiary"](${south},${west},${north},${east});
    );
    (._;>;);
    out body;`;
}

function simplifyLine(coords, minDelta = 0.00005) {
  if (coords.length <= 2) return coords;
  const out = [coords[0]];
  let [prevLon, prevLat] = coords[0];
  for (let i = 1; i < coords.length - 1; i++) {
    const [lon, lat] = coords[i];
    const dLon = lon - prevLon;
    const dLat = lat - prevLat;
    if (Math.hypot(dLon, dLat) >= minDelta) {
      out.push(coords[i]);
      prevLon = lon;
      prevLat = lat;
    }
  }
  out.push(coords[coords.length - 1]);
  return out;
}

function toFeatureCollection(osm) {
  const nodes = new Map();
  for (const el of osm.elements) {
    if (el.type === "node") nodes.set(el.id, [el.lon, el.lat]);
  }

  const features = [];
  for (const el of osm.elements) {
    if (el.type !== "way") continue;
    const highway = el.tags?.highway;
    if (!highway || !ALLOWED_HIGHWAYS.has(highway)) continue;

    const coords = [];
    for (const nodeId of el.nodes || []) {
      const coord = nodes.get(nodeId);
      if (coord) coords.push(coord);
    }

    if (coords.length < 2) continue;
    const simplified = simplifyLine(coords);
    if (simplified.length < 2) continue;

    features.push({
      type: "Feature",
      properties: {
        id: el.id,
        highway,
      },
      geometry: {
        type: "LineString",
        coordinates: simplified,
      },
    });
  }

  return {
    type: "FeatureCollection",
    features,
  };
}

async function main() {
  const bounds = parseBoundsFromArgs(process.argv.slice(2));
  const query = buildQuery(bounds);

  const res = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=UTF-8",
    },
    body: query,
  });

  if (!res.ok) {
    throw new Error(`Overpass error: ${res.status} ${res.statusText}`);
  }

  const osm = await res.json();
  if (!osm?.elements) throw new Error("Invalid Overpass response");

  const fc = toFeatureCollection(osm);
  const outPath = path.resolve("data/osm/roads.geojson");
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(fc));

  console.log(`Wrote ${fc.features.length} road features to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
