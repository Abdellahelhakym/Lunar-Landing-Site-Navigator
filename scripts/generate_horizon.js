'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { fromFile } = require('geotiff');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_DEM = path.join(ROOT, 'data_raw', 'LRO_LOLA_DEM_SPole875_5mp_v04_EQ-subsetted.tif');
const DEFAULT_SITES = path.join(ROOT, 'data', 'sites.json');
const DEFAULT_OUTPUT = path.join(ROOT, 'data', 'horizon.json');
const LUNAR_RADIUS_M = 1737400;
const DEFAULT_MAX_DISTANCE_M = 3000;
const DEFAULT_SAMPLE_STEP_M = 25;

function assertPositiveFinite(value, name) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive finite number.`);
}

function parseOptions(args) {
  const options = {
    demPath: DEFAULT_DEM,
    sitesPath: DEFAULT_SITES,
    outputPath: DEFAULT_OUTPUT,
    maxDistanceM: DEFAULT_MAX_DISTANCE_M,
    sampleStepM: DEFAULT_SAMPLE_STEP_M
  };
  const names = new Map([
    ['--dem', 'demPath'],
    ['--sites', 'sitesPath'],
    ['--output', 'outputPath'],
    ['--max-distance-m', 'maxDistanceM'],
    ['--sample-step-m', 'sampleStepM']
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const key = names.get(args[index]);
    if (!key || index + 1 >= args.length) throw new Error(`Unknown or incomplete option: ${args[index]}`);
    const value = args[index + 1];
    options[key] = key.endsWith('M') ? Number(value) : path.resolve(value);
    index += 1;
  }
  assertPositiveFinite(options.maxDistanceM, '--max-distance-m');
  assertPositiveFinite(options.sampleStepM, '--sample-step-m');
  if (options.sampleStepM > options.maxDistanceM) throw new Error('--sample-step-m cannot exceed --max-distance-m.');
  return options;
}

function getNoDataValue(image) {
  const raw = image.getGDALNoData();
  if (raw === undefined || raw === null || raw === '') return null;
  const value = Number(raw);
  return Number.isNaN(value) ? null : value;
}

function isNoData(value, noDataValue) {
  return !Number.isFinite(value) || (noDataValue !== null && value === noDataValue);
}

function normalizeLongitude(longitude) {
  return ((longitude + 180) % 360 + 360) % 360 - 180;
}

function pixelForCoordinate(longitude, latitude, image) {
  const [west, north] = image.getOrigin();
  const [longitudeStep, latitudeStep] = image.getResolution();
  const x = Math.floor((normalizeLongitude(longitude) - west) / longitudeStep);
  const y = Math.floor((latitude - north) / latitudeStep);
  return { x, y };
}

function insideImage(pixel, image) {
  return pixel.x >= 0 && pixel.y >= 0 && pixel.x < image.getWidth() && pixel.y < image.getHeight();
}

function destination(longitudeDeg, latitudeDeg, azimuthDeg, distanceM) {
  const angularDistance = distanceM / LUNAR_RADIUS_M;
  const latitude = latitudeDeg * Math.PI / 180;
  const longitude = longitudeDeg * Math.PI / 180;
  const bearing = azimuthDeg * Math.PI / 180;
  const destinationLatitude = Math.asin(
    Math.sin(latitude) * Math.cos(angularDistance)
      + Math.cos(latitude) * Math.sin(angularDistance) * Math.cos(bearing)
  );
  const destinationLongitude = longitude + Math.atan2(
    Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latitude),
    Math.cos(angularDistance) - Math.sin(latitude) * Math.sin(destinationLatitude)
  );
  return {
    longitude: normalizeLongitude(destinationLongitude * 180 / Math.PI),
    latitude: destinationLatitude * 180 / Math.PI
  };
}

function pixelCenterFor(pixel, image) {
  const [west, north] = image.getOrigin();
  const [longitudeStep, latitudeStep] = image.getResolution();
  return {
    longitude: normalizeLongitude(west + (pixel.x + 0.5) * longitudeStep),
    latitude: north + (pixel.y + 0.5) * latitudeStep
  };
}

function distanceAndBearing(fromLongitude, fromLatitude, toLongitude, toLatitude) {
  const fromLat = fromLatitude * Math.PI / 180;
  const toLat = toLatitude * Math.PI / 180;
  const deltaLongitude = (toLongitude - fromLongitude) * Math.PI / 180;
  const y = Math.cos(fromLat) * Math.sin(toLat)
    - Math.sin(fromLat) * Math.cos(toLat) * Math.cos(deltaLongitude);
  const x = Math.cos(toLat) * Math.sin(deltaLongitude);
  const centralAngle = Math.atan2(
    Math.sqrt(x * x + y * y),
    Math.sin(fromLat) * Math.sin(toLat) + Math.cos(fromLat) * Math.cos(toLat) * Math.cos(deltaLongitude)
  );
  return {
    distance: centralAngle * LUNAR_RADIUS_M,
    bearing: (Math.atan2(x, y) * 180 / Math.PI + 360) % 360
  };
}

function terrainAngleDegrees(observerElevationM, targetElevationM, surfaceDistanceM) {
  if (surfaceDistanceM <= 0) throw new Error('Terrain samples must have a positive distance from the observer.');
  const angle = surfaceDistanceM / LUNAR_RADIUS_M;
  const targetRadius = LUNAR_RADIUS_M + targetElevationM;
  const observerRadius = LUNAR_RADIUS_M + observerElevationM;
  const horizontal = targetRadius * Math.sin(angle);
  const vertical = targetRadius * Math.cos(angle) - observerRadius;
  return Math.atan2(vertical, horizontal) * 180 / Math.PI;
}

function validateImage(image) {
  const keys = image.getGeoKeys();
  const [longitudeStep, latitudeStep] = image.getResolution();
  if (keys.GeogAngularUnitsGeoKey !== 9102 || keys.GeogSemiMajorAxisGeoKey !== LUNAR_RADIUS_M
      || keys.GeogSemiMinorAxisGeoKey !== LUNAR_RADIUS_M) {
    throw new Error('The DEM CRS is not the expected geographic lunar sphere in degrees.');
  }
  if (!Number.isFinite(longitudeStep) || !Number.isFinite(latitudeStep) || longitudeStep === 0 || latitudeStep === 0) {
    throw new Error('The DEM has invalid geographic pixel resolution.');
  }
  if (image.getSamplesPerPixel() !== 1) throw new Error('The DEM must contain exactly one elevation band.');
  if (image.getBitsPerSample() !== 16 || image.getSampleFormat() !== 2) {
    throw new Error('The DEM is not a signed 16-bit raster as expected.');
  }
}

function unavailableSite(reason) {
  return { status: 'unavailable', reason };
}

async function buildSiteProfile(site, image, noDataValue, options) {
  const sitePixel = pixelForCoordinate(site.lon, site.lat, image);
  if (!insideImage(sitePixel, image)) {
    return unavailableSite('Site coordinate is outside the LOLA DEM coverage.');
  }

  const row = await image.readRasters({
    window: [sitePixel.x, sitePixel.y, sitePixel.x + 1, sitePixel.y + 1],
    samples: [0]
  });
  const siteElevation = row[0][0];
  if (isNoData(siteElevation, noDataValue)) {
    return unavailableSite('The site coordinate falls on a LOLA NoData pixel.');
  }

  const pointsByRow = new Map();
  let outOfCoverageSamples = 0;
  for (let azimuth = 0; azimuth < 360; azimuth += 1) {
    for (let distance = options.sampleStepM; distance <= options.maxDistanceM; distance += options.sampleStepM) {
      const location = destination(site.lon, site.lat, azimuth, distance);
      const pixel = pixelForCoordinate(location.longitude, location.latitude, image);
      if (!insideImage(pixel, image)) {
        outOfCoverageSamples += 1;
        continue;
      }
      if (pixel.x === sitePixel.x && pixel.y === sitePixel.y) continue;
      const center = pixelCenterFor(pixel, image);
      const relative = distanceAndBearing(site.lon, site.lat, center.longitude, center.latitude);
      if (relative.distance > options.maxDistanceM || relative.distance === 0) continue;
      if (!pointsByRow.has(pixel.y)) pointsByRow.set(pixel.y, []);
      pointsByRow.get(pixel.y).push({
        azimuth: Math.round(relative.bearing) % 360,
        distance: relative.distance,
        x: pixel.x
      });
    }
  }

  if (outOfCoverageSamples) {
    return unavailableSite(`${outOfCoverageSamples} terrain samples fall outside the DEM coverage; reduce the analysis distance.`);
  }

  const horizonAngles = Array(360).fill(0);
  const sampleCounts = Array(360).fill(0);
  let noDataSamples = 0;
  const sortedRows = [...pointsByRow.keys()].sort((a, b) => a - b);
  for (const y of sortedRows) {
    const raster = await image.readRasters({
      window: [0, y, image.getWidth(), y + 1],
      samples: [0]
    });
    const values = raster[0];
    for (const point of pointsByRow.get(y)) {
      const elevation = values[point.x];
      if (isNoData(elevation, noDataValue)) {
        noDataSamples += 1;
        continue;
      }
      sampleCounts[point.azimuth] += 1;
      const angle = terrainAngleDegrees(siteElevation, elevation, point.distance);
      if (angle > horizonAngles[point.azimuth]) horizonAngles[point.azimuth] = angle;
    }
  }

  if (noDataSamples) {
    return unavailableSite(`${noDataSamples} terrain samples contain NoData; an incomplete profile is not used.`);
  }
  if (sampleCounts.some((count) => count === 0)
      || horizonAngles.some((angle) => !Number.isFinite(angle) || angle < 0)) {
    return unavailableSite('One or more azimuth directions have no valid terrain samples.');
  }

  return {
    status: 'available',
    azimuthStep: 1,
    horizonAngles,
    observerElevation: siteElevation,
    maxDistanceM: options.maxDistanceM,
    sampleStepM: options.sampleStepM
  };
}

async function generateHorizon({ demPath = DEFAULT_DEM, sitesPath = DEFAULT_SITES, maxDistanceM = DEFAULT_MAX_DISTANCE_M, sampleStepM = DEFAULT_SAMPLE_STEP_M } = {}) {
  assertPositiveFinite(maxDistanceM, 'maxDistanceM');
  assertPositiveFinite(sampleStepM, 'sampleStepM');
  if (sampleStepM > maxDistanceM) throw new Error('sampleStepM cannot exceed maxDistanceM.');
  const sites = JSON.parse(await fs.readFile(sitesPath, 'utf8'));
  if (!Array.isArray(sites)) throw new Error('The sites file must contain a JSON array.');

  let fileHandle;
  try {
    fileHandle = await fs.open(demPath, 'r');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return {
      metadata: {
        source: 'NASA LOLA DEM',
        method: 'Terrain-based geometric horizon calculation',
        status: 'unavailable',
        reason: `DEM file not found: ${demPath}`
      },
      sites: Object.fromEntries(sites.map((site) => [site.id, unavailableSite('LOLA DEM file is unavailable.')]))
    };
  }
  await fileHandle.close();

  const tiff = await fromFile(demPath);
  try {
    const image = await tiff.getImage();
    validateImage(image);
    const noDataValue = getNoDataValue(image);
    const outputSites = {};
    for (const site of sites) {
      if (!site || typeof site.id !== 'string' || !Number.isFinite(site.lon) || !Number.isFinite(site.lat)) {
        throw new Error('Each site must have a string id and finite lon/lat coordinates.');
      }
      outputSites[site.id] = await buildSiteProfile(site, image, noDataValue, { maxDistanceM, sampleStepM });
    }
    return {
      metadata: {
        source: 'NASA LOLA DEM',
        method: 'Terrain-based geometric horizon calculation',
        lunarRadiusM: LUNAR_RADIUS_M,
        elevationUnits: 'meters (LOLA DEM product convention; not encoded in this GeoTIFF)',
        maxDistanceM,
        sampleStepM,
        demWidth: image.getWidth(),
        demHeight: image.getHeight(),
        noDataValue,
        assumptions: [
          'Spherical Moon with radius from the DEM GeoKeys; elevation values are treated as meters above that sphere.',
          '360 one-degree azimuth rays use nearest DEM pixel centers at fixed surface-distance steps.',
          'The zero-degree local tangent horizon is retained as a minimum; terrain can raise, but not lower, it.',
          'A profile is unavailable if any requested sample is outside coverage or has NoData.'
        ]
      },
      sites: outputSites
    };
  } finally {
    await tiff.close();
  }
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const result = await generateHorizon(options);
  await fs.writeFile(options.outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  for (const [siteId, profile] of Object.entries(result.sites)) {
    console.log(`${siteId}: ${profile.status}${profile.reason ? ` — ${profile.reason}` : ''}`);
  }
  if (result.metadata.status === 'unavailable') {
    console.error(result.metadata.reason);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Horizon generation failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_DEM,
  DEFAULT_MAX_DISTANCE_M,
  DEFAULT_SAMPLE_STEP_M,
  LUNAR_RADIUS_M,
  buildSiteProfile,
  destination,
  distanceAndBearing,
  generateHorizon,
  getNoDataValue,
  insideImage,
  isNoData,
  parseOptions,
  pixelCenterFor,
  pixelForCoordinate,
  terrainAngleDegrees,
  validateImage
};
