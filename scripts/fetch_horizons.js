// Developed with AI assistance (Claude). Idea and design by the team. Data source: NASA JPL Horizons API (https://ssd.jpl.nasa.gov/api/horizons.api), DE440/DE441 ephemerides.
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const START_TIME = '2026-11-15';
const STOP_TIME = '2027-02-15';
const STEP_SIZE = '1 h';
const MAX_RETRIES = 3;
const MAX_ATTEMPTS = MAX_RETRIES + 1;
const API_URL = 'https://ssd.jpl.nasa.gov/api/horizons.api';
const DATA_DIR = path.resolve(__dirname, '..', 'data');
const SITES_FILE = path.join(DATA_DIR, 'sites.json');
const OUTPUT_FILE = path.join(DATA_DIR, 'ephemeris.json');
const BACKUP_FILE = path.join(DATA_DIR, 'ephemeris.backup.json');
const TARGETS = [
  { key: 'sun', command: '10', label: 'sun' },
  { key: 'earth', command: '399', label: 'earth' }
];
const MONTHS = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
};

let lastRequestAt = 0;

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function roundToThree(value) {
  const rounded = Math.round((Math.abs(value) + Number.EPSILON) * 1000) / 1000;
  return value < 0 ? -rounded : rounded;
}

function buildUrl(site, target) {
  const parameters = new URLSearchParams({
    format: 'json',
    COMMAND: `'${target.command}'`,
    OBJ_DATA: 'NO',
    MAKE_EPHEM: 'YES',
    EPHEM_TYPE: 'OBSERVER',
    CENTER: 'coord@301',
    COORD_TYPE: 'GEODETIC',
    SITE_COORD: `${site.lon},${site.lat},${site.alt_km}`,
    START_TIME,
    STOP_TIME,
    STEP_SIZE,
    QUANTITIES: '4',
    ANG_FORMAT: 'DEG',
    APPARENT: 'AIRLESS',
    TIME_TYPE: 'UT',
    CAL_FORMAT: 'CAL',
    CSV_FORMAT: 'YES'
  });
  return `${API_URL}?${parameters.toString().replace(/\+/g, '%20')}`;
}

function errorPreview(payload) {
  if (typeof payload?.result === 'string') return payload.result.slice(0, 500);
  return JSON.stringify(payload).slice(0, 500);
}

function formatHorizonsDate(value, siteId, target) {
  const match = value.trim().match(/^(\d{4})-([A-Za-z]{3})-(\d{1,2})\s+(\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?$/);
  if (!match) {
    throw new Error(`${siteId} / ${target}: unrecognized UT date "${value.trim()}".`);
  }
  const month = MONTHS[match[2].toLowerCase()];
  if (!month) throw new Error(`${siteId} / ${target}: unrecognized month in date "${value.trim()}".`);
  return `${match[1]}-${month}-${match[3].padStart(2, '0')}T${match[4]}`;
}

function parseResult(payload, siteId, target) {
  const result = typeof payload?.result === 'string' ? payload.result : '';
  if (payload?.error || !result.includes('$$SOE')) {
    throw new Error(`${siteId} / ${target}: Horizons response is missing ephemeris data. Response: ${errorPreview(payload)}`);
  }

  const version = payload?.signature?.version;
  if (version !== '1.3' && version !== '1.0') {
    console.warn(`${siteId} / ${target}: unexpected Horizons API signature version "${version ?? 'missing'}".`);
  }

  const startMarker = result.indexOf('$$SOE');
  const endMarker = result.indexOf('$$EOE', startMarker + 5);
  if (endMarker < 0) {
    throw new Error(`${siteId} / ${target}: Horizons response is missing $$EOE. Response: ${errorPreview(payload)}`);
  }

  const headerLines = result.slice(0, startMarker).trimEnd().split(/\r?\n/);
  const headerLine = [...headerLines].reverse().find((line) => {
    const lower = line.toLowerCase();
    return lower.includes('date__(ut)') && lower.includes('azi') && lower.includes('elev');
  });
  if (!headerLine) {
    throw new Error(`${siteId} / ${target}: could not find the CSV date, azimuth, and elevation headers. Response: ${errorPreview(payload)}`);
  }

  const headers = headerLine.split(',').map((item) => item.trim().replace(/^"|"$/g, '').toLowerCase());
  const azimuthIndex = headers.findIndex((header) => header.includes('azi'));
  const elevationIndex = headers.findIndex((header) => header.includes('elev'));
  const dateIndex = headers.findIndex((header) => header.includes('date__(ut)'));
  if (dateIndex < 0 || azimuthIndex < 0 || elevationIndex < 0) {
    throw new Error(`${siteId} / ${target}: required CSV columns are missing. Response: ${errorPreview(payload)}`);
  }

  const rows = result.slice(startMarker + 5, endMarker).split(/\r?\n/);
  const samples = [];
  let skipped = 0;
  rows.forEach((line) => {
    if (!line.trim()) return;
    const columns = line.split(',').map((item) => item.trim().replace(/^"|"$/g, ''));
    const azimuth = Number.parseFloat(columns[azimuthIndex]);
    const elevation = Number.parseFloat(columns[elevationIndex]);
    if (!Number.isFinite(azimuth) || !Number.isFinite(elevation) || !columns[dateIndex]) {
      skipped += 1;
      return;
    }
    samples.push({
      t: formatHorizonsDate(columns[dateIndex], siteId, target),
      az: roundToThree(azimuth),
      el: roundToThree(elevation)
    });
  });

  if (skipped) console.warn(`${siteId} / ${target}: skipped ${skipped} row(s) with missing azimuth or elevation.`);
  if (!samples.length) {
    throw new Error(`${siteId} / ${target}: no valid ephemeris rows were found. Response: ${errorPreview(payload)}`);
  }
  return samples;
}

async function waitForRequestSlot() {
  if (!lastRequestAt) return;
  const elapsed = Date.now() - lastRequestAt;
  if (elapsed < 1000) await wait(1000 - elapsed);
}

async function fetchTarget(site, target) {
  const url = buildUrl(site, target);
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    await waitForRequestSlot();
    lastRequestAt = Date.now();

    let response;
    try {
      response = await fetch(url, { headers: { Accept: 'application/json' } });
    } catch (error) {
      if (attempt === MAX_ATTEMPTS) {
        throw new Error(`${site.id} / ${target.label}: network request failed after ${attempt} attempts: ${error.message}`);
      }
      const delay = 1000 * attempt;
      console.warn(`${site.id} / ${target.label}: network error on attempt ${attempt}; retrying in ${delay / 1000}s.`);
      await wait(delay);
      continue;
    }

    if (!response.ok) {
      const responseText = (await response.text()).slice(0, 500);
      const failure = `${site.id} / ${target.label}: HTTP ${response.status} ${response.statusText}. ${responseText}`;
      if ((response.status === 500 || response.status === 503) && attempt < MAX_ATTEMPTS) {
        const delay = 1000 * attempt;
        console.warn(`${failure} Retrying in ${delay / 1000}s.`);
        await wait(delay);
        continue;
      }
      throw new Error(`${failure}${attempt > 1 ? ` Failed after ${attempt} attempts.` : ''}`);
    }

    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      throw new Error(`${site.id} / ${target.label}: response was not valid JSON: ${error.message}`);
    }
    return parseResult(payload, site.id, target.label);
  }
  throw new Error(`${site.id} / ${target.label}: request failed after retries.`);
}

function summarizeSite(siteData) {
  const points = Math.min(siteData.sun.length, siteData.earth.length);
  const sunVisible = siteData.sun.filter((sample) => sample.el > 0).length;
  const earthVisible = siteData.earth.filter((sample) => sample.el > 0).length;
  return {
    site: siteData.name,
    points,
    sunVisible: `${((sunVisible / siteData.sun.length) * 100).toFixed(1)}%`,
    earthVisible: `${((earthVisible / siteData.earth.length) * 100).toFixed(1)}%`
  };
}

async function saveOutput(data) {
  const serialized = `${JSON.stringify(data, null, 2)}\n`;
  const temporaryFile = `${OUTPUT_FILE}.${process.pid}.tmp`;
  let previousOutput;
  try {
    previousOutput = await fs.readFile(OUTPUT_FILE);
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`Could not read existing ephemeris for backup: ${error.message}`);
  }

  if (previousOutput) {
    await fs.writeFile(BACKUP_FILE, previousOutput);
  } else {
    await fs.writeFile(BACKUP_FILE, serialized, 'utf8');
  }
  await fs.writeFile(temporaryFile, serialized, 'utf8');
  try {
    await fs.rename(temporaryFile, OUTPUT_FILE);
  } catch (error) {
    await fs.rm(temporaryFile, { force: true });
    throw new Error(`Could not replace ${OUTPUT_FILE}: ${error.message}`);
  }
}

async function main() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  let sites;
  try {
    sites = JSON.parse(await fs.readFile(SITES_FILE, 'utf8'));
  } catch (error) {
    throw new Error(`Could not read ${SITES_FILE}: ${error.message}. Create data/sites.json with site records first.`);
  }
  if (!Array.isArray(sites) || sites.length === 0) {
    throw new Error(`${SITES_FILE} must contain a non-empty array of landing sites.`);
  }
  sites.forEach((site, index) => {
    if (!site || !site.id || !Number.isFinite(Number(site.lon)) ||
        !Number.isFinite(Number(site.lat)) || !Number.isFinite(Number(site.alt_km))) {
      throw new Error(`Invalid site at data/sites.json index ${index}: id, lon, lat, and alt_km are required numeric values.`);
    }
  });

  const totalRequests = sites.length * TARGETS.length;
  let completedRequests = 0;
  const failedSites = [];
  const outputSites = {};

  for (const site of sites) {
    const siteData = { name: site.name || site.id };
    const siteErrors = [];
    for (const target of TARGETS) {
      try {
        siteData[target.key] = await fetchTarget(site, target);
        completedRequests += 1;
        console.log(`[${completedRequests}/${totalRequests}] ${site.id} / ${target.label}: ${siteData[target.key].length} points OK`);
      } catch (error) {
        completedRequests += 1;
        siteErrors.push(error.message);
        console.error(`[${completedRequests}/${totalRequests}] ${site.id} / ${target.label}: FAILED — ${error.message}`);
      }
    }
    if (siteErrors.length) {
      failedSites.push({ site: site.id, errors: siteErrors });
    } else {
      outputSites[site.id] = { sun: siteData.sun, earth: siteData.earth };
    }
  }

  if (!Object.keys(outputSites).length) {
    throw new Error('No sites completed both Sun and Earth requests. No ephemeris file was written.');
  }

  const output = {
    meta: {
      source: 'NASA JPL Horizons API',
      timescale: 'UT',
      step: STEP_SIZE,
      start: START_TIME,
      stop: STOP_TIME,
      refraction: 'none (airless)',
      generated: new Date().toISOString()
    },
    sites: outputSites
  };

  await saveOutput(output);
  console.log(`\nSaved ${OUTPUT_FILE}`);
  console.log(`Backup: ${BACKUP_FILE}`);
  console.log('\nFlat-horizon quick check (elevation > 0°):');
  console.table(sites
    .filter((site) => outputSites[site.id])
    .map((site) => summarizeSite({ name: site.name || site.id, ...outputSites[site.id] })));

  if (failedSites.length) {
    console.error('\nSites that failed:');
    failedSites.forEach(({ site, errors }) => {
      console.error(`- ${site}: ${errors.join(' | ')}`);
    });
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`Horizons fetch failed: ${error.message}`);
  process.exitCode = 1;
});
