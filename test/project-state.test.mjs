import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAPTHIS_PROJECT_VERSION,
  createProject,
  serializeProject,
  setProjectPlace,
} from '../webui/project-state.js';

const reykjavik = { city: 'Reykjavík', country: 'Iceland', latNum: 64.1466, lonNum: -21.9426 };

test('a project starts with independent search, focus, and viewport coordinates', () => {
  const project = createProject({ place: reykjavik });
  const place = project.places[0];

  assert.equal(project.version, MAPTHIS_PROJECT_VERSION);
  assert.deepEqual(place.searchCenter, { lat: 64.1466, lon: -21.9426 });
  assert.deepEqual(place.focusPoint, place.searchCenter);
  assert.deepEqual(place.viewportCenter, place.searchCenter);
  assert.notEqual(place.focusPoint, place.searchCenter);
});

test('changing place resets layout and selected output', () => {
  const project = createProject({ place: reykjavik });
  project.design.layoutVariant = 2;
  project.format = 'phone';

  setProjectPlace(project, { city: 'Mumbai', country: 'India', latNum: 19.076, lonNum: 72.8777 });

  assert.equal(project.places[0].city, 'Mumbai');
  assert.equal(project.design.layoutVariant, 0);
  assert.equal(project.format, null);
});

test('project serialization contains no runtime geometry', () => {
  const project = createProject({ place: reykjavik });
  const serialized = serializeProject(project);

  assert.equal(serialized.includes('features'), false);
  assert.equal(JSON.parse(serialized).places[0].city, 'Reykjavík');
});
