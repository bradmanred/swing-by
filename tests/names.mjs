// Street and place names from the OpenStreetMap snapshot (scripts/osm-names.mjs, scripts/osm-snapshot.mjs), and saving
// street lookups back into council-list CSVs (scripts/council-feeds.mjs).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { addressFor, inside, placeIndex, placeNames, roadFinder, simplifyRing, toSegment } from '../scripts/osm-names.mjs';
import { parseCsv, savePlaces } from '../scripts/council-feeds.mjs';

// Distance to a street: perpendicular in the middle, to the end beyond it.
const p = { lat: 51.5, lng: -0.1 };
const east = (m) => ({ lat: 51.5, lng: -0.1 + m / 69400 });
const north = (m) => ({ lat: 51.5 + m / 111200, lng: -0.1 });
assert.ok(Math.abs(toSegment(p, { ...north(100), lng: -0.11 }, { ...north(100), lng: -0.09 }) - 100) < 2);
assert.ok(Math.abs(toSegment(p, east(50), east(300)) - 50) < 2);

// Nearest named street within 250 m, fed one street at a time.
const finder = roadFinder([p, north(5000)]);
finder.add('Far Lane', [[-0.11, north(240).lat], [-0.09, north(240).lat]]);
finder.add('Park Road', [[-0.11, north(60).lat], [-0.09, north(60).lat]]);
finder.add('Over The Hill', [[-0.11, north(400).lat], [-0.09, north(400).lat]]);
assert.equal(finder.best(0), 'Park Road');
assert.equal(finder.best(1), '', 'nothing within 250 m');

// Suburb and town, the way Nominatim's address gives them.
const places = placeIndex([
  { n: 'Leeds', k: 'city', ...north(4000) },
  { n: 'Headingley', k: 'suburb', ...north(800) },
  { n: 'Little Holt', k: 'hamlet', ...east(300) },
  { n: 'Bramwell', k: 'village', lat: 52.5, lng: -1.5 },
  { n: 'Market Ford', k: 'town', lat: 52.5, lng: -1.45 },
]);
assert.deepEqual(placeNames(places, p), { sub: 'Headingley', town: 'Leeds' }, 'a suburb beats a nearer hamlet');
assert.deepEqual(placeNames(places, { lat: 52.501, lng: -1.501 }), { sub: 'Bramwell', town: 'Bramwell' }, 'a village nearer than the town is its own place');
assert.deepEqual(placeNames(places, { lat: 52.501, lng: -1.452 }), { sub: '', town: 'Market Ford' }, 'in the town, beyond the village');
assert.deepEqual(placeNames(places, { lat: 57, lng: -4 }), { sub: '', town: '' });
// Boundaries Nominatim uses: London, and a city council's own area beyond the city's usual reach.
assert.deepEqual(placeNames(places, p, { region: 'London', admin_district: 'Islington' }), { sub: 'Headingley', town: 'Greater London' });
const farOut = { lat: 51.5 + 16000 / 111200, lng: -0.1 }; // 12 km from Leeds's point, past its reach
assert.equal(placeNames(places, farOut).town, '');
assert.equal(placeNames(places, farOut, { admin_district: 'Leeds' }).town, 'Leeds');

// A village right beside the point beats a suburb further off; a suburb keeps its town over a nearer village.
const herts = placeIndex([
  { n: 'Welwyn Garden City', k: 'town', lat: 51.8, lng: -0.2 },
  { n: 'Handside', k: 'suburb', lat: 51.8, lng: -0.215 },
  { n: 'Lemsford', k: 'village', lat: 51.8, lng: -0.2333 },
  { n: 'Haldens', k: 'suburb', lat: 51.812, lng: -0.19 },
  { n: 'Digswell', k: 'village', lat: 51.817, lng: -0.19 },
]);
assert.deepEqual(placeNames(herts, { lat: 51.8, lng: -0.2358 }), { sub: 'Lemsford', town: 'Lemsford' });
assert.deepEqual(placeNames(herts, { lat: 51.8135, lng: -0.19 }), { sub: 'Haldens', town: 'Welwyn Garden City' });

// Outlines: inside, holes, simplifying.
const square = (w, s, e, n) => [w, s, e, s, e, n, w, n, w, s];
const box = { bb: [0, 0, 10, 10], r: [square(0, 0, 10, 10), square(4, 4, 6, 6)] };
assert.equal(inside({ lng: 2, lat: 2 }, box), true);
assert.equal(inside({ lng: 5, lat: 5 }, box), false, 'in the hole');
assert.equal(inside({ lng: 11, lat: 5 }, box), false);
assert.deepEqual(simplifyRing([[0, 0], [0.5, 0.00001], [1, 0], [1, 1], [0, 1], [0, 0]]), [0, 0, 1, 0, 1, 1, 0, 1, 0, 0], 'a wobble under 20 m goes');
assert.deepEqual(simplifyRing([[0, 0], [0.00001, 0], [0, 0.00001], [0, 0]]), [], 'too small');

// Birchwood Playground: Stanborough's point is nearer, but the playground is inside Hatfield parish, as Birchwood is,
// and Stanborough is outside it. Hatfield is the parish's name; Welwyn Garden City's point is nearer but outside.
const hatfield = { n: 'Hatfield', k: 'parish', bb: [-0.3, 51.7, -0.2234, 51.79], r: [square(-0.3, 51.7, -0.2234, 51.79)] };
const wgc = placeIndex([
  { n: 'Stanborough', k: 'village', lat: 51.7884, lng: -0.2172 },
  { n: 'Birchwood', k: 'suburb', lat: 51.7712, lng: -0.2263 },
  { n: 'Welwyn Garden City', k: 'town', lat: 51.8, lng: -0.2 },
  { n: 'Hatfield', k: 'town', lat: 51.7634, lng: -0.2246 },
], [hatfield]);
assert.deepEqual(placeNames(wgc, { lat: 51.7884, lng: -0.2237 }), { sub: 'Birchwood', town: 'Hatfield' });
// Just outside the parish, the nearest places win as before.
assert.equal(placeNames(wgc, { lat: 51.7884, lng: -0.2200 }).sub, 'Stanborough');
// A mapped suburb outline beats any point.
const outlined = placeIndex([{ n: 'Handside', k: 'suburb', lat: 51.8, lng: -0.215 }, { n: 'Welwyn Garden City', k: 'town', lat: 51.8, lng: -0.2 }],
  [{ n: 'Peartree', k: 'suburb', bb: [-0.22, 51.79, -0.21, 51.81], r: [square(-0.22, 51.79, -0.21, 51.81)] }]);
assert.deepEqual(placeNames(outlined, { lat: 51.8, lng: -0.2149 }), { sub: 'Peartree', town: 'Welwyn Garden City' });

// addressFor reads the snapshot for playgrounds it has, without any network.
const address = addressFor([{ id: 'way/1', ...p, road: 'Park Road' }], [{ n: 'Leeds', k: 'city', ...north(4000) }]);
assert.deepEqual(await address(p, 'way/1'), { road: 'Park Road', sub: '', town: 'Leeds', from: 'snapshot' });
assert.equal(address.counts.snapshot, 1);

// The snapshot builder, end to end on a tiny extract.
const dir = mkdtempSync(join(tmpdir(), 'osm-'));
const seq = (name, fs) => (writeFileSync(join(dir, name), fs.map((f) => '\x1e' + JSON.stringify(f)).join('\n') + '\n'), join(dir, name));
const play = seq('a.play.geojsonseq', [
  { type: 'Feature', properties: { '@type': 'node', '@id': 1, leisure: 'playground' }, geometry: { type: 'Point', coordinates: [p.lng, p.lat] } },
  { type: 'Feature', properties: { '@type': 'way', '@id': 2, leisure: 'park', name: 'Victoria Park' }, geometry: { type: 'Point', coordinates: [-0.1, 51.6] } },
]);
const roads = seq('a.roads.geojsonseq', [
  { type: 'Feature', properties: { '@type': 'way', '@id': 3, highway: 'residential', name: 'Park Road' }, geometry: { type: 'LineString', coordinates: [[-0.11, north(60).lat], [-0.09, north(60).lat]] } },
  { type: 'Feature', properties: { '@type': 'way', '@id': 4, highway: 'motorway', name: 'M1' }, geometry: { type: 'LineString', coordinates: [[-0.11, north(10).lat], [-0.09, north(10).lat]] } },
]);
const areasF = seq('a.areas.geojsonseq', [
  { type: 'Feature', properties: { '@type': 'relation', '@id': 6, boundary: 'administrative', admin_level: '10', name: 'Hatfield' }, geometry: { type: 'Polygon', coordinates: [[[-0.3, 51.4], [0, 51.4], [0, 51.6], [-0.3, 51.6], [-0.3, 51.4]]] } },
  { type: 'Feature', properties: { '@type': 'relation', '@id': 7, boundary: 'administrative', admin_level: '8', name: 'Welwyn Hatfield' }, geometry: { type: 'Polygon', coordinates: [[[-0.3, 51.4], [0, 51.4], [0, 51.6], [-0.3, 51.4]]] } },
]);
const plc = seq('a.places.geojsonseq', [{ type: 'Feature', properties: { '@type': 'node', '@id': 5, place: 'city', name: 'Leeds' }, geometry: { type: 'Point', coordinates: [p.lng, north(4000).lat] } }]);
execFileSync('node', ['scripts/osm-snapshot.mjs', join(dir, 'out'), play, '--roads', roads, '--places', plc, '--areas', areasF], { stdio: 'pipe' });
const savedAreas = JSON.parse(gunzipSync(readFileSync(join(dir, 'out/osm-areas.json.gz'))));
assert.deepEqual(savedAreas.map((a) => [a.n, a.k]), [['Hatfield', 'parish']], 'only parishes, not districts');
const pg = JSON.parse(gunzipSync(readFileSync(join(dir, 'out/osm-playgrounds.json.gz'))));
assert.equal(pg[0].road, 'Park Road', 'motorways are not street names');
assert.equal(JSON.parse(gunzipSync(readFileSync(join(dir, 'out/osm-places.json.gz'))))[0].n, 'Leeds');
assert.equal(JSON.parse(readFileSync(join(dir, 'out/meta.json'), 'utf8')).named, 1);
// Without --roads and --places it makes the old two files, as before.
execFileSync('node', ['scripts/osm-snapshot.mjs', join(dir, 'old'), play], { stdio: 'pipe' });
assert.equal(JSON.parse(gunzipSync(readFileSync(join(dir, 'old/osm-playgrounds.json.gz'))))[0].road, undefined);

// Street lookups saved back into a council-list CSV, other rows unchanged.
const rows = parseCsv('name,postcode,where\n"Mercel Avenue Playground, Armthorpe",,"Mercel Avenue, Armthorpe, Doncaster"\nTown Park,DN1 2AB,\n');
const saved = savePlaces(rows, new Map([['Mercel Avenue Playground, Armthorpe', { lat: 53.536541, lng: -1.05 }]]));
assert.equal(saved, 'name,postcode,where,lat,lng,placed\n"Mercel Avenue Playground, Armthorpe",,"Mercel Avenue, Armthorpe, Doncaster",53.53654,-1.05,street\nTown Park,DN1 2AB,,,,\n');
assert.deepEqual(parseCsv(saved)[0].placed, 'street');
console.log('names: ok');
