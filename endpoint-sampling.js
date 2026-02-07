import { haversineMeters } from './astar.js';

// --- Endpoint sampling ---
export const ENDPOINT_SAMPLING_MAX_TRIES = 5000;

/**
 * Attempt to sample endpoints that satisfy `minMeters` for up to `maxTries`.
 * If not possible, returns the best-effort (max-distance) pair found.
 *
 * Pure/testable: pass in `randomKey`, `toLatLon`, and optionally `rng`.
 */
export function sampleEndpointPair({
  randomKey,
  toLatLon,
  minMeters,
  maxTries = ENDPOINT_SAMPLING_MAX_TRIES,
  rng = Math.random,
  distanceFn = haversineMeters,
}) {
  let best = {
    startKey: null,
    goalKey: null,
    distanceMeters: -Infinity,
    minDistanceMet: false,
    tries: 0,
  };

  for (let tries = 0; tries < maxTries; tries++) {
    const startKey = randomKey(rng);
    const goalKey = randomKey(rng);
    const sLL = toLatLon(startKey);
    const gLL = toLatLon(goalKey);
    const d = distanceFn(sLL, gLL);

    if (d > best.distanceMeters)
      best = {
        startKey,
        goalKey,
        distanceMeters: d,
        minDistanceMet: d >= minMeters,
        tries: tries + 1,
      };

    if (d >= minMeters) {
      return { startKey, goalKey, distanceMeters: d, minDistanceMet: true, tries: tries + 1 };
    }
  }

  return best;
}
