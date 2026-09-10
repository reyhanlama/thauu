const POSTHOG_PROJECT_KEY = 'phc_BWggGWEKtcc3FY6IDpB8bmyaonML062orWKhpXSxY8t';
const POSTHOG_HOST = 'https://us.i.posthog.com';
const PRODUCTION_HOSTNAMES = new Set(['mapthis.xyz', 'www.mapthis.xyz']);

export const ANALYTICS_EVENT_CONTRACT = Object.freeze({
  app_opened: {},
  search_submitted: {},
  place_selected: {
    place_type: ['city', 'locality', 'state'],
    source: ['search', 'featured'],
  },
  map_generated: {
    place_type: ['city', 'locality', 'state'],
    style: ['editorial', 'topographic', 'blueprint', 'noir', 'signal', 'night', 'quiet'],
    detail: ['essential', 'quiet', 'balanced', 'rich', 'maximum'],
    extent: ['close', 'city', 'region'],
  },
  map_generation_failed: {
    failure_type: ['timeout', 'network', 'http', 'empty', 'unknown'],
    place_type: ['city', 'locality', 'state'],
  },
  exact_spot_confirmed: {
    place_type: ['city', 'locality', 'state'],
  },
  output_flow_opened: {},
  output_previewed: {
    format: ['phone', 'desktop', 'print'],
  },
  image_downloaded: {
    format: ['phone', 'desktop', 'print'],
    file_type: ['png', 'jpeg'],
    quality: ['best', 'high', 'small'],
  },
  image_export_failed: {
    format: ['phone', 'desktop', 'print'],
    file_type: ['png', 'jpeg'],
    quality: ['best', 'high', 'small'],
    failure_type: ['font', 'render', 'blob', 'download', 'unknown'],
  },
});

const TRANSPORT_PROPERTIES = new Set([
  'token',
  'distinct_id',
  '$insert_id',
  '$lib',
  '$lib_version',
  '$time',
]);

function productionLocation(location) {
  return location?.protocol === 'https:' && PRODUCTION_HOSTNAMES.has(location.hostname);
}

export function validateAnalyticsEvent(eventName, properties = {}) {
  const schema = ANALYTICS_EVENT_CONTRACT[eventName];
  if (!schema || !properties || Array.isArray(properties) || typeof properties !== 'object') return null;
  const propertyNames = Object.keys(properties);
  const requiredNames = Object.keys(schema);
  if (propertyNames.some(name => !(name in schema))) return null;
  if (requiredNames.some(name => !propertyNames.includes(name))) return null;
  if (requiredNames.some(name => !schema[name].includes(properties[name]))) return null;
  return Object.fromEntries(requiredNames.map(name => [name, properties[name]]));
}

export function sanitizePostHogPayload(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const applicationProperties = validateAnalyticsEvent(payload.event, Object.fromEntries(
    Object.keys(ANALYTICS_EVENT_CONTRACT[payload.event] || {}).map(name => [name, payload.properties?.[name]])
  ));
  if (!applicationProperties) return null;
  const transportProperties = Object.fromEntries(
    Object.entries(payload.properties || {}).filter(([name]) => TRANSPORT_PROPERTIES.has(name))
  );
  const sanitized = {
    event: payload.event,
    properties: { ...transportProperties, ...applicationProperties },
  };
  for (const name of ['timestamp', 'uuid']) {
    if (typeof payload[name] === 'string') sanitized[name] = payload[name];
  }
  return sanitized;
}

function loadPostHogScript(runtime, host) {
  if (!runtime.document?.head) return Promise.reject(new Error('PostHog requires a browser document.'));
  if (runtime.posthog?.init) return runtime.posthog;

  const posthog = [];
  posthog._i = [];
  posthog.init = (projectKey, configuration, name = 'posthog') => {
    const instance = name === 'posthog' ? posthog : (posthog[name] = []);
    instance.people = instance.people || [];
    for (const method of ['capture']) {
      instance[method] = (...args) => instance.push([method, ...args]);
    }
    posthog._i.push([projectKey, configuration, name]);
    const script = runtime.document.createElement('script');
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.referrerPolicy = 'no-referrer';
    script.src = `${host.replace('.i.posthog.com', '-assets.i.posthog.com')}/static/array.js`;
    runtime.document.head.append(script);
    return instance;
  };
  runtime.posthog = posthog;
  return posthog;
}

export function createAnalytics({
  runtime = globalThis,
  projectKey = POSTHOG_PROJECT_KEY,
  host = POSTHOG_HOST,
  loadSdk = loadPostHogScript,
  defer = callback => runtime.requestIdleCallback
    ? runtime.requestIdleCallback(callback, { timeout: 1800 })
    : runtime.setTimeout(callback, 0),
} = {}) {
  let sdk = null;
  let started = false;
  let unavailable = false;
  const pending = [];

  function capture(eventName, properties = {}) {
    try {
      if (!productionLocation(runtime.location) || unavailable) return false;
      const validated = validateAnalyticsEvent(eventName, properties);
      if (!validated) return false;
      if (sdk) sdk.capture(eventName, validated);
      else pending.push([eventName, validated]);
      return true;
    } catch { return false; }
  }

  function initializeNow() {
    return Promise.resolve(loadSdk(runtime, host)).then(posthog => {
      posthog.init(projectKey, {
        api_host: host,
        autocapture: false,
        capture_pageview: false,
        capture_pageleave: false,
        capture_exceptions: false,
        disable_session_recording: true,
        disable_surveys: true,
        disable_external_dependency_loading: true,
        advanced_disable_feature_flags: true,
        advanced_disable_feature_flags_on_first_load: true,
        persistence: 'memory',
        person_profiles: 'never',
        before_send: sanitizePostHogPayload,
        loaded: instance => {
          sdk = instance;
          for (const [eventName, properties] of pending.splice(0)) sdk.capture(eventName, properties);
        },
      });
      if (!sdk && posthog.capture) {
        sdk = posthog;
        for (const [eventName, properties] of pending.splice(0)) sdk.capture(eventName, properties);
      }
    }).catch(() => {
      unavailable = true;
      pending.length = 0;
    });
  }

  function initialize() {
    if (started || !productionLocation(runtime.location)) return false;
    started = true;
    try { defer(initializeNow); }
    catch { unavailable = true; }
    return true;
  }

  return Object.freeze({ capture, initialize });
}

export const analytics = createAnalytics();
