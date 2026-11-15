import { fromFile } from 'geotiff';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultPath = path.resolve(
  scriptDirectory,
  '..',
  'data_raw',
  'LRO_LOLA_DEM_SPole875_5mp_v04_EQ-subsetted.tif'
);
const demPath = path.resolve(process.argv[2] || defaultPath);

const tiff = await fromFile(demPath);
try {
  const image = await tiff.getImage();
  const width = image.getWidth();
  const height = image.getHeight();
  const [longitudeStep, latitudeStep] = image.getResolution();
  const [west, north] = image.getOrigin();
  const keys = image.getGeoKeys();
  const noDataValue = image.getGDALNoData();
  let minimum = Infinity;
  let maximum = -Infinity;
  let validPixels = 0;
  let noDataPixels = 0;

  for (let rowIndex = 0; rowIndex < height; rowIndex += 1) {
    const rasters = await image.readRasters({
      window: [0, rowIndex, width, rowIndex + 1],
      samples: [0]
    });
    const row = rasters[0];
    for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
      const elevation = row[columnIndex];
      if (!Number.isFinite(elevation) || (noDataValue !== null && elevation === noDataValue)) {
        noDataPixels += 1;
        continue;
      }
      minimum = Math.min(minimum, elevation);
      maximum = Math.max(maximum, elevation);
      validPixels += 1;
    }
  }

  const centerLatitude = north + ((height - 1) / 2) * latitudeStep;
  const lunarRadius = Number(keys.GeogSemiMajorAxisGeoKey);
  const radiansPerDegree = Math.PI / 180;
  const pixelSizeMeters = Number.isFinite(lunarRadius)
    ? {
      northSouth: Math.abs(latitudeStep) * radiansPerDegree * lunarRadius,
      eastWestAtRasterCenter: Math.abs(longitudeStep) * radiansPerDegree * lunarRadius
        * Math.cos(centerLatitude * radiansPerDegree)
    }
    : null;

  console.log(JSON.stringify({
    file: demPath,
    raster: {
      width,
      height,
      bands: image.getSamplesPerPixel(),
      bitsPerSample: image.getBitsPerSample(),
      sampleFormat: image.getSampleFormat(),
      noDataValue
    },
    georeferencing: {
      modelType: keys.GTModelTypeGeoKey,
      rasterType: keys.GTRasterTypeGeoKey,
      angularUnits: keys.GeogAngularUnitsGeoKey,
      citation: keys.GeogCitationGeoKey,
      longitudeLatitudeOrigin: [west, north],
      resolutionDegrees: [longitudeStep, latitudeStep],
      boundingBox: image.getBoundingBox(),
      lunarAxesMeters: [keys.GeogSemiMajorAxisGeoKey, keys.GeogSemiMinorAxisGeoKey],
      estimatedPixelSizeMetersAtRasterCenter: pixelSizeMeters
    },
    elevations: {
      minimum: validPixels ? minimum : null,
      maximum: validPixels ? maximum : null,
      validPixels,
      noDataPixels
    }
  }, null, 2));
} finally {
  await tiff.close();
}
