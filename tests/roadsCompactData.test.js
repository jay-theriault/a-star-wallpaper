import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { extractRoadLinesFromCompact } from "../roads-data.js";

test("roads data: compact format parses into line arrays", async () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dataPath = path.resolve(here, "./fixtures/roads.compact.json");
  const raw = await readFile(dataPath, "utf-8");
  const compact = JSON.parse(raw);

  const lines = extractRoadLinesFromCompact(compact);
  assert.ok(Array.isArray(lines), "lines should be an array");
  assert.ok(lines.length > 0, "expected at least one line");

  const first = lines[0];
  assert.ok(Array.isArray(first), "line should be an array of coordinates");
  assert.ok(first.length >= 2, "line should contain at least two coordinates");
  assert.ok(Array.isArray(first[0]), "coordinate should be an array");
  assert.equal(first[0].length, 2, "coordinate should be [lon, lat]");
});
