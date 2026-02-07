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

// Binary min-heap keyed by priority (f-score).
// O(log n) push/pop/decreaseKey, O(1) has/size.
class MinHeap {
  constructor() {
    this._heap = []; // [{key, priority}]
    this._index = new Map(); // key → index in _heap
  }

  get size() {
    return this._heap.length;
  }

  has(key) {
    return this._index.has(key);
  }

  push(key, priority) {
    if (this._index.has(key)) {
      this.decreaseKey(key, priority);
      return;
    }
    const i = this._heap.length;
    this._heap.push({ key, priority });
    this._index.set(key, i);
    this._bubbleUp(i);
  }

  pop() {
    if (this._heap.length === 0) return undefined;
    const top = this._heap[0];
    const last = this._heap.pop();
    this._index.delete(top.key);
    if (this._heap.length > 0) {
      this._heap[0] = last;
      this._index.set(last.key, 0);
      this._sinkDown(0);
    }
    return top.key;
  }

  decreaseKey(key, priority) {
    const i = this._index.get(key);
    if (i === undefined) return;
    if (priority < this._heap[i].priority) {
      this._heap[i].priority = priority;
      this._bubbleUp(i);
    }
  }

  // Return a Set of all keys (for backward-compatible openSet in step results)
  keys() {
    return new Set(this._heap.map((e) => e.key));
  }

  _bubbleUp(i) {
    const heap = this._heap;
    const idx = this._index;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[i].priority >= heap[parent].priority) break;
      idx.set(heap[i].key, parent);
      idx.set(heap[parent].key, i);
      const tmp = heap[i];
      heap[i] = heap[parent];
      heap[parent] = tmp;
      i = parent;
    }
  }

  _sinkDown(i) {
    const heap = this._heap;
    const idx = this._index;
    const n = heap.length;
    while (true) {
      let smallest = i;
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      if (left < n && heap[left].priority < heap[smallest].priority) smallest = left;
      if (right < n && heap[right].priority < heap[smallest].priority) smallest = right;
      if (smallest === i) break;
      idx.set(heap[i].key, smallest);
      idx.set(heap[smallest].key, i);
      const tmp = heap[i];
      heap[i] = heap[smallest];
      heap[smallest] = tmp;
      i = smallest;
    }
  }
}

export function makeAStarStepper({
  startKey,
  goalKey,
  neighbors,
  cost,
  heuristic,
  isValidNode,
  maxSteps,
}) {
  const isValid = (k) => (typeof isValidNode === 'function' ? !!isValidNode(k) : true);

  // Fast-fail if start/goal invalid
  if (!isValid(startKey) || !isValid(goalKey)) {
    return {
      step() {
        return { done: true, status: 'invalid-endpoints' };
      },
      getState() {
        return {
          openSet: new Set(),
          closedSet: new Set(),
          cameFrom: new Map(),
          gScore: new Map(),
          fScore: new Map(),
          steps: 0,
        };
      },
    };
  }

  const openHeap = new MinHeap();
  const closedSet = new Set();
  const cameFrom = new Map();

  const gScore = new Map([[startKey, 0]]);
  const fScore = new Map([[startKey, heuristic(startKey, goalKey)]]);
  openHeap.push(startKey, fScore.get(startKey));

  let done = false;
  let result = null;
  let steps = 0;

  return {
    step() {
      if (done) return { done: true, ...result };

      if (Number.isFinite(maxSteps) && steps >= maxSteps) {
        done = true;
        result = { status: 'max-steps', steps };
        return { done: true, ...result };
      }

      if (openHeap.size === 0) {
        done = true;
        result = { status: 'no-path', steps };
        return { done: true, ...result };
      }

      const current = openHeap.pop();

      steps += 1;

      // goal reached
      if (current === goalKey) {
        done = true;
        const path = reconstructPath(cameFrom, current);
        result = { status: 'found', path, steps };
        return { done: true, ...result };
      }

      closedSet.add(current);

      for (const nb of neighbors(current)) {
        if (!isValid(nb)) continue;
        if (closedSet.has(nb)) continue;

        const tentativeG = (gScore.get(current) ?? Infinity) + cost(current, nb);

        if (tentativeG < (gScore.get(nb) ?? Infinity)) {
          cameFrom.set(nb, current);
          gScore.set(nb, tentativeG);
          const f = tentativeG + heuristic(nb, goalKey);
          fScore.set(nb, f);
          // push handles both insert and decreaseKey
          openHeap.push(nb, f);
        } else if (!openHeap.has(nb) && !closedSet.has(nb)) {
          const f = (gScore.get(nb) ?? Infinity) + heuristic(nb, goalKey);
          fScore.set(nb, f);
          openHeap.push(nb, f);
        }
      }

      return {
        done: false,
        status: 'searching',
        current,
        openSet: openHeap.keys(),
        closedSet,
        cameFrom,
        gScore,
        fScore,
        steps,
      };
    },

    getState() {
      return { openSet: openHeap.keys(), closedSet, cameFrom, gScore, fScore, steps };
    },
  };
}
