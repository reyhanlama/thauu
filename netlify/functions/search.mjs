const GEOAPIFY_AUTOCOMPLETE_URL = 'https://api.geoapify.com/v1/geocode/autocomplete';
const STATE_TYPES = new Set(['state', 'province', 'region']);
const CITY_TYPES = new Set(['city', 'town', 'municipality', 'village']);
const LOCALITY_TYPES = new Set(['suburb', 'neighbourhood', 'neighborhood', 'quarter', 'city_district', 'borough', 'district', 'locality', 'local_admin']);
const memoryCache = new Map();
const MAX_CACHE_ENTRIES = 250;

class SearchProviderError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = 'SearchProviderError';
    this.code = code;
    this.status = status;
  }
}

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

function uniqueContext(parts, placeName) {
  const seen = new Set([String(placeName || '').trim().toLocaleLowerCase('en')]);
  return parts.filter(part => {
    const key = String(part || '').trim().toLocaleLowerCase('en');
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).join(' · ');
}

function normalizedBoundingBox(feature) {
  const bounds = feature.bbox;
  if (!Array.isArray(bounds) || bounds.length !== 4 || bounds.some(value => !Number.isFinite(Number(value)))) return undefined;
  const [west, south, east, north] = bounds.map(Number);
  return [south, north, west, east].map(String);
}

export function normalizeGeoapifyFeature(feature) {
  const properties = feature?.properties || {};
  const latitude = Number(properties.lat ?? feature?.geometry?.coordinates?.[1]);
  const longitude = Number(properties.lon ?? feature?.geometry?.coordinates?.[0]);
  const resultType = String(properties.result_type || '').toLowerCase();
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  let placeType;
  if (STATE_TYPES.has(resultType)) placeType = 'STATE';
  else if (CITY_TYPES.has(resultType)) placeType = 'CITY';
  else if (LOCALITY_TYPES.has(resultType)) placeType = 'LOCALITY';
  else return null;

  const parentCity = properties.city || properties.town || properties.village || properties.municipality || '';
  const city = properties.name
    || (placeType === 'STATE' ? properties.state : '')
    || properties.suburb
    || properties.district
    || properties.neighbourhood
    || properties.neighborhood
    || properties.quarter
    || properties.city
    || properties.town
    || properties.village
    || properties.municipality
    || properties.formatted?.split(',')[0]
    || 'Place';
  const country = properties.country || 'Unknown';
  const area = properties.state || properties.region || '';
  const district = properties.county || properties.district || properties.city_district || '';
  const contextLabel = placeType === 'LOCALITY'
    ? uniqueContext([parentCity || district, area, country], city)
    : placeType === 'CITY'
      ? uniqueContext([district, area, country], city)
      : uniqueContext([country], city);
  const distinctParentCity = parentCity && parentCity.toLocaleLowerCase('en') !== city.toLocaleLowerCase('en') ? parentCity : '';
  const boundingBox = normalizedBoundingBox(feature);

  return {
    city,
    country,
    parentCity: distinctParentCity,
    parentLabel: placeType === 'LOCALITY' && distinctParentCity ? `${distinctParentCity}, ${country}` : country,
    contextLabel,
    placeType,
    placeId: properties.place_id || `geoapify:${latitude},${longitude}`,
    label: properties.formatted || [city, contextLabel].filter(Boolean).join(', '),
    latNum: latitude,
    lonNum: longitude,
    lat: coordinate(latitude, 'N', 'S'),
    lon: coordinate(longitude, 'E', 'W'),
    ...(boundingBox ? { boundingBox } : {}),
  };
}

function cachePlaces(key, places) {
  if (memoryCache.size >= MAX_CACHE_ENTRIES) memoryCache.delete(memoryCache.keys().next().value);
  memoryCache.set(key, places);
}

async function geoapifyRequest(query, apiKey) {
  const url = new URL(GEOAPIFY_AUTOCOMPLETE_URL);
  url.search = new URLSearchParams({
    text: query,
    type: 'locality',
    format: 'geojson',
    lang: 'en',
    limit: '16',
    apiKey,
  }).toString();

  let response;
  try {
    response = await fetch(url, {
      headers: { accept: 'application/geo+json, application/json' },
      signal: AbortSignal.timeout(15000),
    });
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw new SearchProviderError('SEARCH_PROVIDER_TIMEOUT', 'Place search timed out. Try again.', 504);
    }
    throw new SearchProviderError('SEARCH_PROVIDER_UNAVAILABLE', 'Place search is temporarily unavailable.', 502);
  }

  if (response.status === 429) {
    throw new SearchProviderError('SEARCH_QUOTA_EXCEEDED', 'Place search is busy. Try again shortly.', 429);
  }
  if (response.status === 401 || response.status === 403) {
    throw new SearchProviderError('SEARCH_CONFIGURATION_ERROR', 'Place search configuration needs attention.', 503);
  }
  if (!response.ok) {
    throw new SearchProviderError('SEARCH_PROVIDER_UNAVAILABLE', 'Place search is temporarily unavailable.', 502);
  }

  try {
    const payload = await response.json();
    if (!Array.isArray(payload.features)) throw new Error('GeoJSON features are missing.');
    return payload.features;
  } catch {
    throw new SearchProviderError('SEARCH_PROVIDER_INVALID_RESPONSE', 'Place search returned an unexpected response.', 502);
  }
}

export default async function handler(request) {
  const query = new URL(request.url).searchParams.get('q')?.trim() || '';
  if (query.length < 3) return json({ places: [] }, 200, 'public, max-age=60');
  if (query.length > 120) return json({ code: 'SEARCH_QUERY_TOO_LONG', error: 'Search is too long.', places: [] }, 400);

  const apiKey = process.env.GEOAPIFY_API_KEY?.trim();
  if (!apiKey) {
    return json({ code: 'SEARCH_NOT_CONFIGURED', error: 'Place search is not configured.', places: [] }, 503);
  }

  const cacheKey = query.replace(/\s+/g, ' ').toLocaleLowerCase('en');
  if (memoryCache.has(cacheKey)) return json({ places: memoryCache.get(cacheKey) }, 200, 'public, max-age=300');

  try {
    const features = await geoapifyRequest(query, apiKey);
    const seen = new Set();
    const places = [];

    for (const feature of features) {
      const place = normalizeGeoapifyFeature(feature);
      if (!place) continue;
      const identity = `${place.city.toLocaleLowerCase('en')}|${place.contextLabel.toLocaleLowerCase('en')}|${place.placeType}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      places.push(place);
      if (places.length === 8) break;
    }

    cachePlaces(cacheKey, places);
    return json({ places }, 200, 'public, max-age=300, s-maxage=86400, stale-while-revalidate=604800');
  } catch (error) {
    const providerError = error instanceof SearchProviderError
      ? error
      : new SearchProviderError('SEARCH_PROVIDER_UNAVAILABLE', 'Place search is temporarily unavailable.', 502);
    console.error('Place search failed:', providerError.code);
    return json({ code: providerError.code, error: providerError.message, places: [] }, providerError.status);
  }
}
