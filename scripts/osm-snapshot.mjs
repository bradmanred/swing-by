// Builds the OpenStreetMap snapshot that other jobs use instead of asking the busy Overpass servers.
//
// Input: GeoJSON sequences made by osmium (see .github/workflows/osm-snapshot.yml) from Geofabrik's daily extracts
// of Great Britain and of Ireland and Northern Ireland: playgrounds, parks and similar open spaces; and optionally
// named streets (--roads) and named places (--places), for naming new playgrounds without asking Nominatim
// (scripts/osm-names.mjs).
// Output, in the folder given:
//   osm-playgrounds.json.gz  every leisure=playground: [{ id: 'way/123', lat, lng, tags, road }], the format
//                            check-positions.mjs and junction-gaps.mjs read with --osm-file. "road" is the nearest
//                            named street within 250 m, when --roads was given and there is one.
//   osm-parks.json.gz        parks, gardens, commons, recreation grounds and nature reserves with a name, for finding
//                            a council's park by name: [{ id, lat, lng, name, kind }]
//   osm-places.json.gz       with --places: named cities, towns, villages, suburbs, neighbourhoods and hamlets,
//                            [{ n: name, k: kind, lat, lng }]
//   meta.json                { date, playgrounds, parks, places, named, source }
// A point stands for each feature: the node itself, or the middle of a way or area's outline.
//
//   node scripts/osm-snapshot.mjs out-folder play1.geojsonseq [...] [--roads roads1.geojsonseq ...] [--places places1.geojsonseq ...]
import { createReadStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { gzipSync } from 'node:zlib';
import { PLACE_KM, ROAD_KINDS, roadFinder } from './osm-names.mjs';

const [out, ...rest] = process.argv.slice(2);
const inputs = { play: [], roads: [], places: [] };
let into = 'play';
for (const a of rest) {
  if (a === '--roads' || a === '--places') into = a.slice(2);
  else inputs[into].push(a);
}
if (!out || !inputs.play.length) throw new Error('Usage: node scripts/osm-snapshot.mjs out-folder play.geojsonseq ... [--roads roads.geojsonseq ...] [--places places.geojsonseq ...]');
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

/** Each feature in GeoJSON sequence files, one at a time. */
async function* features(files) {
  for (const file of files) {
    const lines = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
    for await (const raw of lines) {
      const line = raw.replace(/^\x1e/, '').trim(); // GeoJSON sequences may start each record with a record separator
      if (!line) continue;
      try {
        const f = JSON.parse(line);
        if (f.geometry) yield f;
      } catch {
        // a damaged line: skip it
      }
    }
  }
}

const playgrounds = new Map();
const parks = new Map();
for await (const f of features(inputs.play)) {
  const p = f.properties ?? {};
  const type = p['@type'];
  const id = p['@id'];
  if (!type || id == null) continue;
  const at = middle(f.geometry);
  if (!at) continue;
  const key = `${type}/${id}`;
  const tags = Object.fromEntries(KEEP.filter((k) => p[k] != null).map((k) => [k, String(p[k])]));
  if (p.leisure === 'playground') playgrounds.set(key, { id: key, ...at, tags });
  else if (p.name) parks.set(key, { id: key, ...at, name: String(p.name), kind: p.leisure ?? p.landuse ?? '' });
}

// Nearest named street to each playground, streamed street by street.
const list = [...playgrounds.values()];
let named = 0;
if (inputs.roads.length) {
  const finder = roadFinder(list);
  for await (const f of features(inputs.roads)) {
    const p = f.properties ?? {};
    if (!p.name || !ROAD_KINDS.has(p.highway)) continue;
    const g = f.geometry;
    const lines = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : g.type === 'Polygon' ? g.coordinates : [];
    for (const line of lines) finder.add(String(p.name), line);
  }
  list.forEach((pg, i) => {
    const road = finder.best(i);
    if (road) (pg.road = road), named++;
  });
}

// Named places.
const places = [];
for await (const f of features(inputs.places)) {
  const p = f.properties ?? {};
  if (!p.name || !PLACE_KM[p.place] || f.geometry.type !== 'Point') continue;
  const [lng, lat] = f.geometry.coordinates;
  places.push({ n: String(p.name), k: p.place, lat: round(lat), lng: round(lng) });
}

await mkdir(out, { recursive: true });
await writeFile(join(out, 'osm-playgrounds.json.gz'), gzipSync(JSON.stringify(list)));
await writeFile(join(out, 'osm-parks.json.gz'), gzipSync(JSON.stringify([...parks.values()])));
if (inputs.places.length) await writeFile(join(out, 'osm-places.json.gz'), gzipSync(JSON.stringify(places)));
const meta = {
  date: new Date().toISOString().slice(0, 10), playgrounds: playgrounds.size, parks: parks.size,
  ...(inputs.roads.length && { named }), ...(inputs.places.length && { places: places.length }),
  source: 'Geofabrik extracts of OpenStreetMap (© OpenStreetMap contributors, ODbL)',
};
await writeFile(join(out, 'meta.json'), JSON.stringify(meta, null, 1) + '\n');
console.log(`${meta.playgrounds} playgrounds (${named} with a street name within 250 m), ${meta.parks} named parks and open spaces, ${places.length} named places`);
