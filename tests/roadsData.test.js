import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

test("roads data: geojson parses and contains line features", async () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dataPath = path.resolve(here, "../data/osm/roads.geojson");
  const raw = await readFile(dataPath, "utf-8");
  const geo = JSON.parse(raw);

  assert.equal(geo.type, "FeatureCollection");
  assert.ok(Array.isArray(geo.features), "features array should exist");
  assert.ok(geo.features.length > 0, "expected at least one feature");

  const feature = geo.features.find((f) => f?.geometry?.type === "LineString");
  assert.ok(feature, "expected a LineString feature");
  assert.ok(Array.isArray(feature.geometry.coordinates), "coordinates array should exist");
  assert.ok(feature.geometry.coordinates.length >= 2, "LineString should contain at least two coordinates");
});
