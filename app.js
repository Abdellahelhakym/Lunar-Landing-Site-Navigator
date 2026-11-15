// Developed with AI assistance (Claude). Idea and design by the team.
'use strict';

const $ = (selector) => document.querySelector(selector);
const FALLBACK_START = '2026-11-15T00:00:00Z';
const state = {
  sites: [],
  ephemeris: {},
  horizons: {},
  validation: { horizons_check: [], published_context: [] },
  validationLoaded: false,
  activeSite: null,
  activeSamples: [],
  activeHorizon: Array(360).fill(0),
  activeTerrainHorizon: null,
  useTerrain: true,
  currentMetrics: null,
  selectedIndex: 0,
  compareMetrics: [],
  animation: null,
  timelinePlot: null,
  skyZoom: true
};

function parseUtc(value) {
  if (!value) return NaN;
  const text = String(value);
  return Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(text) ? text : `${text}Z`);
}

function isoDate(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function fallbackSites() {
  return [
    { id: 'shackleton', name: 'Shackleton Crater (approximate point)', lon: 0, lat: -89.9, alt_km: 0, coordinate_note: 'Approximate point within the IAU Gazetteer crater bounds; not the crater center or an officially selected landing site.' },
    { id: 'de-gerlache', name: 'De Gerlache Rim', lon: 20.6, lat: -88.6, alt_km: 0 },
    { id: 'haworth', name: 'Haworth Crater (IAU center)', lon: -5.17, lat: -87.45, alt_km: 0 },
    { id: 'malapert', name: 'Malapert Massif (approximate point)', lon: 0, lat: -86.0, alt_km: 0, coordinate_note: 'Representative point only; NASA lists this candidate region but does not publish one specific landing-site coordinate.' },
    { id: 'nobile', name: 'Nobile Crater (IAU center)', lon: 53.27, lat: -85.28, alt_km: 0 }
  ];
}

function makeFallbackEphemeris(sites) {
  const result = {};
  const start = parseUtc(FALLBACK_START);
  const hours = 30 * 24;
  sites.forEach((site, siteIndex) => {
    const sun = [];
    const earth = [];
    const phase = siteIndex * 1.17;
    for (let i = 0; i <= hours; i += 1) {
      const time = new Date(start + i * 3600000).toISOString().slice(0, 16);
      const daily = (2 * Math.PI * i) / 708;
      const longCycle = (2 * Math.PI * i) / (14 * 24);
      const sunEl = -1.5 + 2.8 * Math.sin(daily + phase) + 1.2 * Math.sin(longCycle + phase * 0.6);
      const earthEl = -0.5 + 5.5 * Math.sin((2 * Math.PI * i) / (27.3 * 24) + phase * 0.8);
      sun.push({ t: time, az: (i * 0.51 + siteIndex * 51) % 360, el: sunEl });
      earth.push({ t: time, az: (170 + i * 0.049 + siteIndex * 31) % 360, el: earthEl });
    }
    result[site.id] = { sun, earth };
  });
  return result;
}

async function fetchJsonFrom(paths) {
  const errors = [];
  for (const path of paths) {
    try {
      const response = await fetch(path, { cache: 'force-cache' });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return await response.json();
    } catch (error) {
      errors.push(`${path}: ${error.message}`);
    }
  }
  throw new Error(errors.join('; '));
}

async function loadData() {
  const dataWarnings = [];
  if (location.protocol === 'file:') {
    dataWarnings.push('This page is opened as a local file. Browsers block fetch from file://; open the project root through VS Code Live Server or another static HTTP server.');
  }
  const [sitesResult, ephemerisResult, horizonResult, validationResult] = await Promise.allSettled([
    fetchJsonFrom(['data/sites.json', '../data/sites.json']),
    fetchJsonFrom(['data/ephemeris.json', '../data/ephemeris.json']),
    fetchJsonFrom(['data/horizon.json', '../data/horizon.json']),
    fetchJsonFrom(['data/validation.json', '../data/validation.json'])
  ]);

  const loadedSites = sitesResult.status === 'fulfilled' && Array.isArray(sitesResult.value) && sitesResult.value.length
    ? sitesResult.value
    : null;
  state.sites = loadedSites || fallbackSites();
  if (!loadedSites) {
    const reason = sitesResult.status === 'rejected' ? sitesResult.reason.message : 'The sites file is empty or has an invalid shape.';
    dataWarnings.push(`Site data unavailable (${reason}). Using built-in sample sites.`);
  }

  const loadedEphemeris = ephemerisResult.status === 'fulfilled' && ephemerisResult.value && typeof ephemerisResult.value === 'object'
    ? ephemerisResult.value
    : null;
  state.ephemeris = loadedEphemeris || makeFallbackEphemeris(state.sites);
  if (!loadedEphemeris) {
    const reason = ephemerisResult.status === 'rejected' ? ephemerisResult.reason.message : 'The ephemeris file is empty or has an invalid shape.';
    dataWarnings.push(`Ephemeris unavailable (${reason}). Showing illustrative sample data; do not use it for mission decisions.`);
  } else {
    const ephemerisBySite = loadedEphemeris.sites && typeof loadedEphemeris.sites === 'object'
      ? loadedEphemeris.sites
      : loadedEphemeris;
    const missingSites = state.sites.filter((site) => !validPair(ephemerisBySite[site.id]));
    if (missingSites.length) {
      dataWarnings.push(`Sun/Earth ephemeris is incomplete for ${missingSites.map((site) => site.name).join(', ')}. Those sites will use illustrative sample data.`);
    }
  }

  state.horizons = horizonResult.status === 'fulfilled' && horizonResult.value && typeof horizonResult.value === 'object'
    ? horizonResult.value
    : {};
  if (horizonResult.status === 'rejected') dataWarnings.push('Terrain profile file unavailable. A flat horizon will be used unless site terrain data is provided.');

  const validationData = validationResult.status === 'fulfilled' ? validationResult.value : null;
  state.validationLoaded = Boolean(validationData && typeof validationData === 'object' && !Array.isArray(validationData));
  state.validation = state.validationLoaded
    ? {
      horizons_check: Array.isArray(validationData.horizons_check) ? validationData.horizons_check : [],
      published_context: Array.isArray(validationData.published_context) ? validationData.published_context : []
    }
    : { horizons_check: [], published_context: [] };
  if (validationResult.status === 'rejected') {
    dataWarnings.push('Optional validation data could not be loaded. The Validation tab will explain how to add it.');
  }
  showDataWarnings(dataWarnings);
}

function showDataWarnings(messages) {
  const box = $('#data-message');
  const hasRequiredDataIssue = messages.some((message) =>
    message.startsWith('This page is opened as a local file.')
    || message.startsWith('Site data unavailable')
    || message.startsWith('Ephemeris unavailable')
    || message.startsWith('Sun/Earth ephemeris is incomplete'));
  if (!hasRequiredDataIssue) {
    box.hidden = true;
    return;
  }
  box.textContent = 'Data could not be loaded. Open the site through a web server.';
  box.hidden = false;
}

function validPair(pair) {
  return pair && Array.isArray(pair.sun) && Array.isArray(pair.earth);
}

function ephemerisSites() {
  if (state.ephemeris.sites && typeof state.ephemeris.sites === 'object') return state.ephemeris.sites;
  return state.ephemeris;
}

function siteEphemeris(siteId) {
  const data = ephemerisSites()[siteId];
  if (validPair(data)) return data;
  return makeFallbackEphemeris([state.sites.find((site) => site.id === siteId) || state.sites[0]])[siteId];
}

function samplesForRange(siteId, start, end) {
  const pair = siteEphemeris(siteId);
  const from = parseUtc(`${start}T00:00:00`);
  const to = parseUtc(`${end}T23:59:59`);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) throw new Error('Choose a valid date range with the end date on or after the start date.');
  const sunByTime = new Map(pair.sun.map((sample) => [parseUtc(sample.t), sample]));
  return pair.earth
    .map((earthSample) => {
      const timestamp = parseUtc(earthSample.t);
      return { timestamp, sun: sunByTime.get(timestamp), earth: earthSample };
    })
    .filter((sample) => sample.sun && Number.isFinite(sample.timestamp) && sample.timestamp >= from && sample.timestamp <= to)
    .sort((a, b) => a.timestamp - b.timestamp);
}

function horizonForSite(siteId) {
  const profiles = state.horizons.sites && typeof state.horizons.sites === 'object'
    ? state.horizons.sites
    : state.horizons;
  const profile = profiles[siteId];
  const angles = Array.isArray(profile) ? profile : profile?.status === 'available' ? profile.horizonAngles : null;
  if (!Array.isArray(angles) || angles.length < 360 || angles.slice(0, 360).some((value) => !Number.isFinite(Number(value)))) {
    return { values: Array(360).fill(0), approximate: true };
  }
  return { values: angles.slice(0, 360).map(Number), approximate: false };
}

function isVisible(el, az, horizon) {
  const index = ((Math.round(Number(az)) % 360) + 360) % 360;
  return Number(el) > horizon[index];
}

function longestFalseRun(visibility) {
  let longest = 0;
  let run = 0;
  visibility.forEach((visible) => {
    if (visible) {
      longest = Math.max(longest, run);
      run = 0;
    } else {
      run += 1;
    }
  });
  return Math.max(longest, run);
}

function calculateMetrics(samples, horizon, sunWeight) {
  if (!samples.length) throw new Error('No hourly ephemeris samples are available in this date range.');
  const sunVisible = samples.map(({ sun }) => isVisible(sun.el, sun.az, horizon));
  const earthVisible = samples.map(({ earth }) => isVisible(earth.el, earth.az, horizon));
  const sunPercent = (sunVisible.filter(Boolean).length / samples.length) * 100;
  const earthPercent = (earthVisible.filter(Boolean).length / samples.length) * 100;
  const blackout = sunVisible.map((visible, index) => visible || earthVisible[index]);
  const sunElevations = samples.map(({ sun }) => Number(sun.el)).filter(Number.isFinite);
  const spacingHours = samples.length > 1
    ? Math.max(1, (samples[1].timestamp - samples[0].timestamp) / 3600000)
    : 1;
  return {
    samples,
    sunVisible,
    earthVisible,
    sunPercent,
    earthPercent,
    longestDarkness: longestFalseRun(sunVisible) * spacingHours,
    longestOutage: longestFalseRun(earthVisible) * spacingHours,
    longestBlackout: longestFalseRun(blackout) * spacingHours,
    meanSunElevation: sunElevations.reduce((sum, value) => sum + value, 0) / (sunElevations.length || 1),
    maxSunElevation: Math.max(...sunElevations),
    score: sunWeight * sunPercent + (1 - sunWeight) * earthPercent,
    spacingHours
  };
}

function hoursUntilNextSet(visibility, startIndex, stepHours) {
  if (visibility.length < 2) return null;
  for (let index = startIndex; index < visibility.length - 1; index += 1) {
    if (visibility[index] && !visibility[index + 1]) return (index - startIndex + 1) * stepHours;
  }
  return null;
}

function formatDuration(hours) {
  if (hours === null || !Number.isFinite(hours)) return 'No set found';
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  const days = Math.floor(hours / 24);
  const remainder = Math.round(hours % 24);
  if (days) return `${days}d ${remainder}h`;
  return `${Math.round(hours * 10) / 10} h`;
}

function longestFalseRunTouchesBoundary(visibility) {
  if (!visibility.length) return false;
  const longest = longestFalseRun(visibility);
  if (!longest) return false;
  let startRun = 0;
  let endRun = 0;
  while (startRun < visibility.length && !visibility[startRun]) startRun += 1;
  while (endRun < visibility.length && !visibility[visibility.length - 1 - endRun]) endRun += 1;
  return startRun === longest || endRun === longest;
}

function formatPeriodRun(hours, visibility, zeroLabel) {
  if (hours === 0 && zeroLabel) return zeroLabel;
  return `${longestFalseRunTouchesBoundary(visibility) ? '≥ ' : ''}${formatDuration(hours)}`;
}

function formatSetTime(hours, target) {
  return hours === null ? `${target} does not set in this period` : formatDuration(hours);
}

function formatUtc(timestamp, includeDate) {
  const date = new Date(timestamp);
  const options = { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' };
  const time = new Intl.DateTimeFormat('en-GB', options).format(date);
  return `${includeDate ? `${isoDate(timestamp)} ` : ''}${time} UT`;
}

function currentSunWeight() {
  return Number($('#sun-weight').value) / 100;
}

function setHorizonWarning(horizon) {
  const warning = $('#horizon-warning');
  if (horizon.approximate) {
    warning.textContent = 'Flat Horizon Approximation – Terrain data unavailable. Sun visibility is an upper bound. All times in UT.';
  } else if (horizon.disabled) {
    warning.textContent = 'Flat Horizon Approximation – Terrain model disabled. Sun visibility is an upper bound. All times in UT.';
  } else {
    warning.textContent = 'NASA LOLA Terrain Model: Active. Geometric terrain obstruction only; vertical units are unconfirmed and this is not a mission-feasibility prediction. All times in UT.';
  }
  warning.hidden = false;
}

function updateTerrainControls() {
  const toggle = $('#terrain-toggle');
  const available = Boolean(state.activeTerrainHorizon);
  const enabled = available && state.useTerrain;
  toggle.disabled = !available;
  toggle.setAttribute('aria-pressed', String(enabled));
  toggle.textContent = available ? `Terrain ${enabled ? 'on' : 'off'}` : 'Terrain unavailable';
  $('#analysis-terrain-source').textContent = enabled
    ? 'Terrain: LOLA DEM'
    : 'Flat horizon (upper bound)';
  $('#sky-horizon-legend').textContent = enabled ? 'LOLA terrain horizon' : 'Flat horizon (0°)';
  $('#analysis-terrain-impact').hidden = !available;
  if (available && state.activeSamples.length) {
    const flat = calculateMetrics(state.activeSamples, Array(360).fill(0), currentSunWeight());
    const terrain = calculateMetrics(state.activeSamples, state.activeTerrainHorizon, currentSunWeight());
    $('#analysis-terrain-impact').textContent = `Sun visibility — Flat horizon: ${flat.sunPercent.toFixed(1)}% → With terrain: ${terrain.sunPercent.toFixed(1)}%. Earth visibility — Flat horizon: ${flat.earthPercent.toFixed(1)}% → With terrain: ${terrain.earthPercent.toFixed(1)}%.`;
  }
}

function applyTerrainMode() {
  const terrainActive = Boolean(state.activeTerrainHorizon) && state.useTerrain;
  state.activeHorizon = terrainActive ? state.activeTerrainHorizon : Array(360).fill(0);
  state.currentMetrics = calculateMetrics(state.activeSamples, state.activeHorizon, currentSunWeight());
  state.selectedIndex = Math.min(state.selectedIndex, state.activeSamples.length - 1);
  updateTerrainControls();
  setHorizonWarning({
    approximate: !state.activeTerrainHorizon,
    disabled: Boolean(state.activeTerrainHorizon) && !state.useTerrain
  });
  renderAnalysis();
}

function fillSiteControls() {
  const longitudeLabel = (longitude) => {
    const value = Number(longitude);
    if (!Number.isFinite(value)) return 'longitude unavailable';
    const hemisphere = value >= 0 ? 'E' : 'W';
    return `lon ${value >= 0 ? '+' : ''}${value.toFixed(1)}° ${hemisphere} (East-positive)`;
  };
  const options = state.sites.map((site) => `<option value="${escapeHtml(site.id)}">${escapeHtml(site.name)} · ${escapeHtml(longitudeLabel(site.lon))}</option>`).join('');
  $('#site-select').innerHTML = options;
  const rangeSite = $('#range-site');
  if (rangeSite) rangeSite.innerHTML = options;
  updateSiteCoordinateNote();
  const checkboxes = state.sites.map((site, index) => `
    <label class="check-option"><input type="checkbox" value="${escapeHtml(site.id)}" ${index < Math.min(3, state.sites.length) ? 'checked' : ''}>
      <span>${escapeHtml(site.name)} · ${escapeHtml(longitudeLabel(site.lon))}</span></label>`).join('');
  $('#compare-sites').innerHTML = checkboxes;
}

function updateSiteCoordinateNote() {
  const site = state.sites.find((item) => item.id === $('#site-select').value);
  const note = site?.coordinate_note || 'Approximate feature coordinates; confirm before mission use.';
  const summary = note.split(/[.;]/, 1)[0].trim();
  const noteElement = $('#site-coordinate-note');
  noteElement.textContent = `${summary}.`;
  noteElement.title = note;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function initializeDates() {
  const allTimes = Object.values(ephemerisSites())
    .flatMap((pair) => validPair(pair) ? pair.sun.map((sample) => parseUtc(sample.t)) : [])
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const start = allTimes.length ? isoDate(allTimes[0]) : isoDate(parseUtc(FALLBACK_START));
  const end = allTimes.length ? isoDate(allTimes[allTimes.length - 1]) : start;
  const suggestedEnd = Math.min(parseUtc(`${start}T00:00:00`) + (29 * 86400000), parseUtc(`${end}T00:00:00`));
  const startDate = start;
  const endDate = isoDate(suggestedEnd >= parseUtc(`${start}T00:00:00`) ? suggestedEnd : parseUtc(`${start}T00:00:00`));
  ['#start-date', '#compare-start'].forEach((selector) => { $(selector).value = startDate; });
  ['#end-date', '#compare-end'].forEach((selector) => { $(selector).value = endDate; });
}

function analyze() {
  try {
    const site = state.sites.find((item) => item.id === $('#site-select').value);
    if (!site) throw new Error('Select a landing site.');
    const horizon = horizonForSite(site.id);
    const samples = samplesForRange(site.id, $('#start-date').value, $('#end-date').value);
    state.activeSite = site;
    state.activeSamples = samples;
    state.activeTerrainHorizon = horizon.approximate ? null : horizon.values;
    state.selectedIndex = 0;
    applyTerrainMode();
    $('#app-error').hidden = true;
  } catch (error) {
    $('#app-error').textContent = error.message;
    $('#app-error').hidden = false;
  }
}

function renderAnalysis() {
  const metrics = state.currentMetrics;
  if (!metrics) return;
  $('#analysis-results').hidden = false;
  $('#analysis-empty').hidden = true;
  $('#analysis-site-title').textContent = state.activeSite.name;
  $('#sky-canvas').setAttribute('aria-label', state.useTerrain && state.activeTerrainHorizon
    ? 'Polar sky plot with the LOLA terrain horizon, Sun and Earth paths, and selected positions'
    : 'Polar sky plot with a flat zero-degree horizon, Sun and Earth paths, and selected positions');
  $('#sky-summary').textContent = state.useTerrain && state.activeTerrainHorizon
    ? 'Azimuth is measured clockwise from north. Concentric circles show elevation above the horizon. Solid gold and dashed blue paths show visible hourly Sun and Earth positions. The gray region marks the LOLA terrain horizon profile; colored dots mark the selected time.'
    : 'Azimuth is measured clockwise from north. Concentric circles show elevation above the horizon. Solid gold and dashed blue paths show visible hourly Sun and Earth positions. The gray region marks a flat zero-degree horizon; colored dots mark the selected time.';
  $('#window-label').textContent = `${isoDate(metrics.samples[0].timestamp)} — ${isoDate(metrics.samples[metrics.samples.length - 1].timestamp)} UT`;
  $('#score-value').textContent = Math.round(metrics.score);
  $('#sun-percent').textContent = `${metrics.sunPercent.toFixed(1)}%`;
  $('#earth-percent').textContent = `${metrics.earthPercent.toFixed(1)}%`;
  const blackoutVisibility = metrics.sunVisible.map((visible, sampleIndex) => visible || metrics.earthVisible[sampleIndex]);
  $('#darkness-value').textContent = formatPeriodRun(metrics.longestDarkness, metrics.sunVisible, 'None in this period');
  $('#outage-value').textContent = formatPeriodRun(metrics.longestOutage, metrics.earthVisible);
  $('#blackout-value').textContent = formatPeriodRun(metrics.longestBlackout, blackoutVisibility);
  const index = Math.min(state.selectedIndex, metrics.samples.length - 1);
  $('#sunset-value').textContent = formatSetTime(hoursUntilNextSet(metrics.sunVisible, index, metrics.spacingHours), 'Sun');
  $('#earthset-value').textContent = formatSetTime(hoursUntilNextSet(metrics.earthVisible, index, metrics.spacingHours), 'Earth');
  $('#mean-sun-elevation').textContent = `${metrics.meanSunElevation.toFixed(1)}°`;
  $('#max-sun-elevation').textContent = `${metrics.maxSunElevation.toFixed(1)}°`;
  $('#time-slider').max = String(Math.max(0, metrics.samples.length - 1));
  $('#time-slider').value = String(index);
  drawCurrentTime();
  drawSkyPlot();
  drawTimeline();
  updateTerrainControls();
  renderValidation();
}

function drawCurrentTime() {
  if (!state.currentMetrics) return;
  const index = Math.min(state.selectedIndex, state.activeSamples.length - 1);
  const sample = state.activeSamples[index];
  $('#selected-time').textContent = formatUtc(sample.timestamp, true);
  $('#sky-time').textContent = formatUtc(sample.timestamp, true);
  $('#current-sun-elevation').textContent = `${Number(sample.sun.el).toFixed(1)}°`;
  $('#sky-position-label').textContent = `Sun ${Number(sample.sun.el).toFixed(1)}°, Earth ${Number(sample.earth.el).toFixed(1)}°`;
}

function canvasContext(canvas) {
  const rect = canvas.getBoundingClientRect();
  const ratio = Math.max(1, window.devicePixelRatio || 1);
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const context = canvas.getContext('2d');
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { context, width, height };
}

function polarPoint(centerX, centerY, radius, azimuth) {
  const angle = (Number(azimuth) - 90) * Math.PI / 180;
  return { x: centerX + radius * Math.cos(angle), y: centerY + radius * Math.sin(angle) };
}

function skyPoint(centerX, centerY, radius, azimuth, elevation) {
  const numericElevation = Number(elevation);
  const radialDistance = state.skyZoom
    ? radius * (10 - Math.max(0, Math.min(10, numericElevation))) / 10
    : radius * (90 - Math.max(-6, Math.min(90, numericElevation))) / 90;
  return polarPoint(centerX, centerY, radialDistance, azimuth);
}

function drawSkyPlot() {
  if (!state.currentMetrics) return;
  const canvas = $('#sky-canvas');
  const { context: ctx, width, height } = canvasContext(canvas);
  const cx = width / 2;
  const cy = height / 2 + 5;
  const radius = Math.max(50, Math.min(width * 0.39, height * 0.46));
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.clip();
  const horizonPoints = [];
  for (let az = 0; az < 360; az += 1) {
    horizonPoints.push(skyPoint(cx, cy, radius, az, state.activeHorizon[az]));
  }
  ctx.beginPath();
  horizonPoints.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
  for (let az = 359; az >= 0; az -= 1) {
    const point = polarPoint(cx, cy, radius, az);
    ctx.lineTo(point.x, point.y);
  }
  ctx.closePath();
  ctx.fillStyle = 'rgba(125, 141, 162, .12)';
  ctx.fill();
  ctx.strokeStyle = '#b3c0cd';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  const zoomed = state.skyZoom;
  const maxElevation = zoomed ? 10 : 90;
  const ringStep = zoomed ? 2 : 30;
  for (let elevation = 0; elevation <= maxElevation; elevation += ringStep) {
    const ringRadius = zoomed
      ? radius * (10 - elevation) / 10
      : radius * (90 - elevation) / 90;
    ctx.beginPath();
    ctx.arc(cx, cy, ringRadius, 0, Math.PI * 2);
    ctx.strokeStyle = elevation === 0 ? '#b3c0cd' : '#667585';
    ctx.lineWidth = elevation === 0 ? 1.5 : 1;
    ctx.setLineDash(elevation === 0 ? [] : [3, 5]);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  drawEphemerisPath(ctx, state.activeSamples, 'sun', '#f2c14e', cx, cy, radius);
  drawEphemerisPath(ctx, state.activeSamples, 'earth', '#4da3ff', cx, cy, radius);
  const sample = state.activeSamples[state.selectedIndex];
  drawMarker(ctx, skyPoint(cx, cy, radius, sample.sun.az, Math.max(0, sample.sun.el)), '#f2c14e', 'SUN', width, height);
  drawMarker(ctx, skyPoint(cx, cy, radius, sample.earth.az, Math.max(0, sample.earth.el)), '#4da3ff', 'EARTH', width, height);
  ctx.restore();
  ctx.font = '600 16px system-ui, "Segoe UI", Roboto, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  [['N', cx, cy - radius - 14], ['E', cx + radius + 14, cy], ['S', cx, cy + radius + 14], ['W', cx - radius - 14, cy]].forEach(([label, x, y]) => {
    ctx.fillStyle = '#9aa7b4';
    ctx.fillText(label, x, y);
  });
  ctx.font = '16px system-ui, "Segoe UI", Roboto, Arial, sans-serif';
  ctx.fillStyle = '#9aa7b4';
  ctx.textAlign = 'left';
  const ringLabels = zoomed ? [2, 4, 6, 8, 10] : [30, 60, 90];
  ringLabels.forEach((elevation) => {
    const ringRadius = zoomed ? radius * (10 - elevation) / 10 : radius * (90 - elevation) / 90;
    ctx.fillText(`${elevation}°`, cx + 4, cy - ringRadius + 11);
  });
}

function drawEphemerisPath(ctx, samples, target, color, cx, cy, radius) {
  ctx.beginPath();
  let drawing = false;
  samples.forEach((sample) => {
    const pointData = sample[target];
    if (!isVisible(pointData.el, pointData.az, state.activeHorizon)) {
      drawing = false;
      return;
    }
    const point = skyPoint(cx, cy, radius, pointData.az, pointData.el);
    if (!drawing) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
    drawing = true;
  });
  ctx.strokeStyle = '#0f141a';
  ctx.lineWidth = 5;
  ctx.globalAlpha = .95;
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.8;
  ctx.setLineDash(target === 'earth' ? [7, 4] : []);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}

function drawMarker(ctx, point, color, label, width, height) {
  const safeX = Math.max(24, Math.min(width - 24, point.x));
  const safeY = Math.max(17, Math.min(height - 17, point.y));
  ctx.beginPath();
  ctx.arc(safeX, safeY, 8, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#0f141a';
  ctx.stroke();
  ctx.font = '600 16px system-ui, "Segoe UI", Roboto, Arial, sans-serif';
  ctx.fillStyle = color;
  ctx.textAlign = safeX > width - 80 ? 'right' : 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillText(label, safeX + (safeX > width - 80 ? -11 : 11), safeY - 5);
}

function timelineState(index) {
  const sun = state.currentMetrics.sunVisible[index];
  const earth = state.currentMetrics.earthVisible[index];
  if (sun && earth) return { text: 'Sun + Earth visible', color: '#3fb950', blackout: false };
  if (sun || earth) return { text: sun ? 'Sun visible only' : 'Earth visible only', color: '#d29922', blackout: false };
  return { text: 'None visible — blackout', color: '#f85149', blackout: true };
}

function drawTimeline() {
  if (!state.currentMetrics) return;
  const canvas = $('#timeline-canvas');
  const { context: ctx, width, height } = canvasContext(canvas);
  ctx.clearRect(0, 0, width, height);
  const x = 8;
  const y = 37;
  const barWidth = width - 16;
  const barHeight = 32;
  const count = state.activeSamples.length;
  const step = barWidth / count;
  const hatchCanvas = document.createElement('canvas');
  hatchCanvas.width = 8;
  hatchCanvas.height = 8;
  const hatchContext = hatchCanvas.getContext('2d');
  hatchContext.fillStyle = '#f85149';
  hatchContext.fillRect(0, 0, 8, 8);
  hatchContext.strokeStyle = 'rgba(15, 20, 26, .45)';
  hatchContext.lineWidth = 1;
  hatchContext.beginPath();
  hatchContext.moveTo(-2, 8);
  hatchContext.lineTo(8, -2);
  hatchContext.moveTo(2, 10);
  hatchContext.lineTo(10, 2);
  hatchContext.stroke();
  const blackoutPattern = ctx.createPattern(hatchCanvas, 'repeat');
  state.activeSamples.forEach((sample, index) => {
    const status = timelineState(index);
    ctx.fillStyle = status.blackout ? blackoutPattern : status.color;
    ctx.fillRect(x + index * step, y, Math.max(step + .35, 1), barHeight);
  });
  const firstTimestamp = state.activeSamples[0].timestamp;
  let lastTickDay = 0;
  state.activeSamples.forEach((sample, index) => {
    const day = Math.floor((sample.timestamp - firstTimestamp) / 86400000);
    if (day > 0 && day % 5 === 0 && day !== lastTickDay) {
      lastTickDay = day;
      const tickX = x + index * step;
      ctx.strokeStyle = '#6b7785';
      ctx.beginPath();
      ctx.moveTo(tickX, y + barHeight);
      ctx.lineTo(tickX, y + barHeight + 6);
      ctx.stroke();
      ctx.fillStyle = '#9aa7b4';
      ctx.font = '14px system-ui, "Segoe UI", Roboto, Arial, sans-serif';
      ctx.textBaseline = 'top';
      ctx.textAlign = 'center';
      ctx.fillText(isoDate(sample.timestamp), tickX, y + barHeight + 8 + ((day / 5) % 2) * 17);
    }
  });
  ctx.strokeStyle = 'rgba(235, 242, 250, .4)';
  ctx.lineWidth = 1;
  const markerX = x + (state.selectedIndex / Math.max(1, count - 1)) * barWidth;
  ctx.beginPath();
  ctx.moveTo(markerX, y - 7);
  ctx.lineTo(markerX, y + barHeight + 8);
  ctx.stroke();
  ctx.fillStyle = '#e6edf3';
  ctx.beginPath();
  ctx.moveTo(markerX - 5, y - 9);
  ctx.lineTo(markerX + 5, y - 9);
  ctx.lineTo(markerX, y - 3);
  ctx.closePath();
  ctx.fill();
  ctx.font = '14px system-ui, "Segoe UI", Roboto, Arial, sans-serif';
  ctx.fillStyle = '#9aa7b4';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText(isoDate(state.activeSamples[0].timestamp), x, y + barHeight + 8);
  ctx.textAlign = 'right';
  ctx.fillText(isoDate(state.activeSamples[count - 1].timestamp), x + barWidth, y + barHeight + 8);
  state.timelinePlot = { x, y, width: barWidth, height: barHeight, step };
}

function selectTime(index) {
  if (!state.activeSamples.length) return;
  state.selectedIndex = Math.max(0, Math.min(state.activeSamples.length - 1, Number(index)));
  $('#time-slider').value = String(state.selectedIndex);
  drawCurrentTime();
  drawSkyPlot();
  drawTimeline();
  const metrics = state.currentMetrics;
  $('#sunset-value').textContent = formatSetTime(hoursUntilNextSet(metrics.sunVisible, state.selectedIndex, metrics.spacingHours), 'Sun');
  $('#earthset-value').textContent = formatSetTime(hoursUntilNextSet(metrics.earthVisible, state.selectedIndex, metrics.spacingHours), 'Earth');
}

function updateWeights(source = '#sun-weight') {
  const changedValue = Number($(source).value);
  const sunWeight = source === '#earth-weight' ? 100 - changedValue : changedValue;
  $('#sun-weight').value = String(sunWeight);
  $('#earth-weight').value = String(100 - sunWeight);
  $('#sun-weight-value').textContent = `${sunWeight}%`;
  $('#earth-weight-value').textContent = `${100 - sunWeight}%`;
  if (state.currentMetrics) {
    state.currentMetrics.score = (sunWeight / 100) * state.currentMetrics.sunPercent + (1 - sunWeight / 100) * state.currentMetrics.earthPercent;
    $('#score-value').textContent = String(Math.round(state.currentMetrics.score));
  }
  if (state.compareMetrics.length) {
    state.compareMetrics.forEach((metrics) => {
      metrics.score = (sunWeight / 100) * metrics.sunPercent + (1 - sunWeight / 100) * metrics.earthPercent;
    });
    renderCompareResults(state.compareMetrics);
  }
}

function compareSites() {
  const selectedIds = Array.from($('#compare-sites').querySelectorAll('input:checked')).map((input) => input.value);
  const error = $('#compare-error');
  try {
    if (selectedIds.length < 3 || selectedIds.length > 5) throw new Error('Select between 3 and 5 sites to compare.');
    const results = selectedIds.map((id) => {
      const site = state.sites.find((item) => item.id === id);
      const horizon = horizonForSite(id);
      return {
        site,
        terrainApproximate: horizon.approximate,
        ...calculateMetrics(samplesForRange(id, $('#compare-start').value, $('#compare-end').value), horizon.values, currentSunWeight())
      };
    });
    state.compareMetrics = results;
    error.hidden = true;
    $('#compare-results').hidden = false;
    $('#compare-window-label').textContent = `${$('#compare-start').value} — ${$('#compare-end').value} UT`;
    renderCompareResults(results);
  } catch (exception) {
    error.textContent = exception.message;
    error.hidden = false;
  }
}

function renderCompareResults(results) {
  const ranked = [...results].sort((a, b) => b.score - a.score);
  const hasTerrain = results.some((item) => !item.terrainApproximate);
  const hasFlat = results.some((item) => item.terrainApproximate);
  const terrainWarning = $('#compare-terrain-warning');
  terrainWarning.hidden = !(hasTerrain && hasFlat);
  terrainWarning.textContent = hasTerrain && hasFlat
    ? 'This ranking mixes LOLA terrain profiles with flat-horizon upper-bound estimates. Scores from the two terrain sources are not directly comparable.'
    : '';
  $('#compare-table-body').innerHTML = ranked.map((item, index) => `
    <tr><td>${String(index + 1).padStart(2, '0')}</td><td>${escapeHtml(item.site.name)}</td>
    <td>${item.terrainApproximate ? 'Flat horizon (upper bound)' : 'Terrain: LOLA DEM'}</td>
    <td>${item.sunPercent.toFixed(1)}%</td><td>${item.earthPercent.toFixed(1)}%</td>
    <td>${formatPeriodRun(item.longestDarkness, item.sunVisible, 'None in this period')}</td><td>${formatPeriodRun(item.longestOutage, item.earthVisible)}</td><td><strong>${Math.round(item.score)}</strong></td></tr>`).join('');
  drawCompareChart(ranked);
}

function shortSiteName(site) {
  const knownNames = {
    shackleton: 'Shackleton',
    malapert: 'Malapert',
    haworth: 'Haworth',
    nobile: 'Nobile',
    artemis: 'Near-pole'
  };
  return knownNames[site.id] || site.name.replace(/\s*\(.*?\)/g, '').replace(/\s+(Crater|Massif|Rim)$/i, '');
}

function drawCompareChart(results) {
  const canvas = $('#compare-canvas');
  const { context: ctx, width, height } = canvasContext(canvas);
  ctx.clearRect(0, 0, width, height);
  const left = Math.min(175, width * .35);
  const right = 42;
  const top = 14;
  const bottom = 25;
  const plotWidth = width - left - right;
  const rowHeight = (height - top - bottom) / Math.max(1, results.length);
  ctx.font = '16px system-ui, "Segoe UI", Roboto, Arial, sans-serif';
  results.forEach((item, index) => {
    const centerY = top + rowHeight * index + rowHeight / 2;
    ctx.fillStyle = '#e6edf3';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const name = shortSiteName(item.site);
    ctx.fillText(name, left - 12, centerY);
    [
      { value: item.sunPercent, color: '#f2c14e' },
      { value: item.earthPercent, color: '#4da3ff' },
      { value: item.score, color: '#9aa7b4' }
    ].forEach((bar, barIndex) => {
      const barY = centerY - 19 + barIndex * 13;
      ctx.fillStyle = '#26313d';
      ctx.fillRect(left, barY, plotWidth, 8);
      ctx.fillStyle = bar.color;
      ctx.fillRect(left, barY, plotWidth * Math.max(0, Math.min(100, bar.value)) / 100, 8);
    });
    ctx.fillStyle = '#9aa7b4';
    ctx.textAlign = 'left';
    ctx.font = '16px system-ui, "Segoe UI", Roboto, Arial, sans-serif';
    ctx.fillText(`${Math.round(item.score)}`, left + plotWidth + 8, centerY);
    ctx.font = '16px system-ui, "Segoe UI", Roboto, Arial, sans-serif';
  });
}

function compareRanges() {
  const siteId = $('#range-site').value;
  const site = state.sites.find((item) => item.id === siteId);
  try {
    const horizon = horizonForSite(siteId);
    const windowA = calculateMetrics(samplesForRange(siteId, $('#range-a-start').value, $('#range-a-end').value), horizon.values, currentSunWeight());
    const windowB = calculateMetrics(samplesForRange(siteId, $('#range-b-start').value, $('#range-b-end').value), horizon.values, currentSunWeight());
    const results = [windowA, windowB].map((metrics, index) => `
      <article class="range-result"><h3>Window ${index ? 'B' : 'A'}</h3>
      <p>${index ? $('#range-b-start').value : $('#range-a-start').value} — ${index ? $('#range-b-end').value : $('#range-a-end').value}</p>
      <p>Sun illumination <strong>${metrics.sunPercent.toFixed(1)}%</strong> · Earth visibility <strong>${metrics.earthPercent.toFixed(1)}%</strong></p>
      <p>Longest darkness <strong>${formatDuration(metrics.longestDarkness)}</strong> · Longest outage <strong>${formatDuration(metrics.longestOutage)}</strong></p>
      <p>Weighted score <strong>${Math.round(metrics.score)} / 100</strong></p></article>`).join('');
    const terrainLabel = horizon.approximate ? 'Flat horizon (upper bound)' : 'Terrain: LOLA DEM';
    $('#range-results').innerHTML = `<p class="muted small" style="grid-column:1/-1">${escapeHtml(site.name)} · ${terrainLabel}</p>${results}`;
    $('#range-results').hidden = false;
  } catch (error) {
    $('#range-results').innerHTML = `<p class="inline-error" role="alert">${escapeHtml(error.message)}</p>`;
    $('#range-results').hidden = false;
  }
}

function renderValidation() {
  const numericValue = (value) => value === null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
  const sourceCell = (source, url) => {
    const sourceText = escapeHtml(source || '—');
    return url && /^https:\/\//.test(url)
      ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${sourceText}</a>`
      : sourceText;
  };
  const siteName = (siteId) => state.sites.find((site) => site.id === siteId)?.name || siteId || '—';
  const horizonsRows = state.validation.horizons_check;
  const message = $('#validation-data-message');
  if (!state.validationLoaded) {
    message.textContent = 'Validation data file unavailable. Add verified JPL Horizons API results to data/validation.json. The built-in published context is shown below.';
    message.hidden = false;
  } else if (!horizonsRows.length) {
    message.textContent = 'No verified Horizons comparison rows are available. Add actual web-interface values to data/validation.json; no sample values are shown.';
    message.hidden = false;
  } else {
    message.hidden = true;
  }
  $('#validation-horizons-body').innerHTML = horizonsRows.map((row) => {
    const computedAz = numericValue(row.computed_az);
    const computedEl = numericValue(row.computed_el);
    const horizonsAz = numericValue(row.horizons_az);
    const horizonsEl = numericValue(row.horizons_el);
    const valuesAvailable = [computedAz, computedEl, horizonsAz, horizonsEl].every(Number.isFinite);
    const differenceAz = valuesAvailable ? ((computedAz - horizonsAz + 540) % 360) - 180 : null;
    const differenceEl = valuesAvailable ? computedEl - horizonsEl : null;
    const status = valuesAvailable && Math.abs(differenceAz) < 0.05 && Math.abs(differenceEl) < 0.05 ? 'OK' : 'Check';
    const time = String(row.t || '—').replace('T', ' ');
    const pair = (azimuth, elevation) => azimuth === null || elevation === null
      ? 'Not available'
      : `${azimuth.toFixed(3)}° / ${elevation.toFixed(3)}°`;
    const difference = valuesAvailable
      ? `Az ${differenceAz >= 0 ? '+' : ''}${differenceAz.toFixed(3)}°; El ${differenceEl >= 0 ? '+' : ''}${differenceEl.toFixed(3)}°`
      : 'Not available';
    return `<tr>
      <td>${escapeHtml(siteName(row.site))}</td><td>${escapeHtml(String(row.target || '—').toUpperCase())}</td>
      <td>${escapeHtml(time === '—' ? time : `${time} UT`)}</td>
      <td>${pair(computedAz, computedEl)}</td><td>${pair(horizonsAz, horizonsEl)}</td>
      <td>${difference}</td><td>${sourceCell(row.source || 'JPL Horizons web interface', row.url)}</td>
      <td><span class="validation-status">${status}</span></td></tr>`;
  }).join('');

  const publishedRows = state.validation.published_context.length
    ? state.validation.published_context
    : (() => {
      const shackleton = state.sites.find((site) => site.id === 'shackleton');
      const terrain = horizonForSite('shackleton');
      const from = $('#start-date')?.value;
      const to = $('#end-date')?.value;
      const samples = shackleton && !terrain.approximate && from && to
        ? samplesForRange('shackleton', from, to)
        : [];
      const computed = samples.length
        ? calculateMetrics(samples, terrain.values, currentSunWeight()).sunPercent
        : null;
      return [{
      site: 'shackleton',
      metric: 'Sun illumination (%)',
      computed,
      reference: 88.0,
      source: 'Gläser et al. (2018), south-polar ridge between Shackleton and de Gerlache; 2 m lander case.',
      url: 'https://ntrs.nasa.gov/citations/20170007365',
      note: 'Indicative context only: the published ridge, terrain model and 2 m observer height differ from this representative point and its DEM-pixel observer height. The DEM vertical unit is also unconfirmed.'
    }];
    })();
  $('#validation-published-body').innerHTML = publishedRows.map((row) => {
    const computed = numericValue(row.computed);
    const reference = numericValue(row.reference);
    return `<tr>
      <td>${escapeHtml(siteName(row.site))}</td><td>${escapeHtml(row.metric || '—')}</td>
      <td>${computed === null ? 'Not available' : computed.toFixed(2)}</td>
      <td>${reference === null ? '—' : reference.toFixed(2)}</td>
      <td>n/a (not comparable)</td><td>${sourceCell(row.source, row.url)}</td>
      <td>${escapeHtml(row.note || 'Not comparable: published terrain and lander assumptions differ.')}</td></tr>`;
  }).join('');
}

function setActiveTab(tabName, focusButton) {
  document.querySelectorAll('.tab-button').forEach((tab) => {
    const active = tab.dataset.tab === tabName;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    if (active && focusButton) tab.focus();
  });
  document.querySelectorAll('.tab-panel').forEach((panel) => { panel.hidden = panel.id !== `panel-${tabName}`; });
  if (tabName === 'analysis' && state.currentMetrics) {
    drawSkyPlot();
    drawTimeline();
  } else if (tabName === 'compare' && state.compareMetrics.length) {
    drawCompareChart(state.compareMetrics);
  }
}

function setupEvents() {
  $('#analyze-button').addEventListener('click', analyze);
  $('#site-select').addEventListener('change', () => {
    updateSiteCoordinateNote();
    if (state.currentMetrics) analyze();
  });
  $('#terrain-toggle').addEventListener('click', () => {
    if (!state.activeTerrainHorizon) return;
    state.useTerrain = !state.useTerrain;
    applyTerrainMode();
  });
  $('#sun-weight').addEventListener('input', () => updateWeights('#sun-weight'));
  $('#earth-weight').addEventListener('input', () => updateWeights('#earth-weight'));
  $('#sky-zoom').addEventListener('change', (event) => {
    state.skyZoom = event.target.checked;
    drawSkyPlot();
  });
  $('#time-slider').addEventListener('input', (event) => selectTime(event.target.value));
  $('#play-button').addEventListener('click', () => {
    if (state.animation) {
      clearInterval(state.animation);
      state.animation = null;
      $('#play-button').textContent = 'Play';
      $('#play-button').setAttribute('aria-label', 'Play time animation');
      return;
    }
    if (!state.activeSamples.length) return;
    $('#play-button').textContent = 'Pause';
    $('#play-button').setAttribute('aria-label', 'Pause time animation');
    state.animation = setInterval(() => selectTime((state.selectedIndex + 1) % state.activeSamples.length), 240);
  });
  $('#time-slider').addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      selectTime(state.selectedIndex + (event.key === 'ArrowRight' ? 1 : -1));
    }
  });
  $('#timeline-canvas').addEventListener('mousemove', (event) => {
    if (!state.timelinePlot || !state.activeSamples.length) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const localX = event.clientX - rect.left;
    const plot = state.timelinePlot;
    if (localX < plot.x || localX > plot.x + plot.width) {
      $('#timeline-tooltip').hidden = true;
      return;
    }
    const index = Math.max(0, Math.min(state.activeSamples.length - 1, Math.floor((localX - plot.x) / plot.step)));
    const status = timelineState(index);
    const tooltip = $('#timeline-tooltip');
    tooltip.textContent = `${formatUtc(state.activeSamples[index].timestamp, true)} · ${status.text}`;
    tooltip.style.left = `${Math.max(0, Math.min(rect.width - 210, localX + 10))}px`;
    tooltip.style.top = '0px';
    tooltip.hidden = false;
  });
  $('#timeline-canvas').addEventListener('mouseleave', () => { $('#timeline-tooltip').hidden = true; });
  $('#timeline-canvas').addEventListener('click', (event) => {
    if (!state.timelinePlot || !state.activeSamples.length) return;
    const x = event.clientX - event.currentTarget.getBoundingClientRect().left;
    const plot = state.timelinePlot;
    if (x >= plot.x && x <= plot.x + plot.width) selectTime(Math.floor((x - plot.x) / plot.step));
  });
  $('#compare-button').addEventListener('click', compareSites);
  document.querySelectorAll('.tab-button').forEach((tab) => {
    tab.addEventListener('click', () => setActiveTab(tab.dataset.tab, false));
    tab.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const tabs = Array.from(document.querySelectorAll('.tab-button'));
      const current = tabs.indexOf(tab);
      const next = event.key === 'Home' ? 0
        : event.key === 'End' ? tabs.length - 1
          : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      setActiveTab(tabs[next].dataset.tab, true);
    });
  });
  window.addEventListener('resize', () => {
    if (state.currentMetrics) {
      drawSkyPlot();
      drawTimeline();
    }
    if (state.compareMetrics.length) drawCompareChart(state.compareMetrics);
  });
}

async function initialize() {
  try {
    await loadData();
    fillSiteControls();
    initializeDates();
    renderValidation();
    setupEvents();
    setHorizonWarning(horizonForSite(state.sites[0].id));
    analyze();
    compareSites();
  } catch (error) {
    $('#app-error').textContent = `The navigator could not start: ${error.message}`;
    $('#app-error').hidden = false;
  }
}

if (typeof document !== 'undefined') initialize();