import { haversineMeters } from './astar.js';

// Versioned cache format for optional precomputed road graphs.
export const ROAD_GRAPH_FORMAT = 'osm-road-graph';
export const ROAD_GRAPH_VERSION = 2;

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

// Identify degree-2 nodes and contract chains into shortcut edges.
export function contractGraph(nodes, adjacency, costMaps) {
  const n = nodes.length;

  // Build undirected neighbor sets to identify degree-2 nodes.
  const undirectedNeighbors = new Array(n);
  for (let i = 0; i < n; i++) undirectedNeighbors[i] = new Set();
  for (let i = 0; i < n; i++) {
    for (const e of adjacency[i]) {
      undirectedNeighbors[i].add(e.to);
      undirectedNeighbors[e.to].add(i);
    }
  }

  function isDegree2(id) {
    return undirectedNeighbors[id].size === 2;
  }

  // Check if a directed edge a→b exists.
  function hasEdge(a, b) {
    return costMaps[a]?.has(b) ?? false;
  }

  function getWeight(a, b) {
    return costMaps[a]?.get(b) ?? Infinity;
  }

  const contracted = new Set(); // node IDs removed by contraction

  // Walk a chain of degree-2 nodes starting from `start` going toward `next`.
  // Returns the chain [start, m1, m2, ..., endpoint] where endpoint is NOT degree-2.
  function walkChain(start, next) {
    const chain = [start, next];
    let prev = start;
    let cur = next;
    while (isDegree2(cur) && !contracted.has(cur)) {
      const neighbors = [...undirectedNeighbors[cur]];
      const other = neighbors[0] === prev ? neighbors[1] : neighbors[0];
      if (other === start) return null; // cycle of degree-2 nodes
      prev = cur;
      cur = other;
      chain.push(cur);
    }
    return chain;
  }

  // Collect all chains to contract.
  // Start from each degree-2 node and walk in both directions.
  const visited = new Set();
  const chains = [];

  for (let i = 0; i < n; i++) {
    if (!isDegree2(i) || visited.has(i) || contracted.has(i)) continue;

    const neighbors = [...undirectedNeighbors[i]];
    // Walk from neighbor[0] through i toward neighbor[1].
    // First, find the chain endpoint in one direction.
    const chainA = walkChain(i, neighbors[0]);
    const chainB = walkChain(i, neighbors[1]);

    if (!chainA || !chainB) continue; // cycle

    // Full chain: reverse chainA (to go from endpointA ... i) + chainB (i ... endpointB)
    // chainA = [i, ..., endpointA], chainB = [i, ..., endpointB]
    // Full chain: endpointA, ..., i, ..., endpointB
    const fullChain = [...chainA.slice().reverse(), ...chainB.slice(1)];

    // Mark interior nodes as visited.
    for (let j = 1; j < fullChain.length - 1; j++) {
      visited.add(fullChain[j]);
    }

    chains.push(fullChain);
  }

  // Now apply contractions.
  for (const chain of chains) {
    if (chain.length < 3) continue;
    const A = chain[0];
    const B = chain[chain.length - 1];
    if (A === B) continue; // self-edge

    // Check forward path A→...→B
    let forwardOk = true;
    let forwardWeight = 0;
    for (let j = 0; j < chain.length - 1; j++) {
      if (!hasEdge(chain[j], chain[j + 1])) {
        forwardOk = false;
        break;
      }
      forwardWeight += getWeight(chain[j], chain[j + 1]);
    }

    // Check reverse path B→...→A
    let reverseOk = true;
    let reverseWeight = 0;
    for (let j = chain.length - 1; j > 0; j--) {
      if (!hasEdge(chain[j], chain[j - 1])) {
        reverseOk = false;
        break;
      }
      reverseWeight += getWeight(chain[j], chain[j - 1]);
    }

    if (!forwardOk && !reverseOk) continue;

    // Via geometry: intermediate node positions (lon, lat order like GeoJSON).
    const via = [];
    for (let j = 1; j < chain.length - 1; j++) {
      via.push([nodes[chain[j]].lon, nodes[chain[j]].lat]);
    }

    // Mark interior nodes as contracted.
    for (let j = 1; j < chain.length - 1; j++) {
      contracted.add(chain[j]);
    }

    // Remove old edges from A and B involving interior nodes.
    // Then add shortcut edges.
    if (forwardOk) {
      const existing = costMaps[A]?.get(B);
      if (existing == null || forwardWeight < existing) {
        costMaps[A].set(B, forwardWeight);
        // Update adjacency list for A→B.
        const adjA = adjacency[A];
        const idx = adjA.findIndex((e) => e.to === B);
        const entry = { to: B, weight: forwardWeight, via };
        if (idx >= 0) adjA[idx] = entry;
        else adjA.push(entry);
      }
    }

    if (reverseOk) {
      const existing = costMaps[B]?.get(A);
      if (existing == null || reverseWeight < existing) {
        costMaps[B].set(A, reverseWeight);
        const adjB = adjacency[B];
        const idx = adjB.findIndex((e) => e.to === A);
        const reversedVia = [...via].reverse();
        const entry = { to: A, weight: reverseWeight, via: reversedVia };
        if (idx >= 0) adjB[idx] = entry;
        else adjB.push(entry);
      }
    }
  }

  // Remove contracted nodes and re-index densely.
  if (contracted.size === 0) {
    return { nodes, adjacency, costMaps, contracted: 0 };
  }

  const oldToNew = new Array(n).fill(-1);
  const newNodes = [];
  for (let i = 0; i < n; i++) {
    if (contracted.has(i)) continue;
    oldToNew[i] = newNodes.length;
    newNodes.push({
      id: newNodes.length,
      lat: nodes[i].lat,
      lon: nodes[i].lon,
      count: nodes[i].count,
    });
  }

  const newAdjacency = new Array(newNodes.length);
  const newCostMaps = new Array(newNodes.length);

  for (let i = 0; i < newNodes.length; i++) {
    newAdjacency[i] = [];
    newCostMaps[i] = new Map();
  }

  for (let oldId = 0; oldId < n; oldId++) {
    if (contracted.has(oldId)) continue;
    const newId = oldToNew[oldId];
    for (const e of adjacency[oldId]) {
      if (contracted.has(e.to)) continue;
      const newTo = oldToNew[e.to];
      if (newTo < 0) continue;
      const entry = { to: newTo, weight: e.weight };
      if (e.via) entry.via = e.via;
      newAdjacency[newId].push(entry);
      newCostMaps[newId].set(newTo, e.weight);
    }
  }

  return {
    nodes: newNodes,
    adjacency: newAdjacency,
    costMaps: newCostMaps,
    contracted: contracted.size,
  };
}

export function buildRoadGraph(
  lines,
  { toleranceMeters = 10, bounds = null, maxNodes = 250000, contract = true } = {},
) {
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

  for (const rawLine of lines || []) {
    // Support both plain [[lon,lat], ...] arrays and {coords, oneway} objects.
    const line = Array.isArray(rawLine) ? rawLine : rawLine?.coords;
    const oneway = Array.isArray(rawLine) ? null : rawLine?.oneway;
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
        if (oneway === 'yes' || oneway === '1') {
          addEdge(prevId, id, w); // forward only
        } else if (oneway === '-1') {
          addEdge(id, prevId, w); // reverse only
        } else {
          addEdge(prevId, id, w);
          addEdge(id, prevId, w);
        }
      }
      prevId = id;
    }
  }

  let adjacency = adjacencyMaps.map((map) => Array.from(map, ([to, weight]) => ({ to, weight })));
  let costMaps = adjacencyMaps.map((map) => map);

  if (contract) {
    const result = contractGraph(nodes, adjacency, costMaps);
    const edges = result.adjacency.reduce((acc, list) => acc + list.length, 0);
    return {
      nodes: result.nodes,
      adjacency: result.adjacency,
      costMaps: result.costMaps,
      edges,
      toleranceMeters,
    };
  }

  const edges = adjacency.reduce((acc, list) => acc + list.length, 0);
  return {
    nodes,
    adjacency,
    costMaps,
    edges,
    toleranceMeters,
  };
}

// Compatibility alias used by cache tooling.
export function buildRoadGraphFromLines(lines, options = {}) {
  const toleranceMeters = options.snapToleranceMeters ?? options.toleranceMeters ?? 10;
  const bounds = options.bounds ?? null;
  const maxNodes = options.maxNodes ?? 250000;
  const contract = options.contract ?? true;
  return buildRoadGraph(lines, { toleranceMeters, bounds, maxNodes, contract });
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

export function parseRoadGraphCache(payload) {
  if (!payload || payload.format !== ROAD_GRAPH_FORMAT) return null;
  if (payload.version !== 1 && payload.version !== 2) return null;
  if (!Array.isArray(payload.nodes) || !Array.isArray(payload.edges)) return null;

  const nodes = payload.nodes.map((n, idx) => ({
    id: idx,
    lat: n?.lat,
    lon: n?.lon,
    count: 1,
  }));

  // payload.edges: Array<Array<[to, weight] | [to, weight, [[lon,lat], ...]]>>
  const edgesRaw = payload.edges;
  const adjacency = edgesRaw.map((list) =>
    (list || []).map((tuple) => {
      const entry = { to: tuple?.[0], weight: tuple?.[1] };
      if (Array.isArray(tuple?.[2])) entry.via = tuple[2];
      return entry;
    }),
  );
  const costMaps = edgesRaw.map((list) => {
    const m = new Map();
    for (const tuple of list || []) {
      const to = tuple?.[0];
      const w = tuple?.[1];
      if (Number.isInteger(to) && Number.isFinite(w)) m.set(to, w);
    }
    return m;
  });

  const edges = adjacency.reduce((acc, list) => acc + list.length, 0);

  return {
    nodes,
    adjacency,
    costMaps,
    edges,
    toleranceMeters:
      payload?.options?.snapToleranceMeters ?? payload?.options?.toleranceMeters ?? 10,
  };
}
