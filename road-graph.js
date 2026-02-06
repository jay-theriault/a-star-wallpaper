import { haversineMeters } from "./astar.js";

const EARTH_METERS_PER_DEG = 111320;

function inBounds(lat, lon, bounds) {
  if (!bounds) return true;
  return lat <= bounds.north && lat >= bounds.south && lon >= bounds.west && lon <= bounds.east;
}

function makeQuantizer(toleranceMeters) {
  const step = Math.max(1e-9, toleranceMeters / EARTH_METERS_PER_DEG);
  return {
    step,
    key(lat, lon) {
      const qLat = Math.round(lat / step);
      const qLon = Math.round(lon / step);
      return `${qLat},${qLon}`;
    },
  };
}

export function buildRoadGraph(lines, { toleranceMeters = 10, bounds = null, maxNodes = 250000 } = {}) {
  const quant = makeQuantizer(toleranceMeters);
  const nodeIndex = new Map();
  const nodes = [];
  const adjacencyMaps = [];

  function getNodeId(lat, lon) {
    const k = quant.key(lat, lon);
    const existing = nodeIndex.get(k);
    if (existing != null) {
      const node = nodes[existing];
      node.count += 1;
      const t = 1 / node.count;
      node.lat += (lat - node.lat) * t;
      node.lon += (lon - node.lon) * t;
      return existing;
    }

    if (nodes.length >= maxNodes) return null;
    const id = nodes.length;
    nodeIndex.set(k, id);
    nodes.push({ id, lat, lon, count: 1 });
    adjacencyMaps[id] = new Map();
    return id;
  }

  function addEdge(a, b, weight) {
    if (a == null || b == null) return;
    if (a === b) return;
    const mapA = adjacencyMaps[a];
    const prev = mapA.get(b);
    if (prev == null || weight < prev) mapA.set(b, weight);
  }

  for (const line of lines || []) {
    if (!Array.isArray(line) || line.length < 2) continue;
    let prevId = null;
    for (const coord of line) {
      if (!Array.isArray(coord) || coord.length < 2) continue;
      const [lon, lat] = coord;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      if (!inBounds(lat, lon, bounds)) {
        prevId = null;
        continue;
      }
      const id = getNodeId(lat, lon);
      if (id == null) continue;
      if (prevId != null && prevId !== id) {
        const a = nodes[prevId];
        const b = nodes[id];
        const w = haversineMeters(a, b);
        addEdge(prevId, id, w);
        addEdge(id, prevId, w);
      }
      prevId = id;
    }
  }

  const adjacency = adjacencyMaps.map((map) => Array.from(map, ([to, weight]) => ({ to, weight })));
  const costMaps = adjacencyMaps.map((map) => map);
  const edges = adjacency.reduce((acc, list) => acc + list.length, 0);

  return {
    nodes,
    adjacency,
    costMaps,
    edges,
    toleranceMeters,
  };
}

export function randomGraphNode(graph, rng = Math.random) {
  if (!graph?.nodes?.length) return null;
  const idx = Math.floor(rng() * graph.nodes.length);
  return graph.nodes[idx]?.id ?? idx;
}

export function graphNodeLatLon(graph, id) {
  const node = graph?.nodes?.[id];
  if (!node) return null;
  return { lat: node.lat, lon: node.lon };
}

export function findNearestGraphNode(graph, lat, lon) {
  if (!graph?.nodes?.length) return null;
  let best = null;
  let bestD = Infinity;
  for (const node of graph.nodes) {
    const d = (node.lat - lat) * (node.lat - lat) + (node.lon - lon) * (node.lon - lon);
    if (d < bestD) {
      bestD = d;
      best = node.id;
    }
  }
  return best;
}
