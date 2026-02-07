import test from 'node:test';
import assert from 'node:assert/strict';

import { buildRoadPointCacheFromGeojson, snapLatLonToRoadPoint } from '../road-point-cache.js';

test('roads endpoints: build candidate keys and snap to nearest road point', () => {
  const geojson = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [
            [-0.5, 0],
            [0.5, 0],
          ],
        },
      },
    ],
  };

  const bounds = { north: 1, south: -1, west: -1, east: 1 };
  const cache = buildRoadPointCacheFromGeojson(geojson, bounds, 10, 10, {
    stride: 1,
    maxPoints: 10,
  });

  assert.equal(cache.points.length, 2);
  assert.ok(cache.keys.includes('2,5'), 'expected key near lon=-0.5, lat=0');
  assert.ok(cache.keys.includes('7,5'), 'expected key near lon=0.5, lat=0');

  const snapped = snapLatLonToRoadPoint(0.2, 0.4, cache.points);
  assert.ok(snapped, 'expected snapping to return a point');
  assert.equal(snapped.lon, 0.5);
  assert.equal(snapped.lat, 0);
});
