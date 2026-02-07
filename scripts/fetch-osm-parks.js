#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_BOUNDS = {
  north: 42.55,
  south: 42.2,
  west: -71.35,
  east: -70.85,
};

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

function parseBoundsFromArgs(args) {
  const out = { ...DEFAULT_BOUNDS };
  for (const arg of args) {
    const [key, value] = arg.split('=');
    if (!value) continue;
    const v = Number.parseFloat(value);
    if (!Number.isFinite(v)) continue;
    if (key === '--north') out.north = v;
    if (key === '--south') out.south = v;
    if (key === '--west') out.west = v;
    if (key === '--east') out.east = v;
  }
  return out;
}

function parseOutputPathFromArgs(args) {
  for (const arg of args) {
    if (arg.startsWith('--out=')) return arg.split('=')[1];
  }
  return null;
}

function buildQuery(bounds) {
  const { south, west, north, east } = bounds;

  // Keep it simple: closed ways + multipolygon relations for common green spaces.
  return `[
    out:json][timeout:180];
    (
      way["leisure"~"park|golf_course|pitch|garden|nature_reserve"](${south},${west},${north},${east});
      way["landuse"~"grass|meadow|forest|recreation_ground|cemetery"](${south},${west},${north},${east});
      relation["type"="multipolygon"]["leisure"~"park|golf_course|pitch|garden|nature_reserve"](${south},${west},${north},${east});
      relation["type"="multipolygon"]["landuse"~"grass|meadow|forest|recreation_ground|cemetery"](${south},${west},${north},${east});
    );
    (._;>;);
    out geom;`;
}

function isClosedRing(coords) {
  if (!coords || coords.length < 4) return false;
  const a = coords[0];
  const b = coords[coords.length - 1];
  return a && b && a[0] === b[0] && a[1] === b[1];
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

function wayGeomToRing(el) {
  const geom = el?.geometry;
  if (!Array.isArray(geom) || geom.length < 4) return null;
  const coords = geom
    .map((p) => [p.lon, p.lat])
    .filter((c) => Number.isFinite(c[0]) && Number.isFinite(c[1]));
  if (!isClosedRing(coords)) return null;
  const ring = simplifyRing(coords);
  return ring.length >= 4 ? ring : null;
}

function collectPolygons(osm) {
  const elements = osm?.elements || [];
  const waysById = new Map();
  for (const el of elements) if (el.type === 'way') waysById.set(el.id, el);

  const features = [];

  for (const el of elements) {
    if (el.type === 'way') {
      const ring = wayGeomToRing(el);
      if (!ring) continue;
      features.push({
        type: 'Feature',
        properties: { id: el.id },
        geometry: { type: 'Polygon', coordinates: [ring] },
      });
    } else if (el.type === 'relation') {
      const outers = [];
      for (const m of el.members || []) {
        if (m.type !== 'way' || m.role !== 'outer') continue;
        const ring = wayGeomToRing(waysById.get(m.ref));
        if (ring) outers.push(ring);
      }
      if (!outers.length) continue;
      const coords = outers.map((r) => [r]);
      features.push({
        type: 'Feature',
        properties: { id: el.id },
        geometry: {
          type: coords.length === 1 ? 'Polygon' : 'MultiPolygon',
          coordinates: coords.length === 1 ? coords[0] : coords,
        },
      });
    }
  }

  return {
    type: 'FeatureCollection',
    format: 'osm-parks-geojson',
    version: 1,
    features,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const bounds = parseBoundsFromArgs(args);
  const outOverride = parseOutputPathFromArgs(args);

  const query = buildQuery(bounds);
  const res = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    body: query,
  });

  if (!res.ok) throw new Error(`Overpass error: ${res.status} ${res.statusText}`);

  const osm = await res.json();
  const fc = collectPolygons(osm);
  fc.bounds = bounds;

  const outPath = path.resolve(outOverride || 'data/osm/parks.geojson');
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(fc));

  console.log(`Wrote ${fc.features.length} park/green polygons to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
