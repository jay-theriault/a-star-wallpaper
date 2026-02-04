// Minimal A* implementation with step-by-step iterator

export function haversineMeters(a, b) {
  // a/b: {lat, lon}
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLon / 2);
  const h = s1 * s1 + Math.cos(lat1) * Math.cos(lat2) * s2 * s2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function reconstructPath(cameFrom, currentKey) {
  const path = [currentKey];
  while (cameFrom.has(currentKey)) {
    currentKey = cameFrom.get(currentKey);
    path.push(currentKey);
  }
  path.reverse();
  return path;
}

export function makeAStarStepper({
  startKey,
  goalKey,
  neighbors,
  cost,
  heuristic,
}) {
  // Open set stored as Map<key, fScore> + a simple array priority queue.
  // For this visual demo, simplicity > optimal perf.
  const openSet = new Set([startKey]);
  const closedSet = new Set();
  const cameFrom = new Map();

  const gScore = new Map([[startKey, 0]]);
  const fScore = new Map([[startKey, heuristic(startKey, goalKey)]]);

  function lowestFInOpen() {
    let bestKey = null;
    let bestF = Infinity;
    for (const k of openSet) {
      const f = fScore.get(k) ?? Infinity;
      if (f < bestF) {
        bestF = f;
        bestKey = k;
      }
    }
    return bestKey;
  }

  let done = false;
  let result = null;
  let steps = 0;

  return {
    step() {
      if (done) return { done: true, ...result };

      const current = lowestFInOpen();
      if (current == null) {
        done = true;
        result = { status: "no-path" };
        return { done: true, ...result };
      }

      steps += 1;

      // goal reached
      if (current === goalKey) {
        done = true;
        const path = reconstructPath(cameFrom, current);
        result = { status: "found", path, steps };
        return { done: true, ...result };
      }

      openSet.delete(current);
      closedSet.add(current);

      for (const nb of neighbors(current)) {
        if (closedSet.has(nb)) continue;

        const tentativeG = (gScore.get(current) ?? Infinity) + cost(current, nb);
        if (!openSet.has(nb)) openSet.add(nb);

        if (tentativeG < (gScore.get(nb) ?? Infinity)) {
          cameFrom.set(nb, current);
          gScore.set(nb, tentativeG);
          fScore.set(nb, tentativeG + heuristic(nb, goalKey));
        }
      }

      return {
        done: false,
        status: "searching",
        current,
        openSet,
        closedSet,
        cameFrom,
        gScore,
        fScore,
        steps,
      };
    },

    getState() {
      return { openSet, closedSet, cameFrom, gScore, fScore, steps };
    },
  };
}
