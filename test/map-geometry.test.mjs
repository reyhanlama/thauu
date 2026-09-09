import test from 'node:test';
import assert from 'node:assert/strict';

import { focusPointFromPan, projectPoint, unprojectPoint } from '../webui/map-geometry.js';

const bounds = [-22, 63, -20, 65];

test('projection and unprojection round-trip a coordinate', () => {
  const source = [-21.4, 64.2];
  const result = unprojectPoint(projectPoint(source, bounds), bounds);
  assert.ok(Math.abs(result[0] - source[0]) < 1e-9);
  assert.ok(Math.abs(result[1] - source[1]) < 1e-9);
});

test('moving the map right places the anchor farther west', () => {
  const marker = projectPoint([-21, 64], bounds);
  const result = focusPointFromPan(marker, bounds, { scale: 1.2 }, { x: 76, y: 0 });
  assert.ok(result.lon < -21);
  assert.equal(result.lat, 64);
});
