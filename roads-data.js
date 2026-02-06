export const COMPACT_ROADS_FORMAT = "osm-roads-compact";
export const COMPACT_ROADS_VERSION = 1;

export function extractRoadLinesFromGeojson(geojson) {
  const lines = [];
  if (!geojson || geojson.type !== "FeatureCollection" || !Array.isArray(geojson.features)) return lines;

  for (const feature of geojson.features) {
    const geom = feature?.geometry;
    if (!geom) continue;
    if (geom.type === "LineString" && Array.isArray(geom.coordinates)) {
      lines.push(geom.coordinates);
    } else if (geom.type === "MultiLineString" && Array.isArray(geom.coordinates)) {
      for (const line of geom.coordinates) {
        if (Array.isArray(line)) lines.push(line);
      }
    }
  }

  return lines;
}

export function extractRoadLinesFromCompact(data) {
  const lines = [];
  if (!data || data.format !== COMPACT_ROADS_FORMAT || data.version !== COMPACT_ROADS_VERSION) return lines;
  if (!Array.isArray(data.lines)) return lines;

  for (const line of data.lines) {
    if (!Array.isArray(line) || line.length < 4 || line.length % 2 !== 0) continue;
    const coords = [];
    for (let i = 0; i < line.length; i += 2) {
      const lon = line[i];
      const lat = line[i + 1];
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      coords.push([lon, lat]);
    }
    if (coords.length >= 2) lines.push(coords);
  }

  return lines;
}

export function extractRoadLines(data) {
  const compactLines = extractRoadLinesFromCompact(data);
  if (compactLines.length) return compactLines;
  return extractRoadLinesFromGeojson(data);
}
