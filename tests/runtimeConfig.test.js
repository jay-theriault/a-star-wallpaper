import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_CONFIG, parseRuntimeConfig } from "../main.js";

test("parseRuntimeConfig defaults remain when no mode is provided", () => {
  const cfg = parseRuntimeConfig("");
  assert.equal(cfg.mode, null);
  assert.equal(cfg.stepsPerSecond, DEFAULT_CONFIG.stepsPerSecond);
  assert.equal(cfg.maxStepsPerFrame, DEFAULT_CONFIG.maxStepsPerFrame);
  assert.equal(cfg.hud, DEFAULT_CONFIG.hud);
  assert.equal(cfg.showOpenClosed, DEFAULT_CONFIG.showOpenClosed);
  assert.equal(cfg.showCurrent, DEFAULT_CONFIG.showCurrent);
  assert.equal(cfg.showRoads, DEFAULT_CONFIG.showRoads);
});

test("parseRuntimeConfig chill preset applies bundled toggles", () => {
  const cfg = parseRuntimeConfig("?mode=chill");
  assert.equal(cfg.mode, "chill");
  assert.equal(cfg.hud, 0);
  assert.equal(cfg.stepsPerSecond, 12);
  assert.equal(cfg.maxStepsPerFrame, 30);
  assert.equal(cfg.showOpenClosed, 0);
  assert.equal(cfg.showCurrent, 0);
});

test("parseRuntimeConfig debug preset applies bundled toggles", () => {
  const cfg = parseRuntimeConfig("?mode=debug");
  assert.equal(cfg.mode, "debug");
  assert.equal(cfg.hud, 1);
  assert.equal(cfg.stepsPerSecond, 45);
  assert.equal(cfg.maxStepsPerFrame, 140);
  assert.equal(cfg.showPathDuringSearch, 1);
});

test("parseRuntimeConfig allows explicit params to override presets", () => {
  const cfg = parseRuntimeConfig("?mode=chill&hud=1&sps=50");
  assert.equal(cfg.mode, "chill");
  assert.equal(cfg.hud, 1);
  assert.equal(cfg.stepsPerSecond, 50);
  assert.equal(cfg.maxStepsPerFrame, 30);
});
