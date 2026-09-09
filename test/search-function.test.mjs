import assert from 'node:assert/strict';
import test from 'node:test';

import handler, { normalizeGeoapifyFeature } from '../netlify/functions/search.mjs';

function request(query) {
  return new Request(`https://mapthis.xyz/api/search?q=${encodeURIComponent(query)}`);
}

function feature(overrides = {}) {
  return {
    type: 'Feature',
    bbox: [77.55, 12.91, 77.66, 13.03],
    geometry: { type: 'Point', coordinates: [77.5946, 12.9716] },
    properties: {
      place_id: 'geoapify-place-1',
      result_type: 'suburb',
      name: 'Indiranagar',
      city: 'Bengaluru',
      state: 'Karnataka',
      country: 'India',
      formatted: 'Indiranagar, Bengaluru, Karnataka, India',
      lat: 12.9716,
      lon: 77.5946,
      ...overrides,
    },
  };
}

test('normalizes a Geoapify locality to the existing frontend schema', () => {
  assert.deepEqual(normalizeGeoapifyFeature(feature()), {
    city: 'Indiranagar',
    country: 'India',
    parentCity: 'Bengaluru',
    parentLabel: 'Bengaluru, India',
    contextLabel: 'Bengaluru · Karnataka · India',
    placeType: 'LOCALITY',
    placeId: 'geoapify-place-1',
    label: 'Indiranagar, Bengaluru, Karnataka, India',
    latNum: 12.9716,
    lonNum: 77.5946,
    lat: '12.9716° N',
    lon: '77.5946° E',
    boundingBox: ['12.91', '13.03', '77.55', '77.66'],
  });
});

test('ignores non-geographic autocomplete results', () => {
  assert.equal(normalizeGeoapifyFeature(feature({ result_type: 'amenity' })), null);
});

test('does not call the provider before three characters', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('fetch should not be called'); };
  try {
    const response = await handler(request('ab'));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { places: [] });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('returns a distinct configuration error when the API key is missing', async () => {
  const originalKey = process.env.GEOAPIFY_API_KEY;
  delete process.env.GEOAPIFY_API_KEY;
  try {
    const response = await handler(request('missing-key-place'));
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, 'SEARCH_NOT_CONFIGURED');
  } finally {
    if (originalKey === undefined) delete process.env.GEOAPIFY_API_KEY;
    else process.env.GEOAPIFY_API_KEY = originalKey;
  }
});

test('normalizes, filters, and deduplicates provider results', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEOAPIFY_API_KEY;
  process.env.GEOAPIFY_API_KEY = 'server-only-test-key';
  globalThis.fetch = async url => {
    assert.equal(url.searchParams.get('apiKey'), 'server-only-test-key');
    assert.equal(url.searchParams.get('type'), 'locality');
    return Response.json({ features: [feature(), feature(), feature({ result_type: 'amenity', name: 'Cafe' })] });
  };
  try {
    const response = await handler(request('indiranagar-test'));
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.places.length, 1);
    assert.equal(payload.places[0].placeType, 'LOCALITY');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEOAPIFY_API_KEY;
    else process.env.GEOAPIFY_API_KEY = originalKey;
  }
});

test('surfaces provider quota exhaustion distinctly', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEOAPIFY_API_KEY;
  process.env.GEOAPIFY_API_KEY = 'server-only-test-key';
  globalThis.fetch = async () => new Response('', { status: 429 });
  try {
    const response = await handler(request('quota-test-place'));
    const payload = await response.json();
    assert.equal(response.status, 429);
    assert.equal(payload.code, 'SEARCH_QUOTA_EXCEEDED');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEOAPIFY_API_KEY;
    else process.env.GEOAPIFY_API_KEY = originalKey;
  }
});
