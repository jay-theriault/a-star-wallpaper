import { execSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BOUNDS } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const OUTPUT_DIR = resolve(repoRoot, 'data', 'osm');
const OUTPUT_PATH = resolve(OUTPUT_DIR, 'land-polygons.geojson');

// Clip margin around BOUNDS so land polygons extend slightly beyond the viewport.
const MARGIN = 0.2;
const west = (BOUNDS.west - MARGIN).toFixed(4);
const south = (BOUNDS.south - MARGIN).toFixed(4);
const east = (BOUNDS.east + MARGIN).toFixed(4);
const north = (BOUNDS.north + MARGIN).toFixed(4);

const SHAPEFILE_URL = 'https://osmdata.openstreetmap.de/download/land-polygons-split-4326.zip';
const VSICURL_PATH = `/vsizip//vsicurl/${SHAPEFILE_URL}/land-polygons-split-4326/land_polygons.shp`;

// Check ogr2ogr availability.
try {
  execSync('ogr2ogr --version', { stdio: 'pipe' });
} catch {
  console.error('ogr2ogr not found. Install GDAL:');
  console.error('  Windows: https://trac.osgeo.org/osgeo4w/ (OSGeo4W installer)');
  console.error('  macOS:   brew install gdal');
  console.error('  Linux:   sudo apt install gdal-bin');
  process.exit(1);
}

if (!existsSync(OUTPUT_DIR)) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
}

const cmd = [
  'ogr2ogr',
  '-f',
  'GeoJSON',
  OUTPUT_PATH,
  VSICURL_PATH,
  '-spat',
  west,
  south,
  east,
  north,
  '-clipsrc',
  west,
  south,
  east,
  north,
].join(' ');

console.log(`Fetching land polygons clipped to [${west}, ${south}, ${east}, ${north}]...`);
console.log(`> ${cmd}`);

try {
  execSync(cmd, { stdio: 'inherit', timeout: 300_000 });
  console.log(`Wrote ${OUTPUT_PATH}`);
} catch (err) {
  console.error('ogr2ogr failed:', err.message);
  process.exit(1);
}
