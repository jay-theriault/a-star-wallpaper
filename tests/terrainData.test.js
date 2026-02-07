import test from 'node:test';
import assert from 'node:assert/strict';
import { extractLandMassPolys } from '../terrain-data.js';

test('extractLandMassPolys returns rings for Polygon features', () => {
  const geojson = {
    features: [
      {
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [-71, 42],
              [-71, 43],
              [-70, 43],
              [-70, 42],
              [-71, 42],
            ],
          ],
        },
      },
    ],
  };

  const result = extractLandMassPolys(geojson);
  assert.equal(result.length, 1);
  assert.equal(result[0].length, 1);
  assert.equal(result[0][0].length, 5);
});

test('extractLandMassPolys returns rings for MultiPolygon features', () => {
  const geojson = {
    features: [
      {
        geometry: {
          type: 'MultiPolygon',
          coordinates: [
            [
              [
                [-71, 42],
                [-71, 43],
                [-70, 43],
                [-71, 42],
              ],
            ],
            [
              [
                [-72, 42],
                [-72, 43],
                [-71.5, 43],
                [-72, 42],
              ],
            ],
          ],
        },
      },
    ],
  };

  const result = extractLandMassPolys(geojson);
  assert.equal(result.length, 2);
});

test('extractLandMassPolys returns empty array for null input', () => {
  assert.deepEqual(extractLandMassPolys(null), []);
  assert.deepEqual(extractLandMassPolys(undefined), []);
});

test('extractLandMassPolys returns empty array for missing features', () => {
  assert.deepEqual(extractLandMassPolys({}), []);
  assert.deepEqual(extractLandMassPolys({ features: [] }), []);
});

test('extractLandMassPolys skips features with null geometry', () => {
  const geojson = {
    features: [{ geometry: null }, { properties: {} }],
  };

  assert.deepEqual(extractLandMassPolys(geojson), []);
});

test('extractLandMassPolys skips non-polygon geometry types', () => {
  const geojson = {
    features: [
      {
        geometry: {
          type: 'LineString',
          coordinates: [
            [-71, 42],
            [-70, 43],
          ],
        },
      },
      {
        geometry: {
          type: 'Point',
          coordinates: [-71, 42],
        },
      },
    ],
  };

  assert.deepEqual(extractLandMassPolys(geojson), []);
});

test('extractLandMassPolys handles mixed Polygon and MultiPolygon', () => {
  const geojson = {
    features: [
      {
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [-71, 42],
              [-71, 43],
              [-70, 43],
              [-71, 42],
            ],
          ],
        },
      },
      {
        geometry: {
          type: 'MultiPolygon',
          coordinates: [
            [
              [
                [-72, 42],
                [-72, 43],
                [-71.5, 43],
                [-72, 42],
              ],
            ],
          ],
        },
      },
    ],
  };

  const result = extractLandMassPolys(geojson);
  assert.equal(result.length, 2);
});
