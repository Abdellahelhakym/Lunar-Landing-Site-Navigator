<!-- Developed with AI assistance (Claude). Idea and design by the team. -->
# Lunar Landing Site Navigator

Developed with AI assistance (Claude). Idea and design by the team.

A static, front-end-only decision-support app for comparing lunar south-pole landing sites by solar illumination and Earth visibility. It uses HTML, CSS, vanilla JavaScript, and canvas; there is no build step or runtime server.

## Run locally

Because the app loads JSON with `fetch`, open it through a local static HTTP server rather than directly as a `file://` URL. For example, use the VS Code Live Server extension and open this project’s root `index.html`. The same static files can be deployed to GitHub Pages.

## Data files

Place data files under `data/` beside `index.html`:

- `sites.json`: array of `{ "id", "name", "lon", "lat", "alt_km" }` site records. Longitude is positive east (`-5.17` is 5.17° west). Optional `coordinate_note` text is shown beside the selected site.
- `ephemeris.json`: generated object with a `sites` map keyed by site ID, containing hourly `sun` and `earth` samples with `t`, `az`, and `el`. The app also accepts the earlier root-level site-map format.
- `horizon.json` (optional): object keyed by site ID, each value a 360-element horizon-elevation array. Missing terrain data triggers the visible flat-horizon warning.
- `validation.json` (optional): array of `{ "site", "metric", "computed", "published", "source" }` comparisons.

When sites or ephemeris data are unavailable, the app uses clearly identified illustrative sample data. The Validation tab includes a published context benchmark from Gläser et al. (2018); its different site geometry and study period are disclosed in the interface. Add matched, mission-specific values in `validation.json` for an actual like-for-like validation.

## Coordinate and altitude cautions

The Gazetteer of Planetary Nomenclature gives these feature centers in the Moon's planetographic, east-positive system:

- [Haworth crater](https://planetarynames.wr.usgs.gov/Feature/14502): 87.45° S, 5.17° W (`lat: -87.45`, `lon: -5.17`).
- [Nobile crater](https://planetarynames.wr.usgs.gov/Feature/4321): 85.28° S, 53.27° E (`lat: -85.28`, `lon: 53.27`).
- [Shackleton crater](https://planetarynames.wr.usgs.gov/Feature/5450): center 89.67° S, 129.78° E. The data file instead uses an approximate rim-area point that falls within the Gazetteer's feature bounds; it is not a surveyed landing-site coordinate.

NASA's [Artemis III candidate-region announcement](https://www.nasa.gov/news-release/nasa-identifies-candidate-regions-for-landing-next-americans-on-moon/) names Peak Near Shackleton and Malapert Massif, but does not publish one exact landing-site coordinate for either region. Their entries here are representative points only, not NASA-provided site coordinates. Replace these proxies with mission-approved coordinates before treating the output as site-specific.

`alt_km: 0` is a simplifying height of zero above the reference ellipsoid; it is not the local terrain elevation. Actual surface elevation and horizon obstruction require a terrain/DEM model. The current zero-altitude values must not be interpreted as measured landing-pad elevations.

## Generate ephemeris data

With Node.js 18 or newer and valid site records in `data/sites.json`, run:

```text
node scripts/fetch_horizons.js
```

The script queries NASA JPL Horizons for each site's Sun and Earth azimuth/elevation at hourly UT intervals, writes `data/ephemeris.json`, and preserves the prior result as `data/ephemeris.backup.json`. It retries transient request errors and reports sites that could not be completed. The website itself remains static and does not call Horizons. Review and replace the explicitly labeled approximate site coordinates before generating data for operational use.

After a run, check that:

1. The output contains `meta` and a `sites` object with both `sun` and `earth` samples for each completed site.
2. Sample timestamps are hourly UT values within the configured start and stop dates, and azimuth/elevation values are numeric.
3. The summary table's point counts and above-horizon percentages are plausible for each location; inspect failed-site messages before using the data.

For a first run, temporarily set `STOP_TIME` to `2026-11-18`, run the command, and inspect the short-window output and polar Sun elevations. Then restore `STOP_TIME` to `2027-02-15` before generating the full interval. Around the pole, unexpectedly large Sun elevations (for example, tens of degrees) are a reason to recheck the coordinates and observer settings.

## Included features

- Analysis with date selection, normalized Sun/Earth weights, visibility metrics, polar sky plot, hourly timeline, and animation.
- Ranked site comparison and two-window comparison for one site.
- Validation table and an About page with assumptions, limits, and data credits.
- Responsive dark theme, keyboard-operable controls, and text labels alongside timeline colors.

Reference credits include NASA JPL Horizons (DE440/DE441), LOLA, Moon Trek, and LROC Quickmap. The app does not include NASA logos or copied map imagery.
