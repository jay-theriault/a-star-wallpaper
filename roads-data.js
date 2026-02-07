export const COMPACT_ROADS_FORMAT = 'osm-roads-compact';
// v1: lines: number[] (flat lon/lat)
// v2: lines: { h: string, c: number[] }[] (highway + flat lon/lat)
export const COMPACT_ROADS_VERSION = 2;

export function extractRoadLinesFromGeojson(geojson) {
  const lines = [];
  if (!geojson || geojson.type !== 'FeatureCollection' || !Array.isArray(geojson.features))
    return lines;

  for (const feature of geojson.features) {
    const geom = feature?.geometry;
    if (!geom) continue;
    if (geom.type === 'LineString' && Array.isArray(geom.coordinates)) {
      lines.push(geom.coordinates);
    } else if (geom.type === 'MultiLineString' && Array.isArray(geom.coordinates)) {
      for (const line of geom.coordinates) {
        if (Array.isArray(line)) lines.push(line);
      }
    }
  }

  return lines;
}

export function extractRoadLinesWithMetaFromGeojson(geojson) {
  const lines = [];
  if (!geojson || geojson.type !== 'FeatureCollection' || !Array.isArray(geojson.features))
    return lines;

  for (const feature of geojson.features) {
    const geom = feature?.geometry;
    const highway = feature?.properties?.highway ?? null;
    if (!geom) continue;

    const oneway = feature?.properties?.oneway ?? null;
    if (geom.type === 'LineString' && Array.isArray(geom.coordinates)) {
      lines.push({ highway, oneway, coords: geom.coordinates });
    } else if (geom.type === 'MultiLineString' && Array.isArray(geom.coordinates)) {
      for (const line of geom.coordinates) {
        if (Array.isArray(line)) lines.push({ highway, oneway, coords: line });
      }
    }
  }

  return lines;
}

function compactLineToCoords(flat) {
  if (!Array.isArray(flat) || flat.length < 4 || flat.length % 2 !== 0) return null;
  const coords = [];
  for (let i = 0; i < flat.length; i += 2) {
    const lon = flat[i];
    const lat = flat[i + 1];
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    coords.push([lon, lat]);
  }
  return coords.length >= 2 ? coords : null;
}

export function extractRoadLinesFromCompact(data) {
  const lines = [];
  if (!data || data.format !== COMPACT_ROADS_FORMAT) return lines;
  if (!Array.isArray(data.lines)) return lines;

  // v1: flat arrays; v2: {h,c} objects
  if (data.version !== 1 && data.version !== 2) return lines;

  for (const line of data.lines) {
    const flat = Array.isArray(line) ? line : line?.c;
    const coords = compactLineToCoords(flat);
    if (coords) lines.push(coords);
  }

  return lines;
}

export function extractRoadLinesWithMetaFromCompact(data) {
  const lines = [];
  if (!data || data.format !== COMPACT_ROADS_FORMAT) return lines;
  if (!Array.isArray(data.lines)) return lines;
  if (data.version !== 1 && data.version !== 2) return lines;

  for (const line of data.lines) {
    if (Array.isArray(line)) {
      const coords = compactLineToCoords(line);
      if (coords) lines.push({ highway: null, coords });
      continue;
    }

    const coords = compactLineToCoords(line?.c);
    if (!coords) continue;
    const highway = typeof line?.h === 'string' ? line.h : null;
    const oneway = line?.o ?? null;
    lines.push({ highway, oneway, coords });
  }

  return lines;
}

export function extractRoadLines(data) {
  const compactLines = extractRoadLinesFromCompact(data);
  if (compactLines.length) return compactLines;
  return extractRoadLinesFromGeojson(data);
}

export function extractRoadLinesWithMeta(data) {
  const compactLines = extractRoadLinesWithMetaFromCompact(data);
  if (compactLines.length) return compactLines;
  return extractRoadLinesWithMetaFromGeojson(data);
}
