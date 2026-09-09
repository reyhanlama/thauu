export const MAPTHIS_PROJECT_VERSION = 2;

function copyPoint(lat, lon) {
  return {
    lat: Number.isFinite(Number(lat)) ? Number(lat) : null,
    lon: Number.isFinite(Number(lon)) ? Number(lon) : null,
  };
}

export function projectPlace(place) {
  const point = copyPoint(place?.latNum, place?.lonNum);
  return {
    ...place,
    searchCenter: { ...point },
    focusPoint: { ...point },
    viewportCenter: { ...point },
    memoryAnchor: null,
    markerMode: 'visible',
  };
}

export function createProject({ place, preferences = {} }) {
  const now = new Date().toISOString();
  return {
    version: MAPTHIS_PROJECT_VERSION,
    id: globalThis.crypto?.randomUUID?.() || `mapthis-${Date.now()}`,
    createdAt: now,
    updatedAt: now,
    composition: 'single',
    format: preferences.output || null,
    places: [projectPlace(place)],
    memory: {
      line: typeof preferences.inscription === 'string' ? preferences.inscription.slice(0, 34) : 'The shape of somewhere',
      date: '',
    },
    design: {
      style: preferences.mode || 'signal',
      detail: Number(preferences.density) || 3,
      extent: Number(preferences.scope) || 2,
      layoutVariant: 0,
      palette: null,
      layers: {
        roads: true,
        water: true,
        rail: true,
        boundaries: true,
      },
      typography: 'editorial',
    },
  };
}

export function touchProject(project) {
  project.updatedAt = new Date().toISOString();
  return project;
}

export function setProjectPlace(project, place) {
  project.places = [projectPlace(place)];
  project.design.layoutVariant = 0;
  project.format = null;
  return touchProject(project);
}

export function setMemoryAnchor(project, point) {
  const place = project.places[0];
  const anchor = copyPoint(point?.lat, point?.lon);
  if (!place || anchor.lat === null || anchor.lon === null) return project;
  place.focusPoint = { ...anchor };
  place.viewportCenter = { ...anchor };
  place.memoryAnchor = { ...anchor };
  place.latNum = anchor.lat;
  place.lonNum = anchor.lon;
  return touchProject(project);
}

export function serializeProject(project) {
  return JSON.stringify(project);
}
