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
- `validation.json` (optional): an object with `horizons_check` and `published_context` arrays. Horizons rows contain `site`, `target`, `t`, computed and Horizons azimuth/elevation, and source fields. Published-context rows contain `site`, `metric`, `computed`, `reference`, `source`, and `note`.

When sites or ephemeris data are unavailable, the app uses clearly identified illustrative sample data. The Validation tab has three sections: a Horizons data check, published context, and limits. If no published-context rows are provided, it shows the built-in Gläser et al. (2018) reference and labels it not comparable.

## Method

Sun and Earth azimuth and elevation were retrieved from the NASA JPL Horizons API for each site using the Moon as the observer, airless settings, UT, and hourly steps from 15 Nov 2026 to 15 Feb 2027. The results are stored as static JSON; the deployed site does not call Horizons. A target is visible when its elevation is above the horizon elevation at its azimuth. With no terrain profile, the horizon is flat at 0°. Visibility percentages count visible hourly samples; darkness, communication outage, and blackout durations are derived from consecutive hourly states.

## Score

Score = w_Sun × Sun visible % + w_Earth × Earth visible %, with default weights of 60% Sun and 40% Earth. Sun receives the slightly higher default weight because without power a spacecraft can neither operate nor communicate. The weights can be adjusted in the interface and are a planning preference, not an empirically calibrated value.

## Validation

`data/validation.json` stores four ephemeris samples alongside fresh NASA JPL Horizons API results in `horizons_check`; the stored and queried azimuth/elevation values differ by less than 0.001° at all four checked times. `published_context` is reserved for literature references and is not a like-for-like comparison. The built-in 88.0% Gläser et al. (2018) value is for a south-polar ridge between Shackleton and de Gerlache with a 2 m lander. It uses terrain and a different site and period, so no numerical difference is presented. These checks verify ephemeris retrieval and parsing, not the terrain model.

## Limitations

- The horizon is flat when no terrain profile is supplied, so Sun visibility is an upper bound.
- The Sun is treated as a point source.
- Hourly sampling can miss events shorter than one hour.
- The five available sites are representative points, not official landing sites.
- Site altitude is set to 0 km above the reference ellipsoid; this is not local terrain elevation.

## Coordinate and altitude cautions

The Gazetteer of Planetary Nomenclature gives these feature centers in the Moon's planetographic, east-positive system:

- [Haworth crater](https://planetarynames.wr.usgs.gov/Feature/14502): 87.45° S, 5.17° W (`lat: -87.45`, `lon: -5.17`).
- [Nobile crater](https://planetarynames.wr.usgs.gov/Feature/4321): 85.28° S, 53.27° E (`lat: -85.28`, `lon: 53.27`).
- [Shackleton crater](https://planetarynames.wr.usgs.gov/Feature/5450): the Gazetteer gives a feature center of 89.67° S, 129.78° E and separately lists a point at 89.90° S, 0.00° E. The data file uses the latter as a representative point, not the Gazetteer center or an official landing coordinate.

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

## Developer notes

For a short test run, temporarily set `STOP_TIME` to `2026-11-18`, then restore it to `2027-02-15` before generating the full interval. Around the pole, unexpectedly large Sun elevations (for example, tens of degrees) are a reason to recheck the coordinates and observer settings.

## Included features

- Analysis with date selection, normalized Sun/Earth weights, visibility metrics, polar sky plot, hourly timeline, and animation.
- Ranked site comparison and two-window comparison for one site.
- Three-part Validation page and an About page with method, assumptions, limits, and data credits.
- Responsive dark theme, keyboard-operable controls, and text labels alongside timeline colors.

Ephemerides are sourced from NASA JPL Horizons (DE440/DE441), and the IAU Gazetteer is used for site context. The app does not use LOLA, Moon Trek, or LROC Quickmap data, and includes no NASA logos or copied map imagery.
