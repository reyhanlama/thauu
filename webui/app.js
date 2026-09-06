const liveAppUrl = 'http://127.0.0.1:8765/';
if (window.location.protocol === 'file:') window.location.replace(liveAppUrl);

const app = document.querySelector('#app');
const searchForm = document.querySelector('#search-form');
const placeInput = document.querySelector('#place-input');
const suggestions = document.querySelector('#suggestions');
const flight = document.querySelector('.flight');
const flightWord = document.querySelector('#flight-word');
const flightCity = document.querySelector('#flight-city');
const flightCoord = document.querySelector('#flight-coord');
const signalCopy = document.querySelector('#signal-copy');
const density = document.querySelector('#density');
const densityValue = document.querySelector('#density-value');
const densityDescription = document.querySelector('#density-description');
const scope = document.querySelector('#scope');
const scopeValue = document.querySelector('#scope-value');
const scopeDescription = document.querySelector('#scope-description');
const inscription = document.querySelector('#inscription');
const searchStatus = document.querySelector('#search-status');
const composer = document.querySelector('.composer');
const exportDialog = document.querySelector('#export-dialog');
const infoDialog = document.querySelector('#info-dialog');
const svgNS = 'http://www.w3.org/2000/svg';
const preferenceKey = 'orrery-preferences-v1';

function readPreferences() {
  try { return JSON.parse(window.localStorage.getItem(preferenceKey) || '{}'); }
  catch { return {}; }
}

const savedPreferences = readPreferences();

const places = {
  reykjavik: { city: 'Reykjavík', country: 'Iceland', placeType: 'CITY', label: 'Reykjavík, Capital Region, Iceland', lat: '64.1466° N', lon: '21.9426° W', latNum: 64.1466, lonNum: -21.9426 },
  mumbai: { city: 'Mumbai', country: 'India', placeType: 'CITY', label: 'Mumbai, Maharashtra, India', lat: '19.0760° N', lon: '72.8777° E', latNum: 19.076, lonNum: 72.8777 },
  seoul: { city: 'Seoul', country: 'South Korea', placeType: 'CITY', label: 'Seoul, South Korea', lat: '37.5665° N', lon: '126.9780° E', latNum: 37.5665, lonNum: 126.978 },
  'sao-paulo': { city: 'São Paulo', country: 'Brazil', lat: '23.5505° S', lon: '46.6333° W', latNum: -23.5505, lonNum: -46.6333 },
  nairobi: { city: 'Nairobi', country: 'Kenya', lat: '1.2921° S', lon: '36.8219° E', latNum: -1.2921, lonNum: 36.8219 },
  kyoto: { city: 'Kyoto', country: 'Japan', lat: '35.0116° N', lon: '135.7681° E', latNum: 35.0116, lonNum: 135.7681 },
  lisbon: { city: 'Lisbon', country: 'Portugal', lat: '38.7223° N', lon: '9.1393° W', latNum: 38.7223, lonNum: -9.1393 }
};

let currentPlace = places.reykjavik;
let currentMode = 'signal';
let variant = 0;
let suggestionTimer;
let searchRequest = 0;
let selectedSuggestion = null;
let realMapData = null;
let activeSuggestionIndex = -1;
let geographyRequest = 0;
let markerPoint = [360, 360];
let userAdjustedScope = Boolean(savedPreferences.scope);
let userAdjustedDensity = Boolean(savedPreferences.density);

const modeNames = {
  signal: 'EDITORIAL', terrain: 'TOPOGRAPHIC', trace: 'BLUEPRINT', void: 'NOIR', civic: 'SIGNAL', night: 'NIGHT', survey: 'QUIET'
};

function rememberPreferences() {
  try {
    window.localStorage.setItem(preferenceKey, JSON.stringify({
      mode: currentMode,
      density: density.value,
      scope: scope.value,
      inscription: inscription.value,
      output: selectedOutput || savedPreferences.output || null,
    }));
  } catch { /* The app remains fully usable when storage is unavailable. */ }
}

function restorePreferences() {
  if (modeNames[savedPreferences.mode]) currentMode = savedPreferences.mode;
  if (/^[1-5]$/.test(savedPreferences.density || '')) density.value = savedPreferences.density;
  if (/^[1-3]$/.test(savedPreferences.scope || '')) scope.value = savedPreferences.scope;
  if (typeof savedPreferences.inscription === 'string') inscription.value = savedPreferences.inscription.slice(0, 34);
  document.querySelector('#map-inscription').textContent = inscription.value.toUpperCase() || 'UNTITLED COORDINATE';
}

const framePresets = [
  { scale: 1, dx: 0, dy: 0, title: [54, 805], anchor: 'start', metaX: 58, metaAnchor: 'start', countryY: 844, coordinatesY: 890, attribution: [56, 72] },
  { scale: 1.18, dx: -76, dy: -42, title: [54, 168], anchor: 'start', metaX: 58, metaAnchor: 'start', countryY: 210, coordinatesY: 242, attribution: [372, 72] },
  { scale: 1.3, dx: -28, dy: -170, title: [360, 805], anchor: 'middle', metaX: 360, metaAnchor: 'middle', countryY: 844, coordinatesY: 890, attribution: [56, 72] }
];

const scopeLevels = {
  1: { label: 'CLOSE', cityRadius: 1800, stateRadius: 2600 },
  2: { label: 'CITY', cityRadius: 3500, stateRadius: 4800 },
  3: { label: 'REGION', cityRadius: 6500, stateRadius: 7000 }
};

function node(name, attrs = {}) {
  const element = document.createElementNS(svgNS, name);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
  return element;
}

function hash(value) {
  let result = 2166136261;
  for (const char of value) result = Math.imul(result ^ char.charCodeAt(0), 16777619);
  return result >>> 0;
}

function randomFrom(seedText) {
  let seed = hash(seedText) || 1;
  return () => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
}

function makeWorld() {
  const grid = document.querySelector('.globe-grid');
  const land = document.querySelector('.globe-land');
  const orbits = document.querySelector('.globe-orbits');
  for (let y = 130; y <= 770; y += 80) grid.append(node('path', { d: `M32 ${y} Q450 ${y - 80 + Math.abs(450-y)/5} 868 ${y}` }));
  for (let x = 150; x <= 750; x += 100) grid.append(node('path', { d: `M${x} 48 C${x-170} 250 ${x-170} 650 ${x} 852` }));
  const forms = [
    'M115 240 C180 115 305 118 346 204 C382 280 296 317 253 365 C204 418 103 346 115 240Z',
    'M430 125 C523 82 665 143 689 231 C711 310 630 334 608 407 C580 498 451 443 470 352 C487 274 377 207 430 125Z',
    'M282 526 C350 460 444 490 459 565 C472 632 398 650 379 724 C361 792 255 770 241 688 C230 623 227 579 282 526Z',
    'M617 550 C670 510 776 552 789 625 C803 700 726 761 653 727 C589 698 557 596 617 550Z'
  ];
  forms.forEach(d => land.append(node('path', { d })));
  orbits.append(node('path', { d: 'M38 680 C220 340 610 200 875 309' }));
  orbits.append(node('circle', { cx: 736, cy: 252, r: 9 }));
}

function organicPath(rand, cx, cy, radius, points = 9) {
  const coords = [];
  for (let i = 0; i < points; i++) {
    const angle = Math.PI * 2 * i / points;
    const r = radius * (.55 + rand() * .7);
    coords.push([cx + Math.cos(angle) * r, cy + Math.sin(angle) * r]);
  }
  return `M${coords.map((point, i) => `${i ? 'L' : ''}${point[0].toFixed(1)} ${point[1].toFixed(1)}`).join(' ')}Z`;
}

function routePath(rand, width = 720, height = 700) {
  const horizontal = rand() > .5;
  const start = horizontal ? [-30, 80 + rand() * height] : [80 + rand() * width, -30];
  const end = horizontal ? [750, 80 + rand() * height] : [80 + rand() * width, 750];
  const c1 = [rand() * width, rand() * height];
  const c2 = [rand() * width, rand() * height];
  return `M${start[0]} ${start[1]} C${c1[0].toFixed(0)} ${c1[1].toFixed(0)} ${c2[0].toFixed(0)} ${c2[1].toFixed(0)} ${end[0]} ${end[1]}`;
}

function projectedPath(coordinates, bounds, close = false) {
  const [west, south, east, north] = bounds;
  const width = Math.max(.000001, east - west);
  const height = Math.max(.000001, north - south);
  const points = coordinates.map(([lon, lat]) => [
    ((lon - west) / width) * 760 - 20,
    ((north - lat) / height) * 760 - 20
  ]);
  if (points.length < 2) return '';
  return `M${points.map(([x, y], index) => `${index ? 'L' : ''}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')}${close ? 'Z' : ''}`;
}

function projectPoint([lon, lat], bounds) {
  const [west, south, east, north] = bounds;
  return [
    ((lon - west) / Math.max(.000001, east - west)) * 760 - 20,
    ((north - lat) / Math.max(.000001, north - south)) * 760 - 20
  ];
}

function combineTransforms(outer, inner) {
  return {
    scale: outer.scale * inner.scale,
    dx: outer.scale * inner.dx + outer.dx,
    dy: outer.scale * inner.dy + outer.dy
  };
}

function setMapTransform(svg, transform, point = markerPoint) {
  const matrix = `matrix(${transform.scale} 0 0 ${transform.scale} ${transform.dx} ${transform.dy})`;
  ['#map-regions', '#map-water', '#map-roads', '#map-detail'].forEach(selector => {
    svg.querySelector(selector)?.setAttribute('transform', matrix);
  });
  const [x, y] = point;
  const targetX = x * transform.scale + transform.dx;
  const targetY = y * transform.scale + transform.dy;
  const target = svg.querySelector('.map-target');
  if (target) {
    target.dataset.x = String(x);
    target.dataset.y = String(y);
    target.setAttribute('transform', `translate(${targetX.toFixed(2)} ${targetY.toFixed(2)})`);
  }
}

function applyFrame(svg = document.querySelector('#poster-map')) {
  const frame = framePresets[variant % framePresets.length];
  setMapTransform(svg, frame);
  const city = svg.querySelector('.map-city');
  const country = svg.querySelector('.map-country');
  const coordinates = svg.querySelector('.map-coordinates');
  const attribution = svg.querySelector('.map-id');
  if (city) {
    city.setAttribute('x', frame.title[0]);
    city.setAttribute('y', frame.title[1]);
    city.setAttribute('text-anchor', frame.anchor);
  }
  country?.setAttribute('x', frame.metaX); country?.setAttribute('y', frame.countryY); country?.setAttribute('text-anchor', frame.metaAnchor);
  coordinates?.setAttribute('x', frame.metaX); coordinates?.setAttribute('y', frame.coordinatesY); coordinates?.setAttribute('text-anchor', frame.metaAnchor);
  attribution?.setAttribute('x', frame.attribution[0]); attribution?.setAttribute('y', frame.attribution[1]);
  document.querySelector('#frame-count').textContent = `${variant % framePresets.length + 1} / ${framePresets.length}`;
}

function isClosedRing(coordinates) {
  if (coordinates.length < 4) return false;
  const first = coordinates[0];
  const last = coordinates[coordinates.length - 1];
  return Math.abs(first[0] - last[0]) < .000001 && Math.abs(first[1] - last[1]) < .000001;
}

function renderRealMap(mapData) {
  const regions = document.querySelector('#map-regions');
  const water = document.querySelector('#map-water');
  const roads = document.querySelector('#map-roads');
  const detail = document.querySelector('#map-detail');
  regions.replaceChildren(); water.replaceChildren(); roads.replaceChildren(); detail.replaceChildren();
  const detailLevel = Number(density.value);
  const majorRoads = new Set(['motorway', 'trunk', 'primary', 'secondary']);
  const mediumRoads = new Set(['tertiary', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link']);
  markerPoint = projectPoint(mapData.center, mapData.bounds);

  for (const feature of mapData.features || []) {
    const isPolygon = feature.kind === 'water' && feature.class !== 'coastline' && isClosedRing(feature.coordinates);
    const d = projectedPath(feature.coordinates, mapData.bounds, isPolygon);
    if (!d) continue;
    if (feature.kind === 'water' || feature.kind === 'waterway') {
      water.append(node('path', { d, class: isPolygon ? 'water-area' : 'water-line' }));
      continue;
    }
    if (feature.kind === 'rail') {
      if (detailLevel >= 2) detail.append(node('path', { d, class: 'rail-line' }));
      continue;
    }
    if (majorRoads.has(feature.class)) {
      roads.append(node('path', { d, class: `road-${feature.class}` }));
    } else if (mediumRoads.has(feature.class)) {
      if (detailLevel >= 2) roads.append(node('path', { d, class: 'road-medium' }));
    } else if (detailLevel >= 3) {
      detail.append(node('path', { d, class: 'road-local' }));
    }
  }
  applyFrame();
}

function generateMap() {
  if (realMapData?.features?.length) {
    renderRealMap(realMapData);
    return;
  }
  const rand = randomFrom(`${currentPlace.city}-${density.value}-${variant}`);
  const regions = document.querySelector('#map-regions');
  const water = document.querySelector('#map-water');
  const roads = document.querySelector('#map-roads');
  const detail = document.querySelector('#map-detail');
  regions.replaceChildren(); water.replaceChildren(); roads.replaceChildren(); detail.replaceChildren();

  for (let i = 0; i < 4; i++) {
    regions.append(node('path', { d: organicPath(rand, 80 + rand() * 590, 100 + rand() * 580, 110 + rand() * 150, 8 + Math.floor(rand() * 5)) }));
  }
  water.append(node('path', { d: `M-20 ${110 + rand()*230} C${140+rand()*100} ${30+rand()*180} ${280+rand()*120} ${520+rand()*120} ${740} ${220+rand()*310} L740 0 L-20 0Z` }));
  const count = Number(density.value);
  for (let i = 0; i < 3 + count * 2; i++) roads.append(node('path', { d: routePath(rand) }));
  for (let i = 0; i < 7 + count * 5; i++) detail.append(node('path', { d: routePath(rand) }));
  markerPoint = [360, 360];
  applyFrame();
}

function normalize(value) { return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''); }
function matches(query) {
  const needle = normalize(query);
  return Object.entries(places).filter(([key, place]) => `${key}-${normalize(place.country)}`.includes(needle)).slice(0, 5);
}

function renderSuggestions(found, emptyMessage = '') {
  activeSuggestionIndex = -1;
  if (!found.length) {
    suggestions.replaceChildren();
    if (!emptyMessage) { suggestions.hidden = true; placeInput.setAttribute('aria-expanded', 'false'); return; }
    const empty = document.createElement('div');
    empty.className = 'suggestion-empty';
    empty.textContent = emptyMessage;
    suggestions.append(empty);
    suggestions.hidden = false;
    placeInput.setAttribute('aria-expanded', 'true');
    searchStatus.textContent = emptyMessage.toLowerCase().replace(/\.$/, '') + '.';
    return;
  }
  suggestions.replaceChildren(...found.map((place, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.id = `place-option-${index}`;
    button.setAttribute('role', 'option');
    button.setAttribute('aria-selected', 'false');
    const primary = document.createElement('span'); primary.textContent = place.city;
    const hierarchy = (place.label || `${place.city}, ${place.country}`)
      .split(',').map(part => part.trim()).filter(Boolean)
      .filter((part, partIndex) => partIndex > 0 && part.toLowerCase() !== place.city.toLowerCase())
      .slice(0, 3).join(', ') || place.country;
    const secondary = document.createElement('small'); secondary.textContent = hierarchy;
    const type = document.createElement('b'); type.textContent = place.placeType || 'CITY';
    button.append(primary, secondary, type);
    button.addEventListener('click', () => {
      selectedSuggestion = place;
      placeInput.value = place.city;
      searchForm.classList.remove('needs-selection');
      searchStatus.textContent = `${place.city}, ${hierarchy} selected.`;
      locate(place);
    });
    return button;
  }));
  suggestions.hidden = false;
  placeInput.setAttribute('aria-expanded', 'true');
  searchStatus.textContent = `${found.length} verified place${found.length === 1 ? '' : 's'} available.`;
}

async function showSuggestions(query) {
  const requestId = ++searchRequest;
  if (query.trim().length < 2) { suggestions.hidden = true; suggestions.replaceChildren(); placeInput.setAttribute('aria-expanded', 'false'); return; }
  const local = matches(query).map(([, place]) => place);
  renderSuggestions(local);
  if (window.location.protocol === 'file:') return;
  try {
    const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    const data = await response.json();
    if (requestId !== searchRequest || !response.ok) return;
    const found = data.places || local;
    renderSuggestions(found, 'NO VERIFIED CITY OR STATE FOUND');
    if (!found.length) signalCopy.textContent = 'NO VERIFIED PLACE FOUND';
  } catch {
    if (!local.length) {
      renderSuggestions([], 'PLACE SEARCH IS TEMPORARILY UNAVAILABLE');
      signalCopy.textContent = 'SEARCH UNAVAILABLE / TRY AGAIN';
    }
  }
}

const pause = ms => new Promise(resolve => window.setTimeout(resolve, ms));

async function loadGeography(place) {
  if (window.location.protocol === 'file:' || !Number.isFinite(place.latNum) || !Number.isFinite(place.lonNum)) return null;
  const level = scopeLevels[scope.value] || scopeLevels[2];
  const radius = place.placeType === 'STATE' ? level.stateRadius : level.cityRadius;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 48000);
  try {
    const response = await fetch(`/api/map-data?lat=${place.latNum}&lon=${place.lonNum}&radius=${radius}`, { signal: controller.signal });
    if (!response.ok) return null;
    return await response.json();
  } catch { return null; }
  finally { window.clearTimeout(timeout); }
}

async function locate(keyOrPlace) {
  suggestions.hidden = true;
  placeInput.setAttribute('aria-expanded', 'false');
  const rawText = typeof keyOrPlace === 'string' ? keyOrPlace : keyOrPlace.city;
  const key = typeof keyOrPlace === 'string' && places[keyOrPlace] ? keyOrPlace : normalize(rawText);
  currentPlace = typeof keyOrPlace === 'object' ? keyOrPlace : places[key];
  if (!currentPlace) {
    signalCopy.textContent = 'CHOOSE A CITY OR STATE BELOW';
    searchForm.classList.add('needs-selection');
    await showSuggestions(rawText);
    placeInput.focus();
    return;
  }
  placeInput.blur();
  variant = 0;
  if (!userAdjustedScope) scope.value = currentPlace.placeType === 'STATE' ? '3' : '2';
  updateScopeControl();
  flightCity.textContent = (currentPlace?.city || rawText || 'Somewhere').toUpperCase();
  flightCoord.textContent = currentPlace ? `${currentPlace.lat} / ${currentPlace.lon}` : 'RESOLVING COORDINATE';
  flight.classList.add('is-active');
  flight.setAttribute('aria-hidden', 'false');
  realMapData = null;
  const geographyPromise = loadGeography(currentPlace);
  const slowTimer = window.setTimeout(() => {
    flightWord.textContent = 'STILL DRAWING';
    signalCopy.textContent = 'STREET DATA IS TAKING LONGER';
  }, 4500);
  const stageElements = [...document.querySelectorAll('.flight-steps span')];
  const stages = [
    ['FINDING', 'FINDING THE SELECTED PLACE'],
    ['STREETS', 'DRAWING AVAILABLE STREETS'],
    ['COMPOSING', 'COMPOSING YOUR ARTWORK'],
  ];
  for (const [index, [word, status]] of stages.entries()) {
    flightWord.textContent = word;
    signalCopy.textContent = status;
    stageElements.forEach((element, itemIndex) => {
      element.classList.toggle('is-active', itemIndex === index);
      element.classList.toggle('is-done', itemIndex < index);
    });
    await pause(440);
  }
  realMapData = await geographyPromise;
  window.clearTimeout(slowTimer);
  if (!realMapData?.features?.length) {
    flight.classList.remove('is-active');
    flight.setAttribute('aria-hidden', 'true');
    app.classList.remove('is-composing');
    app.classList.add('is-finding');
    signalCopy.textContent = 'MAP DATA UNAVAILABLE / TRY AGAIN';
    searchStatus.textContent = 'Map data could not be loaded. Choose the place again to retry.';
    placeInput.focus();
    return;
  }
  applyMapQualityGuidance(realMapData);
  updatePlace();
  await pause(220);
  app.classList.remove('is-finding'); app.classList.add('is-composing');
  flight.classList.remove('is-active'); flight.setAttribute('aria-hidden', 'true');
}

function updatePlace() {
  document.querySelector('#place-city').textContent = currentPlace.city;
  document.querySelector('#place-country').textContent = currentPlace.country.toUpperCase();
  updateScopeControl();
  document.querySelector('#map-city').textContent = currentPlace.city.toUpperCase();
  document.querySelector('#map-country').textContent = currentPlace.country.toUpperCase();
  document.querySelector('#map-coordinates').textContent = `${currentPlace.lat}   ${currentPlace.lon}`;
  document.querySelector('#x-coord').textContent = currentPlace.lon;
  document.querySelector('#y-coord').textContent = currentPlace.lat;
  signalCopy.textContent = `LOCKED / ${currentPlace.lat}`;
  updateDetailControl();
  generateMap();
  fitLiveCityName();
  updateArtworkDescription();
}

function applyMapQualityGuidance(mapData) {
  const featureCount = mapData?.features?.length || 0;
  const notice = document.querySelector('#map-notice');
  notice.hidden = true;
  notice.textContent = '';
  if (!userAdjustedDensity) {
    density.value = featureCount < 450 ? '5' : featureCount < 1400 ? '4' : '3';
  }
  if (featureCount < 450) {
    notice.textContent = featureCount < 120
      ? 'LIMITED MAP COVERAGE · TRY A NEARBY CITY OR WIDEN THE FRAME'
      : 'LIGHT MAP COVERAGE · MAXIMUM AVAILABLE DETAIL IS SHOWN';
    notice.hidden = false;
  }
}

function setMode(mode, persist = true) {
  currentMode = mode;
  app.dataset.mode = mode;
  document.querySelectorAll('.mode').forEach(button => {
    const active = button.dataset.mode === mode;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  if (window.matchMedia('(max-width: 900px)').matches) closeMobilePanel();
  updateArtworkDescription();
  if (persist) rememberPreferences();
}

function closeMobilePanel() {
  composer.dataset.mobilePanel = '';
  document.querySelectorAll('[data-mobile-panel]').forEach(item => item.setAttribute('aria-expanded', 'false'));
}

function fitLiveCityName() {
  const city = document.querySelector('#map-city');
  city.style.fontSize = '104px';
  requestAnimationFrame(() => {
    const width = city.getComputedTextLength();
    if (width > 610) city.style.fontSize = `${Math.max(54, 104 * 610 / width)}px`;
  });
}

function updateArtworkDescription() {
  const detail = detailLevels?.[density.value]?.[0] || 'Balanced';
  const label = `${currentPlace.city} map poster, ${currentMode} style, ${detail.toLowerCase()} detail, ${scopeValue.textContent.toLowerCase()} extent.`;
  document.querySelector('#artifact').setAttribute('aria-label', label);
  document.querySelector('#artifact-status').textContent = `${currentPlace.city.toUpperCase()} · ${modeNames[currentMode]} · ${detail}`;
}

function goHome() {
  app.classList.remove('is-composing'); app.classList.add('is-finding');
  signalCopy.textContent = 'SEEKING A COORDINATE';
  window.setTimeout(() => placeInput.focus(), 450);
}

let selectedOutput = null;
let exportFontCssPromise;

const outputLayouts = {
  phone: { width: 720, height: 1560 },
  screen: { width: 1280, height: 720 },
  print: { width: 720, height: 960 }
};

function modeBaseColor() {
  if (['void', 'night'].includes(currentMode)) return '#171716';
  if (currentMode === 'trace') return '#2245e6';
  if (currentMode === 'civic') return '#f2f0e9';
  return '#f7f0d7';
}

function cityFontSize(maximum, availableWidth) {
  const estimatedWidth = Math.max(1, currentPlace.city.length) * .53;
  return Math.max(54, Math.min(maximum, availableWidth / estimatedWidth));
}

function fitInscription(svg, format = 'print') {
  const text = svg.querySelector('.map-inscription');
  if (!text) return;
  const available = format === 'phone' ? 270 : 240;
  const length = Math.max(1, text.textContent.length);
  const estimatedAtNine = length * 7.2;
  text.style.fontSize = `${Math.max(5.5, Math.min(9, 9 * available / estimatedAtNine))}px`;
}

function adaptSvgForOutput(svg, format) {
  const layout = outputLayouts[format];
  if (!layout) return svg;

  svg.setAttribute('viewBox', `0 0 ${layout.width} ${layout.height}`);
  const base = svg.querySelector('.map-base');
  base.setAttribute('width', layout.width);
  base.setAttribute('height', layout.height);

  const outputTransform = format === 'phone'
    ? { scale: 1.62, dx: -223, dy: 0 }
    : format === 'screen'
      ? { scale: 1.7, dx: 0, dy: -250 }
      : { scale: 1, dx: 0, dy: 0 };
  const framedTransform = combineTransforms(outputTransform, framePresets[variant % framePresets.length]);
  setMapTransform(svg, framedTransform);

  const city = svg.querySelector('.map-city');
  const country = svg.querySelector('.map-country');
  const coordinates = svg.querySelector('.map-coordinates');
  const mapId = svg.querySelector('.map-id');
  const attribution = svg.querySelector('.map-attribution');
  const scale = svg.querySelector('.map-scale');
  const inscriptionPanel = svg.querySelector('.map-inscription-panel');
  const inscriptionText = svg.querySelector('.map-inscription');
  let caption;

  if (format === 'phone') {
    caption = node('rect', { class: 'map-caption-field', fill: modeBaseColor(), x: 0, y: 1210, width: 720, height: 350 });
    city.setAttribute('x', '42'); city.setAttribute('y', '1370');
    city.setAttribute('text-anchor', 'start');
    city.style.fontSize = `${cityFontSize(116, 636)}px`;
    country.setAttribute('x', '46'); country.setAttribute('y', '1420');
    coordinates.setAttribute('x', '46'); coordinates.setAttribute('y', '1470');
    mapId.setAttribute('x', '42'); mapId.setAttribute('y', '62');
    attribution.setAttribute('x', '674'); attribution.setAttribute('y', '1538');
    scale.setAttribute('d', 'M514 1466h156m-156-7v14m78-14v14m78-14v14');
    inscriptionPanel.setAttribute('x', '660'); inscriptionPanel.setAttribute('height', '300');
    inscriptionText.setAttribute('x', '690'); inscriptionText.setAttribute('y', '18'); inscriptionText.setAttribute('transform', 'rotate(90 690 18)');
  } else if (format === 'screen') {
    caption = node('rect', { class: 'map-caption-field', fill: modeBaseColor(), x: 0, y: 486, width: 1280, height: 234 });
    city.setAttribute('x', '54'); city.setAttribute('y', '610');
    city.setAttribute('text-anchor', 'start');
    city.style.fontSize = `${cityFontSize(120, 730)}px`;
    country.setAttribute('x', '60'); country.setAttribute('y', '660');
    coordinates.setAttribute('x', '310'); coordinates.setAttribute('y', '660');
    mapId.setAttribute('x', '54'); mapId.setAttribute('y', '52');
    attribution.setAttribute('x', '1250'); attribution.setAttribute('y', '698');
    scale.setAttribute('d', 'M1050 654h170m-170-7v14m85-14v14m85-14v14');
    inscriptionPanel.setAttribute('x', '1220'); inscriptionPanel.setAttribute('height', '270');
    inscriptionText.setAttribute('x', '1250'); inscriptionText.setAttribute('y', '18'); inscriptionText.setAttribute('transform', 'rotate(90 1250 18)');
  }

  if (caption) svg.insertBefore(caption, svg.querySelector('.map-target'));
  fitInscription(svg, format);
  return svg;
}

function fileAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function loadExportFontCss() {
  if (!exportFontCssPromise) {
    exportFontCssPromise = Promise.all([
      fetch('./fonts/instrument-serif-regular.ttf').then(response => {
        if (!response.ok) throw new Error('Could not load the export font.');
        return response.blob();
      }).then(fileAsDataUrl),
      fetch('./fonts/instrument-serif-italic.ttf').then(response => {
        if (!response.ok) throw new Error('Could not load the export font.');
        return response.blob();
      }).then(fileAsDataUrl),
      fetch('./fonts/dm-mono-regular.ttf').then(response => {
        if (!response.ok) throw new Error('Could not load the export font.');
        return response.blob();
      }).then(fileAsDataUrl),
      fetch('./fonts/dm-mono-medium.ttf').then(response => {
        if (!response.ok) throw new Error('Could not load the export font.');
        return response.blob();
      }).then(fileAsDataUrl)
    ]).then(([regular, italic, monoRegular, monoMedium]) => `@font-face{font-family:'Instrument Serif Export';font-style:normal;font-weight:400;src:url('${regular}') format('truetype')}@font-face{font-family:'Instrument Serif Export';font-style:italic;font-weight:400;src:url('${italic}') format('truetype')}@font-face{font-family:'DM Mono Export';font-style:normal;font-weight:400;src:url('${monoRegular}') format('truetype')}@font-face{font-family:'DM Mono Export';font-style:normal;font-weight:500;src:url('${monoMedium}') format('truetype')}`);
  }
  return exportFontCssPromise;
}

function styledSvgClone(format, embeddedFontCss) {
  const original = document.querySelector('#poster-map');
  const clone = adaptSvgForOutput(original.cloneNode(true), format);
  const palettes = {
    signal: { base: '#f7f0d7', region: '#e2f238', water: '#2245e6', road: '#171716', detail: '#171716', text: '#171716', target: '#f0442c' },
    terrain: { base: '#f7f0d7', region: '#f0442c', water: '#e2f238', road: '#171716', detail: '#171716', text: '#171716', target: '#2245e6' },
    trace: { base: '#2245e6', region: 'none', water: 'none', road: '#f2f0e9', detail: '#f2f0e9', text: '#f2f0e9', target: '#f0442c' },
    void: { base: '#171716', region: 'none', water: '#2245e6', road: '#f2f0e9', detail: '#f2f0e9', text: '#f2f0e9', target: '#f0442c' },
    civic: { base: '#f2f0e9', region: 'none', water: '#2245e6', road: '#f0442c', detail: '#171716', text: '#171716', target: '#2245e6' },
    night: { base: '#171716', region: 'none', water: '#2245e6', road: '#e2f238', detail: '#f2f0e9', text: '#f2f0e9', target: '#f0442c' },
    survey: { base: '#f7f0d7', region: 'none', water: 'none', road: '#171716', detail: '#171716', text: '#171716', target: '#2245e6' }
  };
  const palette = palettes[currentMode] || palettes.signal;
  const detailOpacity = Number(density.value) >= 5 ? .9 : Number(density.value) >= 4 ? .72 : .6;
  const detailWidth = Number(density.value) >= 5 ? 1.35 : Number(density.value) >= 4 ? 1.15 : 1;
  const style = node('style');
  style.textContent = `${embeddedFontCss}.map-base{fill:${palette.base}}#map-regions path{fill:${palette.region};stroke:${palette.detail};stroke-width:2}#map-water path{fill:${palette.water};stroke:${palette.detail};stroke-width:2}#map-water .water-line{fill:none;stroke:${palette.water === 'none' ? palette.detail : palette.water};stroke-width:5}#map-roads path{fill:none;stroke:${palette.road};stroke-width:4}#map-roads .road-motorway,#map-roads .road-trunk{stroke-width:8}#map-roads .road-primary{stroke-width:6}#map-roads .road-medium{stroke-width:2.5}#map-detail path{fill:none;stroke:${palette.detail};stroke-width:${detailWidth};opacity:${detailOpacity}}.map-target circle,.map-target path{fill:none;stroke:${palette.target};stroke-width:2}.map-target circle:nth-child(2){fill:${palette.target}}.map-city{fill:${palette.text};font-family:'Instrument Serif Export',serif;font-size:104px;font-style:normal;font-weight:400;letter-spacing:-3px}.map-country,.map-coordinates,.map-id,.map-inscription,.map-attribution{fill:${palette.text};font-family:'DM Mono Export',monospace;font-size:12px;font-style:normal;font-weight:400;letter-spacing:3px}.map-id{fill:${palette.target};font-weight:500}.map-coordinates{font-size:9px}.map-attribution{font-size:7.5px;letter-spacing:.45px;opacity:.64}.map-scale{fill:none;stroke:${palette.text};stroke-width:2}.map-inscription-panel{fill:${palette.target}}.map-inscription{fill:#f2f0e9;font-size:9px;letter-spacing:2px}`;
  clone.prepend(style);
  clone.setAttribute('xmlns', svgNS);
  return clone;
}

function selectOutput(format) {
  selectedOutput = format;
  const proof = document.querySelector('#proof-artifact');
  proof.dataset.format = format;
  const preview = adaptSvgForOutput(document.querySelector('#poster-map').cloneNode(true), format);
  preview.removeAttribute('id');
  proof.replaceChildren(preview);
  document.querySelectorAll('[data-preview]').forEach(button => button.classList.toggle('is-selected', button.dataset.preview === format));
  document.querySelector('#raster-exports').hidden = false;
  const copy = {
    phone: ['PHONE / PREVIEW', 'Your phone image.', 'This is the complete image that will be saved to your phone.'],
    screen: ['DESKTOP / PREVIEW', 'Across the screen.', 'This is the complete widescreen image that will be exported.'],
    print: ['PRINT / PREVIEW', 'Ready for paper.', 'This is the complete portrait image prepared for printing.']
  }[format];
  document.querySelector('#proof-kicker').textContent = copy[0];
  document.querySelector('#proof-title').textContent = copy[1];
  document.querySelector('#proof-description').textContent = copy[2];
  updateExportSizeLabels(format);
  rememberPreferences();
}

function rasterDimensions(format, edge) {
  const formats = { phone: [1846, 4000], screen: [4000, 2250], print: [3000, 4000] };
  const [baseWidth, baseHeight] = formats[format];
  const scale = edge / Math.max(baseWidth, baseHeight);
  return [Math.round(baseWidth * scale), Math.round(baseHeight * scale)];
}

function updateExportSizeLabels(format) {
  const presets = { 'png-max': ['BEST', 4000], 'jpeg-high': ['HIGH', 3200], 'jpeg-small': ['SMALL', 2000] };
  for (const [preset, [label, edge]] of Object.entries(presets)) {
    const [width, height] = rasterDimensions(format, edge);
    document.querySelector(`[data-export-size="${preset}"]`).textContent = `${label} · ${width} × ${height}`;
  }
}

async function exportRaster(preset, button) {
  if (!selectedOutput) return;
  const qualities = {
    'png-max': { type: 'image/png', edge: 4000, quality: 1, suffix: 'max' },
    'jpeg-high': { type: 'image/jpeg', edge: 3200, quality: .92, suffix: 'high' },
    'jpeg-small': { type: 'image/jpeg', edge: 2000, quality: .82, suffix: 'small' }
  };
  const quality = qualities[preset];
  const [width, height] = rasterDimensions(selectedOutput, quality.edge);
  const previous = button.innerHTML;
  button.disabled = true; button.textContent = 'RENDERING…';
  let svgUrl;
  try {
    await document.fonts.ready;
    const embeddedFontCss = await loadExportFontCss();
    const clone = styledSvgClone(selectedOutput, embeddedFontCss);
    const layout = outputLayouts[selectedOutput];
    clone.setAttribute('width', layout.width); clone.setAttribute('height', layout.height);
    const svgBlob = new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' });
    svgUrl = URL.createObjectURL(svgBlob);
    const image = new Image();
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = svgUrl; });
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0, width, height);
    const outputBlob = await new Promise(resolve => canvas.toBlob(resolve, quality.type, quality.quality));
    if (!outputBlob) throw new Error('Image export failed.');
    const url = URL.createObjectURL(outputBlob);
    const extension = quality.type === 'image/png' ? 'png' : 'jpg';
    const link = document.createElement('a'); link.href = url; link.download = `orrery-${normalize(currentPlace.city)}-${selectedOutput}-${quality.suffix}.${extension}`;
    document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    button.textContent = 'SAVED';
    await pause(500);
  } catch {
    button.textContent = 'TRY AGAIN';
    await pause(700);
  } finally {
    if (svgUrl) URL.revokeObjectURL(svgUrl);
    button.disabled = false; button.innerHTML = previous;
  }
}

function revealArtifact() {
  const proof = document.querySelector('#proof-artifact');
  const finished = document.querySelector('#poster-map').cloneNode(true);
  finished.removeAttribute('id');
  proof.replaceChildren(finished);
  delete proof.dataset.format;
  selectedOutput = null;
  document.querySelector('#raster-exports').hidden = true;
  document.querySelectorAll('[data-preview]').forEach(button => button.classList.remove('is-selected'));
  document.querySelector('#proof-kicker').textContent = 'ARTIFACT / READY';
  document.querySelector('#proof-title').textContent = 'There it is.';
  document.querySelector('#proof-description').textContent = 'Your place has already been made. Choose where you want to see it.';
  exportDialog.classList.remove('is-ready');
  exportDialog.showModal();
  window.setTimeout(() => exportDialog.classList.add('is-ready'), 900);
}

function highlightSuggestion(nextIndex) {
  const options = [...suggestions.querySelectorAll('[role="option"]')];
  if (!options.length) return;
  activeSuggestionIndex = (nextIndex + options.length) % options.length;
  options.forEach((option, index) => option.setAttribute('aria-selected', String(index === activeSuggestionIndex)));
  placeInput.setAttribute('aria-activedescendant', options[activeSuggestionIndex].id);
  options[activeSuggestionIndex].scrollIntoView({ block: 'nearest' });
}

searchForm.addEventListener('submit', async event => {
  event.preventDefault();
  const exactLocal = Object.values(places).find(place => normalize(place.city) === normalize(placeInput.value));
  const verified = selectedSuggestion && normalize(selectedSuggestion.city) === normalize(placeInput.value) ? selectedSuggestion : exactLocal;
  if (verified) {
    locate(verified);
    return;
  }
  signalCopy.textContent = 'CHOOSE A CITY OR STATE BELOW';
  searchForm.classList.add('needs-selection');
  await showSuggestions(placeInput.value);
  placeInput.focus();
});
placeInput.addEventListener('input', () => {
  selectedSuggestion = null;
  searchForm.classList.remove('needs-selection');
  signalCopy.textContent = 'SELECT A VERIFIED PLACE';
  searchStatus.textContent = placeInput.value.trim().length < 2 ? 'Type at least two letters.' : 'Searching verified places…';
  document.querySelector('.search-action').textContent = 'SEARCH';
  window.clearTimeout(suggestionTimer);
  suggestionTimer = window.setTimeout(() => showSuggestions(placeInput.value), 100);
});
placeInput.addEventListener('keydown', event => {
  const options = [...suggestions.querySelectorAll('[role="option"]')];
  if (event.key === 'ArrowDown' && options.length) { event.preventDefault(); highlightSuggestion(activeSuggestionIndex + 1); }
  if (event.key === 'ArrowUp' && options.length) { event.preventDefault(); highlightSuggestion(activeSuggestionIndex - 1); }
  if (event.key === 'Enter' && activeSuggestionIndex >= 0 && options[activeSuggestionIndex]) { event.preventDefault(); options[activeSuggestionIndex].click(); }
  if (event.key === 'Escape') {
    suggestions.hidden = true;
    placeInput.setAttribute('aria-expanded', 'false');
    placeInput.removeAttribute('aria-activedescendant');
  }
});
document.addEventListener('click', event => {
  if (!searchForm.contains(event.target)) {
    suggestions.hidden = true;
    placeInput.setAttribute('aria-expanded', 'false');
  }
});
document.querySelectorAll('[data-place]').forEach(button => button.addEventListener('click', () => locate(button.dataset.place)));
document.querySelectorAll('.mode').forEach(button => button.addEventListener('click', () => setMode(button.dataset.mode)));
document.querySelectorAll('[data-home], [data-change]').forEach(button => button.addEventListener('click', goHome));
const detailLevels = {
  1: ['ESSENTIAL', 'Only the roads that define the place.'],
  2: ['QUIET', 'Primary routes with a little local context.'],
  3: ['BALANCED', 'Major roads and neighborhood streets.'],
  4: ['RICH', 'A denser reading of the surrounding area.'],
  5: ['MAXIMUM', 'Every available street and rail trace.']
};

function updateScopeControl() {
  const level = scopeLevels[scope.value] || scopeLevels[2];
  const radius = currentPlace.placeType === 'STATE' ? level.stateRadius : level.cityRadius;
  const stateLabels = { 1: 'NEAR', 2: 'CENTER', 3: 'WIDE' };
  scopeValue.textContent = currentPlace.placeType === 'STATE' ? stateLabels[scope.value] : level.label;
  scopeDescription.textContent = `${(radius / 1000).toFixed(radius % 1000 ? 1 : 0)} km around the selected coordinate.`;
  document.querySelector('#place-scope').textContent = `${currentPlace.placeType === 'STATE' ? 'STATE' : 'CITY'} CENTER · ${(radius / 1000).toFixed(radius % 1000 ? 1 : 0)} KM FIELD`;
  scope.style.setProperty('--detail-progress', `${(Number(scope.value) - 1) * 50}%`);
  updateArtworkDescription();
}

function updateDetailControl() {
  let [label, description] = detailLevels[density.value];
  if (currentPlace.placeType === 'STATE') {
    const level = scopeLevels[scope.value] || scopeLevels[2];
    description = Number(density.value) === 5
      ? `Every available road within ${(level.stateRadius / 1000).toFixed(1)} km of the state center.`
      : `Mapped roads within ${(level.stateRadius / 1000).toFixed(1)} km of the state center.`;
  }
  densityValue.textContent = label;
  densityDescription.textContent = description;
  density.style.setProperty('--detail-progress', `${(Number(density.value) - 1) * 25}%`);
  app.dataset.detail = density.value;
}

density.addEventListener('input', () => {
  userAdjustedDensity = true;
  updateDetailControl();
  generateMap();
  updateArtworkDescription();
  rememberPreferences();
});

scope.addEventListener('input', () => { userAdjustedScope = true; updateScopeControl(); updateDetailControl(); rememberPreferences(); });
scope.addEventListener('change', async () => {
  const requestId = ++geographyRequest;
  scope.disabled = true;
  document.querySelector('#export-button').disabled = true;
  document.querySelector('#mobile-map-status').textContent = 'Redrawing map…';
  signalCopy.textContent = 'REDRAWING GEOGRAPHIC FIELD';
  const nextMapData = await loadGeography(currentPlace);
  if (requestId === geographyRequest && nextMapData?.features?.length) {
    realMapData = nextMapData;
    applyMapQualityGuidance(realMapData);
    updateDetailControl();
    generateMap();
    signalCopy.textContent = `LOCKED / ${currentPlace.lat}`;
    document.querySelector('#mobile-map-status').textContent = 'Map redrawn.';
  } else if (requestId === geographyRequest) {
    signalCopy.textContent = 'MAP DATA UNAVAILABLE / PREVIOUS FIELD KEPT';
    document.querySelector('#mobile-map-status').textContent = 'Could not redraw. Previous map kept.';
  }
  scope.disabled = false;
  document.querySelector('#export-button').disabled = false;
});

updateDetailControl();
updateScopeControl();
inscription.addEventListener('input', () => {
  document.querySelector('#map-inscription').textContent = inscription.value.toUpperCase() || 'UNTITLED COORDINATE';
  fitInscription(document.querySelector('#poster-map'));
  rememberPreferences();
});
document.querySelector('[data-reframe]').addEventListener('click', () => {
  variant = (variant + 1) % framePresets.length;
  applyFrame();
  fitLiveCityName();
  document.querySelector('.artifact').animate([{ transform: 'scale(.95) rotate(2deg)' }, { transform: 'scale(1) rotate(0)' }], { duration: 520, easing: 'cubic-bezier(.2,.8,.2,1)' });
});
document.querySelectorAll('[data-mobile-panel]').forEach(button => button.addEventListener('click', () => {
  const next = composer.dataset.mobilePanel === button.dataset.mobilePanel ? '' : button.dataset.mobilePanel;
  composer.dataset.mobilePanel = next;
  document.querySelectorAll('[data-mobile-panel]').forEach(item => item.setAttribute('aria-expanded', String(item.dataset.mobilePanel === next)));
}));
document.querySelector('.artifact-space').addEventListener('click', event => {
  if (composer.dataset.mobilePanel && !event.target.closest('[data-reframe]')) closeMobilePanel();
});
document.addEventListener('keydown', event => { if (event.key === 'Escape' && composer.dataset.mobilePanel) closeMobilePanel(); });
document.querySelector('#export-button').addEventListener('click', revealArtifact);
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => exportDialog.close()));
document.querySelectorAll('[data-preview]').forEach(button => button.addEventListener('click', () => selectOutput(button.dataset.preview)));
document.querySelectorAll('[data-raster]').forEach(button => button.addEventListener('click', () => exportRaster(button.dataset.raster, button)));
document.querySelector('[data-info]').addEventListener('click', () => infoDialog.showModal());
document.querySelector('[data-info-close]').addEventListener('click', () => infoDialog.close());

restorePreferences();
setMode(currentMode, false);
makeWorld();
generateMap();
fitInscription(document.querySelector('#poster-map'));
