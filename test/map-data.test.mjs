import test from 'node:test';
import assert from 'node:assert/strict';

import { selectFeatures } from '../netlify/functions/map-data.mjs';

function feature(kind, featureClass, id) {
  return { kind, class: featureClass, id, coordinates: [[0, 0], [1, 1]] };
}

test('dense road data cannot crowd out geographic context', () => {
  const roads = Array.from({ length: 4000 }, (_, index) => feature('road', 'residential', `road-${index}`));
  const water = Array.from({ length: 20 }, (_, index) => feature('water', 'water', `water-${index}`));
  const waterways = Array.from({ length: 12 }, (_, index) => feature('waterway', 'river', `river-${index}`));
  const rail = Array.from({ length: 8 }, (_, index) => feature('rail', 'rail', `rail-${index}`));

  const selected = selectFeatures([...roads, ...water, ...waterways, ...rail]);

  assert.equal(selected.length, 3200);
  assert.equal(selected.filter(item => item.kind === 'water').length, water.length);
  assert.equal(selected.filter(item => item.kind === 'waterway').length, waterways.length);
  assert.equal(selected.filter(item => item.kind === 'rail').length, rail.length);
});

test('major roads are ordered ahead of less important roads', () => {
  const selected = selectFeatures([
    feature('road', 'tertiary', 'tertiary'),
    feature('road', 'secondary', 'secondary'),
    feature('road', 'motorway', 'motorway'),
    feature('road', 'primary', 'primary'),
  ], 4);

  assert.deepEqual(selected.map(item => item.id), ['motorway', 'primary', 'secondary', 'tertiary']);
});

test('small responses are returned without duplication', () => {
  const input = [
    feature('water', 'water', 'lake'),
    feature('rail', 'rail', 'rail'),
    feature('road', 'primary', 'road'),
  ];

  const selected = selectFeatures(input);
  assert.equal(selected.length, input.length);
  assert.equal(new Set(selected).size, input.length);
});
