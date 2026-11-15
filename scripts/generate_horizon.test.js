'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { fromFile } = require('geotiff');
const {
  DEFAULT_DEM,
  LUNAR_RADIUS_M,
  buildSiteProfile,
  insideImage,
  isNoData,
  pixelForCoordinate,
  terrainAngleDegrees,
  validateImage
} = require('./generate_horizon.js');

const ROOT = path.resolve(__dirname, '..');

test('opens the supplied LOLA DEM and validates its projection and raster shape', async () => {
  const tiff = await fromFile(DEFAULT_DEM);
  try {
    const image = await tiff.getImage();
    validateImage(image);
    assert.equal(image.getWidth(), 306097);
    assert.equal(image.getHeight(), 850);
  } finally {
    await tiff.close();
  }
});

test('checks real site coordinates against DEM coverage', async () => {
  const [sites] = await Promise.all([
    fs.readFile(path.join(ROOT, 'data', 'sites.json'), 'utf8').then(JSON.parse)
  ]);
  const tiff = await fromFile(DEFAULT_DEM);
  try {
    const image = await tiff.getImage();
    const byId = Object.fromEntries(sites.map((site) => [site.id, site]));
    for (const id of ['shackleton', 'artemis']) {
      assert.equal(insideImage(pixelForCoordinate(byId[id].lon, byId[id].lat, image), image), true, `${id} should be covered`);
    }
    for (const id of ['malapert', 'haworth', 'nobile']) {
      assert.equal(insideImage(pixelForCoordinate(byId[id].lon, byId[id].lat, image), image), false, `${id} should be outside coverage`);
    }
  } finally {
    await tiff.close();
  }
});

test('generated profiles contain 360 finite angles for every available site', async () => {
  const generated = JSON.parse(await fs.readFile(path.join(ROOT, 'data', 'horizon.json'), 'utf8'));
  assert.equal(generated.metadata.source, 'NASA LOLA DEM');
  for (const profile of Object.values(generated.sites)) {
    if (profile.status !== 'available') continue;
    assert.equal(profile.azimuthStep, 1);
    assert.equal(profile.horizonAngles.length, 360);
    assert.ok(profile.horizonAngles.every(Number.isFinite));
    assert.ok(profile.horizonAngles.every((angle) => angle >= 0));
  }
  assert.equal(generated.sites.shackleton.status, 'available');
  assert.equal(generated.sites.artemis.status, 'available');
});

test('treats NoData and missing pixels as unavailable instead of zero elevation', async () => {
  assert.equal(isNoData(32767, 32767), true);
  assert.equal(isNoData(Number.NaN, 32767), true);
  assert.equal(isNoData(0, 32767), false);
  const image = {
    getOrigin: () => [-180, -88.9],
    getResolution: () => [360, -1],
    getWidth: () => 1,
    getHeight: () => 1,
    readRasters: async () => [Int16Array.from([32767])]
  };
  const profile = await buildSiteProfile(
    { id: 'test', lon: 0, lat: -89 },
    image,
    32767,
    { maxDistanceM: 25, sampleStepM: 25 }
  );
  assert.equal(profile.status, 'unavailable');
  assert.match(profile.reason, /NoData/);
});

test('flat terrain stays near zero and an obstacle raises the horizon angle', async () => {
  const flat = terrainAngleDegrees(1000, 1000, 25);
  const obstacle = terrainAngleDegrees(1000, 1001, 25);
  assert.ok(Math.abs(flat) < 0.001);
  assert.ok(obstacle > flat);
  const knownHillAngle = terrainAngleDegrees(0, 100, 1000);
  assert.ok(Math.abs(knownHillAngle - 5.6943) < 0.001, `expected about 5.6943°, got ${knownHillAngle}°`);
  assert.ok(LUNAR_RADIUS_M > 1700000);

  const image = {
    getOrigin: () => [-0.1, 0.1],
    getResolution: () => [0.0001, -0.0001],
    getWidth: () => 2001,
    getHeight: () => 2001,
    readRasters: async ({ window }) => {
      const width = window[2] - window[0];
      return [new Int16Array(width).fill(100)];
    }
  };
  const profile = await buildSiteProfile(
    { id: 'flat', lon: 0, lat: 0 },
    image,
    null,
    { maxDistanceM: 250, sampleStepM: 25 }
  );
  assert.equal(profile.status, 'available');
  assert.equal(profile.horizonAngles.length, 360);
  assert.ok(profile.horizonAngles.every((angle) => Math.abs(angle) < 0.001));
});

test('the browser calculation uses the documented flat fallback without LOLA data', async () => {
  const app = await fs.readFile(path.join(ROOT, 'app.js'), 'utf8');
  const context = vm.createContext({});
  vm.runInContext(app, context, { filename: 'app.js' });
  const horizon = vm.runInContext('horizonForSite("missing-site")', context);
  assert.equal(horizon.approximate, true);
  assert.equal(horizon.values.length, 360);
  assert.ok(horizon.values.every((value) => value === 0));
  const active = vm.runInContext(`
    state.horizons = { sites: { test: { status: 'available', horizonAngles: Array(360).fill(2) } } };
    horizonForSite('test')
  `, context);
  assert.equal(active.approximate, false);
  assert.equal(active.values[0], 2);
  const legacy = vm.runInContext(`
    state.horizons = { test: Array(360).fill(3) };
    horizonForSite('test')
  `, context);
  assert.equal(legacy.approximate, false);
  assert.equal(legacy.values[0], 3);
});

test('terrain profiles change visibility metrics while flat fallback remains an upper bound', async () => {
  const [app, sites, ephemeris, horizons] = await Promise.all([
    fs.readFile(path.join(ROOT, 'app.js'), 'utf8'),
    fs.readFile(path.join(ROOT, 'data', 'sites.json'), 'utf8'),
    fs.readFile(path.join(ROOT, 'data', 'ephemeris.json'), 'utf8'),
    fs.readFile(path.join(ROOT, 'data', 'horizon.json'), 'utf8')
  ]);
  const context = vm.createContext({});
  vm.runInContext(app, context, { filename: 'app.js' });
  const metrics = vm.runInContext(`
    state.sites = ${sites};
    state.ephemeris = ${ephemeris};
    state.horizons = ${horizons};
    const samples = samplesForRange('shackleton', '2026-11-15', '2026-12-14');
    const flat = calculateMetrics(samples, Array(360).fill(0), 0.6);
    const terrain = calculateMetrics(samples, horizonForSite('shackleton').values, 0.6);
    ({ flatSun: flat.sunPercent, terrainSun: terrain.sunPercent,
      flatEarth: flat.earthPercent, terrainEarth: terrain.earthPercent })
  `, context);
  assert.equal(metrics.flatSun, 100);
  assert.equal(metrics.flatEarth, 42.5);
  assert.ok(metrics.terrainSun < metrics.flatSun);
  assert.ok(metrics.terrainEarth <= metrics.flatEarth);
});

test('plain-language verdict reports visibility without claiming power or link quality', async () => {
  const app = await fs.readFile(path.join(ROOT, 'app.js'), 'utf8');
  const context = vm.createContext({});
  vm.runInContext(app, context, { filename: 'app.js' });
  const verdict = vm.runInContext(
    `verdictForMetrics({ sunPercent: 34.3, earthPercent: 0 })`,
    context
  );
  assert.equal(verdict, 'Verdict: limited Sun visibility; no direct Earth visibility in this period.');
});
