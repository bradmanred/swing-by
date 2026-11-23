// What the importers take from OpenStreetMap (scripts/osm-details.mjs): which playgrounds are public, names from the
// park, equipment, ages and access; the snapshot's park, equipment and grounds details (scripts/osm-snapshot.mjs);
// the tidy job for listings already imported (scripts/osm-tidy.mjs); and the quarterly check's "Unverified but on the
// council's list" part (scripts/quarterly-check.mjs). Run by `npm test`.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { NOT_PUBLIC, agesFrom, equipmentCode, groundsKind, isPublic, isPublicPlay, madeUpName, osmNotConfirmed, osmPlaygroundDoc, playgroundName } from '../scripts/osm-details.mjs';

// Public or not.
assert.ok(isPublic({}));
assert.ok(!isPublic({ access: 'residents' }));
assert.ok(!isPublic({ name: 'St Mary’s Primary School playground' }));
assert.ok(!isPublicPlay({ tags: {}, within: 'school' }), 'inside school grounds');
assert.ok(NOT_PUBLIC.has('way/1046353451') && !isPublicPlay({ id: 'way/1046353451', tags: {} }), 'one a parish council says is private');
assert.equal(groundsKind({ amenity: 'kindergarten' }), 'school');
assert.equal(groundsKind({ tourism: 'caravan_site' }), 'holiday park');
assert.equal(groundsKind({ leisure: 'park' }), null);

// Names: own name, then park, then street, then place.
assert.equal(playgroundName({ tagName: 'Pirate Ship Play Area', park: 'Victoria Park', road: 'Elm Road' }), 'Pirate Ship Play Area');
assert.equal(playgroundName({ tagName: 'Playground', park: 'Victoria Park', road: 'Elm Road' }), 'Victoria Park Playground');
assert.equal(playgroundName({ park: 'Byes Adventure Playground' }), 'Byes Adventure Playground', 'no "Playground Playground"');
assert.equal(playgroundName({ road: 'Elm Road', place: 'Sidmouth' }), 'Playground off Elm Road');
assert.equal(playgroundName({ place: 'Sidmouth' }), 'Sidmouth Playground');
assert.equal(playgroundName({ tagName: 'toddler playground', road: 'Brackendale Road' }), 'Toddler Playground off Brackendale Road');
assert.equal(playgroundName({ tagName: 'Toddler Play Area', park: 'Byes Park' }), 'Byes Park Toddler Play Area');
assert.equal(playgroundName({ tagName: 'STADT MOERS PARK WEST VIEW' }), 'Stadt Moers Park West View', 'shouting tidied');
assert.equal(playgroundName({ tagName: "children's playground", park: 'Byes Park' }), "Byes Park Children's Playground");
assert.ok(madeUpName('Playground off Elm Road') && madeUpName('Sidmouth Playground', 'Sidmouth') && !madeUpName('Connaught Gardens Play Area', 'Sidmouth'));

// Equipment and ages.
assert.equal(equipmentCode({ playground: 'swing' }), 'sw');
assert.equal(equipmentCode({ playground: 'swing', baby: 'yes' }), 'bs');
assert.equal(equipmentCode({ playground: 'swing', 'swing:seat': 'basket' }), 'bk');
assert.equal(equipmentCode({ playground: 'springy' }), 'spr');
assert.equal(equipmentCode({ playground: 'bench' }), null);
assert.deepEqual(agesFrom({}), []);
assert.deepEqual(agesFrom({ min_age: '2', max_age: '8' }), ['under-3', '3-6', '7-12']);
assert.deepEqual(agesFrom({ max_age: '5' }), ['under-3', '3-6']);
assert.deepEqual(agesFrom({ min_age: '8' }), ['7-12']);
assert.deepEqual(agesFrom({ min_age: 'toddler' }), []);

// A new file: named after the park, with what's mapped, Unverified.
const doc = osmPlaygroundDoc(
  { id: 'way/9', lat: 50.68, lng: -3.24, tags: { leisure: 'playground', wheelchair: 'yes', fee: 'yes' }, park: 'Byes Park', equip: ['sl', 'sw'] },
  { road: 'Salcombe Road', place: 'Sidmouth', area: 'Sidmouth', region: 'devon' },
);
assert.equal(doc.name, 'Byes Park Playground');
assert.deepEqual(doc.equipment, ['sw', 'sl']);
assert.deepEqual(doc.access, ['sf']);
assert.equal(doc.checked, null);
assert.equal(doc.fee, undefined, 'a mapped fee is mentioned, not shown as paid entry');
assert.match(doc.description, /^A playground on OpenStreetMap near Salcombe Road, Sidmouth\..*may be a charge/);
assert.match(doc.notConfirmed, /^Exact position \(taken from OpenStreetMap\), age ranges, play equipment \(what is mapped on OpenStreetMap/);
assert.equal(osmNotConfirmed(), 'Exact position (taken from OpenStreetMap), age ranges, play equipment, opening hours, toilets and parking. Listed from OpenStreetMap (© OpenStreetMap contributors) only, so whether it is open to the public is unconfirmed too.', 'unchanged when nothing is mapped');

// The snapshot: park, equipment inside the playground's outline (or near a point playground), and school grounds.
const dir = mkdtempSync(join(tmpdir(), 'swing-by-osm-'));
const sq = (x, y, s) => ({ type: 'Polygon', coordinates: [[[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]]] });
const pt = (x, y) => ({ type: 'Point', coordinates: [x, y] });
const F = (type, id, props, geometry) => ({ type: 'Feature', properties: { '@type': type, '@id': id, ...props }, geometry });
const play = join(dir, 'p.play.geojsonseq');
writeFileSync(play, [
  F('way', 1, { leisure: 'park', name: 'Byes Park' }, sq(-3.25, 50.68, 0.01)),
  F('way', 2, { leisure: 'playground' }, sq(-3.245, 50.685, 0.0003)),
  F('node', 3, { playground: 'swing' }, pt(-3.2449, 50.6851)),
  F('node', 4, { playground: 'slide' }, pt(-3.2448, 50.6852)),
  F('node', 5, { playground: 'slide' }, pt(-3.24, 50.6851)), // outside every playground
  F('node', 6, { leisure: 'playground' }, pt(-3.2, 50.7)),
  F('node', 7, { playground: 'seesaw' }, pt(-3.20005, 50.70005)), // about 7 m from the point playground
  F('way', 8, { amenity: 'school', name: 'Sidmouth Primary' }, sq(-3.1, 50.7, 0.005)),
  F('way', 9, { leisure: 'playground' }, sq(-3.099, 50.701, 0.0003)),
].map((f) => '\x1e' + JSON.stringify(f)).join('\n'));
execFileSync('node', ['scripts/osm-snapshot.mjs', join(dir, 'out'), play], { stdio: 'pipe' });
const snap = JSON.parse(gunzipSync(readFileSync(join(dir, 'out/osm-playgrounds.json.gz'))));
const by = Object.fromEntries(snap.map((p) => [p.id, p]));
assert.equal(snap.length, 3, 'equipment points and school grounds are not playgrounds');
assert.equal(by['way/2'].park, 'Byes Park');
assert.deepEqual(by['way/2'].equip, ['sw', 'sl']);
assert.deepEqual(by['node/6'].equip, ['ss']);
assert.equal(by['way/9'].within, 'school');
assert.equal(by['way/9'].park, undefined);
const parksOut = JSON.parse(gunzipSync(readFileSync(join(dir, 'out/osm-parks.json.gz'))));
assert.deepEqual(parksOut.map((p) => p.name), ['Byes Park'], 'school grounds are not parks');

// The tidy job: a made-up name becomes the park's, details fill in, the old address redirects, and listings with a
// checked date or a photo are left alone.
const pdir = join(dir, 'playgrounds');
mkdirSync(pdir);
const osmFile = (id, extra) => writeFileSync(join(pdir, `${id}.json`), JSON.stringify({
  name: 'Playground off Salcombe Road', region: 'devon', area: 'Sidmouth', lat: 50.68515, lng: -3.24485, ages: [], equipment: [], access: [], facilities: [], opens: '',
  description: "A playground on OpenStreetMap near Salcombe Road, Sidmouth. No council list we've checked includes it yet, so we can't confirm it's open to everyone or what it has.",
  nearby: [], sources: [{ label: 'OpenStreetMap: playground', url: 'https://www.openstreetmap.org/way/2' }], checked: null,
  notConfirmed: osmNotConfirmed(), photo: null, ...extra,
}, null, 2));
osmFile('playground-off-salcombe-road-sidmouth');
osmFile('playground-off-salcombe-road-sidmouth-2', { photo: { src: 'x.jpg' } });
osmFile('school-one', { name: 'Playground off School Lane', sources: [{ label: 'OpenStreetMap: playground', url: 'https://www.openstreetmap.org/way/9' }] });
const worker = join(dir, 'worker.js');
writeFileSync(worker, 'const MERGED = {\n};\n');
writeFileSync(join(dir, 'snap.json'), JSON.stringify(snap));
execFileSync('node', ['scripts/osm-tidy.mjs', '--dir', pdir, '--out', dir, '--worker', worker], { stdio: 'pipe', env: { ...process.env, OSM_PLAYGROUNDS: join(dir, 'snap.json') } });
const after = readdirSync(pdir).sort();
assert.deepEqual(after, ['byes-park-playground-sidmouth.json', 'playground-off-salcombe-road-sidmouth-2.json', 'school-one.json']);
const tidied = JSON.parse(readFileSync(join(pdir, 'byes-park-playground-sidmouth.json'), 'utf8'));
assert.equal(tidied.name, 'Byes Park Playground');
assert.deepEqual(tidied.equipment, ['sw', 'sl']);
assert.match(tidied.notConfirmed, /what is mapped on OpenStreetMap/);
assert.match(tidied.description, /^A playground on OpenStreetMap near Salcombe Road, Sidmouth\./);
assert.match(readFileSync(worker, 'utf8'), /'playground-off-salcombe-road-sidmouth': 'byes-park-playground-sidmouth'/);
const tidyReport = JSON.parse(readFileSync(join(dir, 'osm-tidy.json'), 'utf8'));
assert.deepEqual(tidyReport.inGrounds.map((x) => x.id), ['school-one'], 'listed, not deleted');

// Quarterly check: an Unverified listing next to a playground on a council's list is flagged for verifying.
const qdir = join(dir, 'q');
mkdirSync(qdir);
writeFileSync(join(qdir, 'byes.json'), JSON.stringify({ name: 'Byes Park Playground', lat: 50.68515, lng: -3.24485, sources: [{ label: 'x', url: 'https://www.openstreetmap.org/way/2' }], checked: null }));
const csv = join(dir, 'list.csv');
writeFileSync(csv, 'name,park,postcode,url,text,where,lat,lng,placed\nThe Byes play area,The Byes,,https://www.example.gov.uk/byes,,,50.6852,-3.2449,\nPeaslands play area,,,https://www.example.gov.uk/peas,,,50.7,-3.3,\n');
const councils = join(dir, 'councils.json');
writeFileSync(councils, JSON.stringify({ councils: [{ district: 'East Devon', council: 'East Devon District Council', sources: [], feed: { type: 'list', file: csv } }] }));
execFileSync('node', ['scripts/quarterly-check.mjs', '--dir', qdir, '--out', qdir, '--skip', 'osm,links,stale,names', '--councils', councils], { stdio: 'pipe' });
const q = JSON.parse(readFileSync(join(qdir, 'quarterly-check.json'), 'utf8')).councils[0];
assert.deepEqual(q.verify.map((v) => [v.id, v.council]), [['byes', 'The Byes play area']]);
assert.deepEqual(q.fresh.map((x) => x.name), ['Peaslands play area']);

rmSync(dir, { recursive: true, force: true });
console.log('osm-details: ok');
