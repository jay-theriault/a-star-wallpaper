// --- OSM terrain data extraction (pure GeoJSON parsers) ---
export function extractLandPolys(geojson) {
  const features = geojson?.features || [];
  const polys = [];

  for (const f of features) {
    const kind = f?.properties?.kind === 'water' ? 'water' : 'land';
    const geom = f?.geometry;
    if (!geom) continue;

    // For now we keep only water polygons. "Land" polygons from OSM landuse/natural tags are
    // very patchy and tend to look blotchy; we instead paint a subtle global land tint.
    if (kind !== 'water') continue;

    if (geom.type === 'Polygon') {
      const rings = geom.coordinates || [];
      if (rings.length) polys.push({ kind, rings });
    } else if (geom.type === 'MultiPolygon') {
      const parts = geom.coordinates || [];
      for (const rings of parts) {
        if (rings?.length) polys.push({ kind, rings });
      }
    }
  }

  return polys;
}

export function extractCoastlineLines(geojson) {
  const out = [];
  const features = geojson?.features || [];
  for (const f of features) {
    const g = f?.geometry;
    if (!g) continue;
    if (g.type === 'LineString' && Array.isArray(g.coordinates)) out.push(g.coordinates);
    if (g.type === 'MultiLineString' && Array.isArray(g.coordinates)) {
      for (const line of g.coordinates) if (Array.isArray(line)) out.push(line);
    }
  }
  return out;
}

export function extractParksPolys(geojson) {
  const out = [];
  const features = geojson?.features || [];
  for (const f of features) {
    const g = f?.geometry;
    if (!g) continue;
    if (g.type === 'Polygon') out.push(g.coordinates);
    if (g.type === 'MultiPolygon') {
      for (const poly of g.coordinates || []) out.push(poly);
    }
  }
  return out;
}
