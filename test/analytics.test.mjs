import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ANALYTICS_EVENT_CONTRACT,
  createAnalytics,
  sanitizePostHogPayload,
  validateAnalyticsEvent,
} from '../webui/analytics.js';

function productionRuntime(hostname = 'mapthis.xyz') {
  return { location: { protocol: 'https:', hostname }, setTimeout };
}

function fakeSdk() {
  const captures = [];
  let configuration;
  let initializedKey;
  const sdk = {
    captures,
    init(key, config) {
      initializedKey = key;
      configuration = config;
      config.loaded(sdk);
    },
    capture(eventName, properties) { captures.push([eventName, properties]); },
    get configuration() { return configuration; },
    get initializedKey() { return initializedKey; },
  };
  return sdk;
}

test('analytics initializes only on exact canonical HTTPS hostnames', async () => {
  for (const [protocol, hostname] of [
    ['http:', 'mapthis.xyz'],
    ['https:', 'preview.mapthis.xyz'],
    ['https:', 'mapthis.xyz.example'],
    ['https:', 'localhost'],
  ]) {
    let loads = 0;
    const analytics = createAnalytics({
      runtime: { location: { protocol, hostname }, setTimeout },
      loadSdk: () => { loads += 1; return fakeSdk(); },
      defer: callback => callback(),
    });
    assert.equal(analytics.initialize(), false);
    assert.equal(loads, 0);
    assert.equal(analytics.capture('app_opened'), false);
  }

  for (const hostname of ['mapthis.xyz', 'www.mapthis.xyz']) {
    let loads = 0;
    const analytics = createAnalytics({
      runtime: productionRuntime(hostname),
      loadSdk: () => { loads += 1; return fakeSdk(); },
      defer: callback => callback(),
    });
    assert.equal(analytics.initialize(), true);
    await Promise.resolve();
    assert.equal(loads, 1);
  }
});

test('the complete event dictionary accepts only exact categorical payloads', () => {
  assert.deepEqual(Object.keys(ANALYTICS_EVENT_CONTRACT), [
    'app_opened', 'search_submitted', 'place_selected', 'map_generated',
    'map_generation_failed', 'exact_spot_confirmed', 'output_flow_opened',
    'output_previewed', 'image_downloaded', 'image_export_failed',
  ]);
  assert.deepEqual(validateAnalyticsEvent('map_generated', {
    place_type: 'locality', style: 'quiet', detail: 'rich', extent: 'close',
  }), { place_type: 'locality', style: 'quiet', detail: 'rich', extent: 'close' });
  assert.deepEqual(validateAnalyticsEvent('app_opened'), {});
  assert.equal(validateAnalyticsEvent('unknown_event'), null);
  assert.equal(validateAnalyticsEvent('app_opened', { url: 'https://mapthis.xyz/private' }), null);
  assert.equal(validateAnalyticsEvent('place_selected', { place_type: 'city', source: 'search', city: 'Private' }), null);
  assert.equal(validateAnalyticsEvent('place_selected', { place_type: 'village', source: 'search' }), null);
  assert.equal(validateAnalyticsEvent('place_selected', { place_type: 'city' }), null);
});

test('capture rejects invalid data before the SDK and uses restrictive nonpersistent settings', async () => {
  const sdk = fakeSdk();
  const analytics = createAnalytics({
    runtime: productionRuntime(), loadSdk: () => sdk, defer: callback => callback(),
  });
  analytics.initialize();
  analytics.capture('place_selected', { place_type: 'city', source: 'search' });
  analytics.capture('place_selected', { place_type: 'city', source: 'search', coordinates: '0,0' });
  analytics.capture('app_opened', { referrer: 'private' });
  await Promise.resolve();
  assert.deepEqual(sdk.captures, [['place_selected', { place_type: 'city', source: 'search' }]]);
  assert.equal(sdk.configuration.autocapture, false);
  assert.equal(sdk.configuration.capture_pageview, false);
  assert.equal(sdk.configuration.capture_pageleave, false);
  assert.equal(sdk.configuration.capture_exceptions, false);
  assert.equal(sdk.configuration.disable_session_recording, true);
  assert.equal(sdk.configuration.disable_external_dependency_loading, true);
  assert.equal(sdk.configuration.persistence, 'memory');
  assert.equal(sdk.configuration.person_profiles, 'never');
  assert.equal(sdk.configuration.api_host, 'https://us.i.posthog.com');
  assert.match(sdk.initializedKey, /^phc_[A-Za-z0-9]+$/);
});

test('vendor payload sanitizer removes URL, referrer, device, session, and DOM metadata', () => {
  const sanitized = sanitizePostHogPayload({
    event: 'output_previewed',
    url: 'https://mapthis.xyz/private',
    properties: {
      format: 'desktop', token: 'public', distinct_id: 'ephemeral', '$lib': 'web',
      '$current_url': 'https://mapthis.xyz/?place=private', '$referrer': 'private',
      '$device_id': 'device', '$session_id': 'session', '$el_text': 'private inscription',
    },
  });
  assert.deepEqual(sanitized, {
    event: 'output_previewed',
    properties: { token: 'public', distinct_id: 'ephemeral', '$lib': 'web', format: 'desktop' },
  });
  assert.equal(sanitizePostHogPayload({ event: 'not_allowed', properties: {} }), null);
});

test('SDK load and capture failures are silent and do not escape', async () => {
  const unavailable = createAnalytics({
    runtime: productionRuntime(),
    loadSdk: () => Promise.reject(new Error('blocked')),
    defer: callback => callback(),
  });
  assert.doesNotThrow(() => unavailable.initialize());
  assert.equal(unavailable.capture('app_opened'), true);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(unavailable.capture('app_opened'), false);

  const sdk = fakeSdk();
  sdk.capture = () => { throw new Error('storage unavailable'); };
  const failingCapture = createAnalytics({
    runtime: productionRuntime(), loadSdk: () => sdk, defer: callback => callback(),
  });
  failingCapture.initialize();
  await Promise.resolve();
  assert.doesNotThrow(() => failingCapture.capture('app_opened'));
  assert.equal(failingCapture.capture('app_opened'), false);
});
