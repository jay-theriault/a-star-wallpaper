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

const HIGHWAY_PROFILES = {
  major: ["motorway", "trunk", "primary", "secondary"],
  standard: ["motorway", "trunk", "primary", "secondary", "tertiary"],
  full: [
    "motorway",
    "trunk",
    "primary",
    "secondary",
    "tertiary",
    "unclassified",
    "residential",
    "living_street",
  ],
};

function parseProfileFromArgs(args) {
  for (const arg of args) {
    if (!arg.startsWith("--profile=")) continue;
    const value = arg.split("=")[1];
    if (value === "major" || value === "standard" || value === "full") return value;
  }
  return "standard";
}

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

function parseFormatFromArgs(args) {
  for (const arg of args) {
    if (arg.startsWith("--format=")) {
      const value = arg.split("=")[1];
      if (value === "geojson" || value === "compact") return value;
    }
    if (arg === "--compact") return "compact";
  }
  return "geojson";
}

function parseOutputPathFromArgs(args) {
  for (const arg of args) {
    if (arg.startsWith("--out=")) return arg.split("=")[1];
  }
  return null;
}

function buildQuery(bounds, profile) {
  const { south, west, north, east } = bounds;
  const allowed = HIGHWAY_PROFILES[profile] || HIGHWAY_PROFILES.standard;
  const regex = allowed.join("|");
  return `[
    out:json][timeout:60];
    (
      way["highway"~"${regex}"](${south},${west},${north},${east});
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

function collectLines(osm, profile) {
  const allowed = new Set(HIGHWAY_PROFILES[profile] || HIGHWAY_PROFILES.standard);

  const nodes = new Map();
  for (const el of osm.elements) {
    if (el.type === "node") nodes.set(el.id, [el.lon, el.lat]);
  }

  const lines = [];
  for (const el of osm.elements) {
    if (el.type !== "way") continue;
    const highway = el.tags?.highway;
    if (!highway || !allowed.has(highway)) continue;

    const coords = [];
    for (const nodeId of el.nodes || []) {
      const coord = nodes.get(nodeId);
      if (coord) coords.push(coord);
    }

    if (coords.length < 2) continue;
    const simplified = simplifyLine(coords);
    if (simplified.length < 2) continue;

    lines.push({ id: el.id, highway, coords: simplified });
  }

  return lines;
}

function toFeatureCollection(lines) {
  return {
    type: "FeatureCollection",
    features: lines.map((line) => ({
      type: "Feature",
      properties: {
        id: line.id,
        highway: line.highway,
      },
      geometry: {
        type: "LineString",
        coordinates: line.coords,
      },
    })),
  };
}

function toCompactFormat(lines, bounds) {
  return {
    format: "osm-roads-compact",
    version: 2,
    bounds,
    lines: lines.map((line) => ({ h: line.highway, c: line.coords.flat() })),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const bounds = parseBoundsFromArgs(args);
  const format = parseFormatFromArgs(args);
  const outOverride = parseOutputPathFromArgs(args);
  const profile = parseProfileFromArgs(args);
  const query = buildQuery(bounds, profile);

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

  const lines = collectLines(osm, profile);
  const outPath = path.resolve(
    outOverride || (format === "compact" ? "data/osm/roads.compact.json" : "data/osm/roads.geojson"),
  );
  await fs.mkdir(path.dirname(outPath), { recursive: true });

  if (format === "compact") {
    const compact = toCompactFormat(lines, bounds);
    await fs.writeFile(outPath, JSON.stringify(compact));
    console.log(`Wrote ${compact.lines.length} road lines to ${outPath} (profile=${profile})`);
  } else {
    const fc = toFeatureCollection(lines);
    await fs.writeFile(outPath, JSON.stringify(fc));
    console.log(`Wrote ${fc.features.length} road features to ${outPath} (profile=${profile})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
