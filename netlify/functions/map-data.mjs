const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const USER_AGENT = 'MapThis/1.0 (https://mapthis.xyz)';
const memoryCache = new Map();

function json(payload, status = 200, cacheControl = 'no-store') {
  return Response.json(payload, {
    status,
    headers: {
      'cache-control': cacheControl,
      'content-type': 'application/json; charset=utf-8',
    },
  });
}

const FEATURE_BUDGET = 3200;
const FEATURE_QUOTAS = {
  water: 500,
  waterway: 350,
  rail: 350,
  majorRoad: 900,
  otherRoad: 1100,
};

function roadPriority(feature) {
  return ({ motorway: 0, trunk: 1, primary: 2, secondary: 3, tertiary: 4 })[feature.class] ?? 10;
}

/**
 * Keep the layers that make a place recognizable before filling the remaining
 * payload with minor roads. Dense cities can otherwise exhaust the response
 * budget before waterways and rail lines are reached.
 */
export function selectFeatures(features, budget = FEATURE_BUDGET) {
  const groups = {
    water: [],
    waterway: [],
    rail: [],
    majorRoad: [],
    otherRoad: [],
  };
  const majorRoads = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary']);

  for (const feature of features) {
    if (feature.kind === 'water') groups.water.push(feature);
    else if (feature.kind === 'waterway') groups.waterway.push(feature);
    else if (feature.kind === 'rail') groups.rail.push(feature);
    else if (feature.kind === 'road' && majorRoads.has(feature.class)) groups.majorRoad.push(feature);
    else if (feature.kind === 'road') groups.otherRoad.push(feature);
  }

  groups.majorRoad.sort((a, b) => roadPriority(a) - roadPriority(b));
  const selected = [];
  for (const [kind, quota] of Object.entries(FEATURE_QUOTAS)) {
    selected.push(...groups[kind].slice(0, Math.min(quota, budget - selected.length)));
    if (selected.length >= budget) return selected;
  }

  if (selected.length < budget) {
    const selectedSet = new Set(selected);
    const remainder = features
      .filter(feature => !selectedSet.has(feature))
      .sort((a, b) => roadPriority(a) - roadPriority(b));
    selected.push(...remainder.slice(0, budget - selected.length));
  }
  return selected;
}

export default async function handler(request) {
  const params = new URL(request.url).searchParams;
  const latitude = Number(params.get('lat'));
  const longitude = Number(params.get('lon'));
  const requestedRadius = Number(params.get('radius') || 3000);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return json({ error: 'Valid latitude and longitude are required.' }, 400);
  }

  const radius = Math.max(900, Math.min(Number.isFinite(requestedRadius) ? requestedRadius : 3000, 7000));
  const cacheKey = `${latitude.toFixed(4)},${longitude.toFixed(4)},${radius}`;
  if (memoryCache.has(cacheKey)) return json(memoryCache.get(cacheKey), 200, 'public, max-age=300');

  const latDelta = radius / 111320;
  const lonDelta = radius / Math.max(35000, 111320 * Math.cos(latitude * Math.PI / 180));
  const south = latitude - latDelta;
  const north = latitude + latDelta;
  const west = longitude - lonDelta;
  const east = longitude + lonDelta;
  const bbox = `${south.toFixed(6)},${west.toFixed(6)},${north.toFixed(6)},${east.toFixed(6)}`;
  const query = `[out:json][timeout:25];(`
    + `way["highway"](${bbox});`
    + `way["railway"~"rail|light_rail|tram"](${bbox});`
    + `way["waterway"~"river|canal|stream"](${bbox});`
    + `way["natural"~"water|coastline"](${bbox});`
    + `relation["natural"="water"](${bbox});`
    + ');out tags geom;';

  try {
    const response = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'user-agent': USER_AGENT,
      },
      body: new URLSearchParams({ data: query }),
      signal: AbortSignal.timeout(45000),
    });
    if (!response.ok) throw new Error(`Overpass returned ${response.status}`);
    const raw = await response.json();
    const features = [];

    for (const element of raw.elements || []) {
      const tags = element.tags || {};
      const coordinates = (element.geometry || [])
        .filter(point => Number.isFinite(point.lon) && Number.isFinite(point.lat))
        .map(point => [point.lon, point.lat]);
      if (coordinates.length < 2) continue;

      let kind;
      let featureClass;
      if (tags.highway) [kind, featureClass] = ['road', tags.highway];
      else if (tags.railway) [kind, featureClass] = ['rail', tags.railway];
      else if (['water', 'coastline'].includes(tags.natural)) [kind, featureClass] = ['water', tags.natural];
      else if (tags.waterway) [kind, featureClass] = ['waterway', tags.waterway];
      else continue;

      features.push({ kind, class: featureClass, name: tags.name, coordinates });
    }

    const payload = {
      center: [longitude, latitude],
      bounds: [west, south, east, north],
      radius,
      attribution: '\u00a9 OpenStreetMap contributors',
      features: selectFeatures(features),
    };
    memoryCache.set(cacheKey, payload);
    return json(payload, 200, 'public, max-age=300, s-maxage=86400, stale-while-revalidate=604800');
  } catch (error) {
    console.error('Map geometry failed:', error);
    return json({ error: 'Map geometry is temporarily unavailable.' }, 502);
  }
}
