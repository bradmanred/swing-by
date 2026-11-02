// Builds the OpenStreetMap snapshot that other jobs use instead of asking the busy Overpass servers.
//
// Input: GeoJSON sequences made by osmium (see .github/workflows/osm-snapshot.yml) from Geofabrik's daily extracts
// of Great Britain and of Ireland and Northern Ireland, filtered to playgrounds, parks and similar open spaces.
// Output, in the folder given:
//   osm-playgrounds.json.gz  every leisure=playground: [{ id: 'way/123', lat, lng, tags }], the format
//                            check-positions.mjs and junction-gaps.mjs read with --osm-file
//   osm-parks.json.gz        parks, gardens, commons, recreation grounds and nature reserves with a name, for finding
//                            a council's park by name: [{ id, lat, lng, name, kind }]
//   meta.json                { date, playgrounds, parks, source }
// A point stands for each feature: the node itself, or the middle of a way or area's outline.
//
//   node scripts/osm-snapshot.mjs out-folder input1.geojsonseq [input2.geojsonseq ...]
import { createReadStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { gzipSync } from 'node:zlib';

const [out, ...inputs] = process.argv.slice(2);
if (!out || !inputs.length) throw new Error('Usage: node scripts/osm-snapshot.mjs out-folder input.geojsonseq ...');
const KEEP = ['name', 'access', 'operator', 'indoor', 'leisure', 'landuse', 'playground', 'min_age', 'max_age', 'wheelchair', 'fee'];
const round = (n) => Math.round(n * 1e5) / 1e5;

/** The middle of a feature: the average of its outline's points (good enough to pin a playground or find a park). */
function middle(g) {
  const pts = [];
  const walk = (c) => (typeof c[0] === 'number' ? pts.push(c) : c.forEach(walk));
  walk(g.coordinates);
  if (!pts.length) return null;
  const [x, y] = pts.reduce((a, p) => [a[0] + p[0], a[1] + p[1]], [0, 0]);
  return { lng: round(x / pts.length), lat: round(y / pts.length) };
}

const playgrounds = new Map();
const parks = new Map();
for (const file of inputs) {
  const lines = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const raw of lines) {
    const line = raw.replace(/^\x1e/, '').trim(); // GeoJSON sequences may start each record with a record separator
    if (!line) continue;
    let f;
    try {
      f = JSON.parse(line);
    } catch {
      continue;
    }
    const p = f.properties ?? {};
    const type = p['@type'];
    const id = p['@id'];
    if (!type || id == null || !f.geometry) continue;
    const at = middle(f.geometry);
    if (!at) continue;
    const key = `${type}/${id}`;
    const tags = Object.fromEntries(KEEP.filter((k) => p[k] != null).map((k) => [k, String(p[k])]));
    if (p.leisure === 'playground') playgrounds.set(key, { id: key, ...at, tags });
    else if (p.name) parks.set(key, { id: key, ...at, name: String(p.name), kind: p.leisure ?? p.landuse ?? '' });
  }
}
await mkdir(out, { recursive: true });
await writeFile(join(out, 'osm-playgrounds.json.gz'), gzipSync(JSON.stringify([...playgrounds.values()])));
await writeFile(join(out, 'osm-parks.json.gz'), gzipSync(JSON.stringify([...parks.values()])));
const meta = { date: new Date().toISOString().slice(0, 10), playgrounds: playgrounds.size, parks: parks.size, source: 'Geofabrik extracts of OpenStreetMap (© OpenStreetMap contributors, ODbL)' };
await writeFile(join(out, 'meta.json'), JSON.stringify(meta, null, 1) + '\n');
console.log(`${meta.playgrounds} playgrounds and ${meta.parks} named parks and open spaces`);
