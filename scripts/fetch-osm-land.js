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

  // We only need water for the current rendering strategy.
  // Important: Boston Harbor and other large water bodies are often modeled as multipolygon relations.
  // Use `out geom` so we can build polygons without separately fetching nodes.
  return `[
    out:json][timeout:180];
    (
      way["natural"~"water|bay"](${south},${west},${north},${east});
      way["water"~"river|riverbank|canal|basin|harbour|reservoir|lake|pond|bay"](${south},${west},${north},${east});
      way["waterway"="riverbank"](${south},${west},${north},${east});

      relation["type"="multipolygon"]["natural"~"water|bay"](${south},${west},${north},${east});
      relation["type"="multipolygon"]["water"~"river|riverbank|canal|basin|harbour|reservoir|lake|pond|bay"](${south},${west},${north},${east});
      relation["type"="multipolygon"]["waterway"="riverbank"](${south},${west},${north},${east});

      // Some coastal/ocean water surfaces are tagged as "place=sea".
      relation["type"="multipolygon"]["place"="sea"](${south},${west},${north},${east});
    );
    (._;>;);
    out geom;`;
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

function isClosedRing(coords) {
  if (!coords || coords.length < 4) return false;
  const a = coords[0];
  const b = coords[coords.length - 1];
  return a && b && a[0] === b[0] && a[1] === b[1];
}

function wayGeomToCoords(el) {
  const geom = el?.geometry;
  if (!Array.isArray(geom) || geom.length < 2) return null;
  const coords = geom.map((p) => [p.lon, p.lat]).filter((c) => Number.isFinite(c[0]) && Number.isFinite(c[1]));
  return coords.length >= 2 ? coords : null;
}

function wayGeomToRing(el) {
  const coords = wayGeomToCoords(el);
  if (!coords || coords.length < 4) return null;
  if (!isClosedRing(coords)) return null;
  const ring = simplifyRing(coords);
  return ring.length >= 4 ? ring : null;
}

function coordKey(c) {
  // 1e-6 deg ~ 0.11m lat; good enough for endpoint matching.
  return `${c[0].toFixed(6)},${c[1].toFixed(6)}`;
}

function reverseCoords(coords) {
  const out = new Array(coords.length);
  for (let i = 0; i < coords.length; i++) out[i] = coords[coords.length - 1 - i];
  return out;
}

function stitchRingsFromOuterWays(rel, waysById) {
  const segs = [];
  for (const m of rel.members || []) {
    if (m.type !== "way" || m.role !== "outer") continue;
    const way = waysById.get(m.ref);
    const coords = wayGeomToCoords(way);
    if (coords) segs.push(coords);
  }
  if (!segs.length) return [];

  // Greedy stitching: chain segments by matching endpoints.
  const unused = segs.slice();
  const rings = [];

  while (unused.length) {
    let ring = unused.pop();

    let guard = 0;
    while (guard++ < 10000) {
      const startK = coordKey(ring[0]);
      const endK = coordKey(ring[ring.length - 1]);
      if (startK === endK && ring.length >= 4) break;

      let merged = false;
      for (let i = 0; i < unused.length; i++) {
        const s = unused[i];
        const sStartK = coordKey(s[0]);
        const sEndK = coordKey(s[s.length - 1]);

        if (endK === sStartK) {
          ring = ring.concat(s.slice(1));
        } else if (endK === sEndK) {
          ring = ring.concat(reverseCoords(s).slice(1));
        } else if (startK === sEndK) {
          ring = s.concat(ring.slice(1));
        } else if (startK === sStartK) {
          ring = reverseCoords(s).concat(ring.slice(1));
        } else {
          continue;
        }

        unused.splice(i, 1);
        merged = true;
        break;
      }

      if (!merged) break;
    }

    if (ring.length >= 4) {
      // Ensure closed
      const startK = coordKey(ring[0]);
      const endK = coordKey(ring[ring.length - 1]);
      if (startK !== endK) ring = ring.concat([ring[0]]);
      if (ring.length >= 4) rings.push(simplifyRing(ring));
    }
  }

  // Keep only rings that are properly closed.
  return rings.filter((r) => isClosedRing(r) && r.length >= 4);
}

function collectWaterPolygons(osm) {
  const elements = osm?.elements || [];
  const waysById = new Map();
  for (const el of elements) {
    if (el.type === "way") waysById.set(el.id, el);
  }

  const features = [];

  // Water as closed ways.
  for (const el of elements) {
    if (el.type !== "way") continue;
    const tags = el.tags || {};
    const isWater = tags.natural === "water" || tags.waterway === "riverbank";
    if (!isWater) continue;

    const ring = wayGeomToRing(el);
    if (!ring) continue;

    features.push({
      type: "Feature",
      properties: {
        id: el.id,
        kind: "water",
        natural: tags.natural || null,
        waterway: tags.waterway || null,
      },
      geometry: {
        type: "Polygon",
        coordinates: [ring],
      },
    });
  }

  // Water as multipolygon relations (use member ways with role=outer).
  for (const el of elements) {
    if (el.type !== "relation") continue;
    const tags = el.tags || {};
    const isWater = (tags.type === "multipolygon") && (tags.natural === "water" || tags.waterway === "riverbank");
    if (!isWater) continue;

    const outers = [];
    for (const m of el.members || []) {
      if (m.type !== "way") continue;
      if (m.role !== "outer") continue;
      const way = waysById.get(m.ref);
      const ring = wayGeomToRing(way);
      if (ring) outers.push(ring);
    }
    if (!outers.length) continue;

    const stitched = stitchRingsFromOuterWays(el, waysById);
    if (!stitched.length) continue;

    const coordinates = stitched.map((ring) => [ring]);

    features.push({
      type: "Feature",
      properties: {
        id: el.id,
        kind: "water",
        natural: tags.natural || null,
        waterway: tags.waterway || null,
      },
      geometry: {
        type: coordinates.length === 1 ? "Polygon" : "MultiPolygon",
        coordinates: coordinates.length === 1 ? coordinates[0] : coordinates,
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

  const fc = collectWaterPolygons(osm);
  fc.bounds = bounds;
  fc.format = "osm-land-geojson";
  fc.version = 2;

  const outPath = path.resolve(outOverride || "data/osm/land.geojson");
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(fc));

  console.log(`Wrote ${fc.features.length} land/water polygons to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
