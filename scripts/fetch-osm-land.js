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

function buildQuery(bounds) {
  const { south, west, north, east } = bounds;

  // Keep this modest: closed ways only (no multipolygon relations) to avoid huge payloads.
  // We pull a few broad landcover-ish tags plus water so we can paint a land layer with
  // water cutouts.
  return `[
    out:json][timeout:60];
    (
      way["natural"~"water|wood|scrub|wetland|beach"](${south},${west},${north},${east});
      way["landuse"~"residential|commercial|industrial|forest|grass|meadow|recreation_ground|cemetery"](${south},${west},${north},${east});
      way["leisure"~"park|golf_course"](${south},${west},${north},${east});
      way["waterway"="riverbank"](${south},${west},${north},${east});
    );
    (._;>;);
    out body;`;
}

function simplifyRing(coords, minDelta = 0.00005) {
  if (coords.length <= 4) return coords;
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

function collectClosedWayPolygons(osm) {
  const nodes = new Map();
  for (const el of osm.elements) {
    if (el.type === "node") nodes.set(el.id, [el.lon, el.lat]);
  }

  const features = [];
  for (const el of osm.elements) {
    if (el.type !== "way") continue;
    const tags = el.tags || {};

    // classify
    const isWater = tags.natural === "water" || tags.waterway === "riverbank";
    const kind = isWater ? "water" : "land";

    const coords = [];
    for (const nodeId of el.nodes || []) {
      const coord = nodes.get(nodeId);
      if (coord) coords.push(coord);
    }

    if (coords.length < 4) continue;
    const first = coords[0];
    const last = coords[coords.length - 1];
    const closed = first[0] === last[0] && first[1] === last[1];
    if (!closed) continue;

    const ring = simplifyRing(coords);
    if (ring.length < 4) continue;

    features.push({
      type: "Feature",
      properties: {
        id: el.id,
        kind,
        natural: tags.natural || null,
        landuse: tags.landuse || null,
        leisure: tags.leisure || null,
        waterway: tags.waterway || null,
      },
      geometry: {
        type: "Polygon",
        coordinates: [ring],
      },
    });
  }

  return {
    type: "FeatureCollection",
    features,
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
  if (!osm?.elements) throw new Error("Invalid Overpass response");

  const fc = collectClosedWayPolygons(osm);
  fc.bounds = bounds;
  fc.format = "osm-land-geojson";
  fc.version = 1;

  const outPath = path.resolve(outOverride || "data/osm/land.geojson");
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(fc));

  console.log(`Wrote ${fc.features.length} land/water polygons to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
