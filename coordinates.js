// --- Coordinate helpers ---
export function bboxCenter(bounds) {
  return {
    lat: (bounds.north + bounds.south) / 2,
    lon: (bounds.east + bounds.west) / 2,
  };
}

export function applyZoom(bounds, zoom, centerOverride = null) {
  const c = centerOverride || bboxCenter(bounds);
  const latSpan = (bounds.north - bounds.south) / zoom;
  const lonSpan = (bounds.east - bounds.west) / zoom;
  return {
    north: c.lat + latSpan / 2,
    south: c.lat - latSpan / 2,
    west: c.lon - lonSpan / 2,
    east: c.lon + lonSpan / 2,
  };
}

export function getRenderBounds(simBounds, w, h) {
  const c = bboxCenter(simBounds);
  const cosLat = Math.cos((c.lat * Math.PI) / 180);
  const latSpan = simBounds.north - simBounds.south;
  const lonSpan = simBounds.east - simBounds.west;
  const simAspect = (lonSpan * cosLat) / latSpan;
  const viewAspect = w / h;
  let renderLatSpan = latSpan;
  let renderLonSpan = lonSpan;
  if (viewAspect > simAspect) {
    renderLonSpan = (latSpan * viewAspect) / cosLat;
  } else {
    renderLatSpan = (lonSpan * cosLat) / viewAspect;
  }
  return {
    north: c.lat + renderLatSpan / 2,
    south: c.lat - renderLatSpan / 2,
    west: c.lon - renderLonSpan / 2,
    east: c.lon + renderLonSpan / 2,
  };
}

export function project(lat, lon, simBounds, w, h, rotation = 0) {
  const rb = getRenderBounds(simBounds, w, h);

  const px = ((lon - rb.west) / (rb.east - rb.west)) * w;
  const py = ((rb.north - lat) / (rb.north - rb.south)) * h;

  if (rotation !== 0) {
    const theta = (rotation * Math.PI) / 180;
    const cosR = Math.cos(theta);
    const sinR = Math.sin(theta);
    const cx = w / 2;
    const cy = h / 2;
    const dx = px - cx;
    const dy = py - cy;
    return { x: cx + dx * cosR - dy * sinR, y: cy + dx * sinR + dy * cosR };
  }

  return { x: px, y: py };
}

// Pre-compute projection invariants for batch use.
// Returns a fast (lat, lon) => {x, y} function with cos/sin cached.
export function makeProjector(simBounds, w, h, rotation = 0) {
  const rb = getRenderBounds(simBounds, w, h);
  const invLon = 1 / (rb.east - rb.west);
  const invLat = 1 / (rb.north - rb.south);

  if (rotation !== 0) {
    const theta = (rotation * Math.PI) / 180;
    const cosR = Math.cos(theta);
    const sinR = Math.sin(theta);
    const cx = w / 2;
    const cy = h / 2;
    return (lat, lon) => {
      const px = (lon - rb.west) * invLon * w;
      const py = (rb.north - lat) * invLat * h;
      const dx = px - cx;
      const dy = py - cy;
      return { x: cx + dx * cosR - dy * sinR, y: cy + dx * sinR + dy * cosR };
    };
  }

  return (lat, lon) => ({
    x: (lon - rb.west) * invLon * w,
    y: (rb.north - lat) * invLat * h,
  });
}
