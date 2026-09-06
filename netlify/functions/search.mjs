const NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'OrreryMapArtifact/1.0 (https://github.com/reyhanlama/thauu)';
const ALLOWED_TYPES = new Set(['city', 'town', 'municipality', 'state', 'province', 'region']);
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

function coordinate(value, positive, negative) {
  return `${Math.abs(value).toFixed(4)}\u00b0 ${value >= 0 ? positive : negative}`;
}

async function nominatimRequest(query, featureType) {
  const url = new URL(NOMINATIM_SEARCH_URL);
  url.search = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    addressdetails: '1',
    limit: '8',
    featuretype: featureType,
    'accept-language': 'en',
  }).toString();

  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      'user-agent': USER_AGENT,
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Nominatim returned ${response.status}`);
  return response.json();
}

export default async function handler(request) {
  const query = new URL(request.url).searchParams.get('q')?.trim() || '';
  if (query.length < 2) return json({ places: [] }, 200, 'public, max-age=60');
  if (query.length > 120) return json({ error: 'Search is too long.', places: [] }, 400);

  const cacheKey = query.toLocaleLowerCase('en');
  if (memoryCache.has(cacheKey)) return json({ places: memoryCache.get(cacheKey) }, 200, 'public, max-age=300');

  try {
    // Keep these sequential to remain courteous to the public Nominatim service.
    const settlements = await nominatimRequest(query, 'settlement');
    const states = await nominatimRequest(query, 'state');
    const seen = new Set();
    const places = [];

    for (const item of [...settlements, ...states]) {
      const latitude = Number(item.lat);
      const longitude = Number(item.lon);
      const address = item.address || {};
      const addressType = String(item.addresstype || '').toLowerCase();
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !ALLOWED_TYPES.has(addressType)) continue;

      const identity = `${item.osm_type || ''}:${item.osm_id || ''}:${latitude.toFixed(5)}:${longitude.toFixed(5)}`;
      if (seen.has(identity)) continue;
      seen.add(identity);

      const city = address.city || address.town || address.village || address.municipality || item.name || item.display_name?.split(',')[0] || 'Place';
      const country = address.country || 'Unknown';
      places.push({
        city,
        country,
        placeType: ['state', 'province', 'region'].includes(addressType) ? 'STATE' : 'CITY',
        placeId: `${item.osm_type || 'place'}:${item.osm_id || latitude}`,
        label: item.display_name || `${city}, ${country}`,
        latNum: latitude,
        lonNum: longitude,
        lat: coordinate(latitude, 'N', 'S'),
        lon: coordinate(longitude, 'E', 'W'),
        boundingBox: item.boundingbox,
      });
      if (places.length === 8) break;
    }

    memoryCache.set(cacheKey, places);
    return json({ places }, 200, 'public, max-age=300, s-maxage=86400, stale-while-revalidate=604800');
  } catch (error) {
    console.error('Place search failed:', error);
    return json({ error: 'Place search is temporarily unavailable.', places: [] }, 502);
  }
}

