// Possible duplicates (scripts/check-duplicates.mjs) and merging them (scripts/merge-playgrounds.mjs).
import assert from 'node:assert/strict';
import { findPairs, kindOf, listing, pairKey } from '../scripts/check-duplicates.mjs';
import { addMerged, mergeDocs } from '../scripts/merge-playgrounds.mjs';

const osm = (id) => [{ label: 'OpenStreetMap: playground', url: `https://www.openstreetmap.org/${id}` }];
const council = [{ label: 'Council: a park', url: 'https://example.gov.uk/park' }];
// Digswell: the council's listing was pinned from the postcode, about 200 m from the OpenStreetMap-only one.
const digswell = listing('digswell-playing-fields-play-area-digswell', {
  name: 'Digswell Playing Fields Play Area', lat: 51.818385, lng: -0.189675, sources: council, checked: '2026-10-20',
  notConfirmed: 'Exact position (mapped from the postcode, AL6 0BX), equipment, age ranges and toilets.',
});
const hertford = listing('playground-off-hertford-road-welwyn-welwyn-hatfield', {
  name: 'Playground off Hertford Road', lat: 51.81946, lng: -0.19197, sources: osm('way/85693330'), checked: null,
  notConfirmed: 'Exact position (taken from OpenStreetMap), age ranges.',
});
assert.equal(digswell.rough, true);
assert.equal(hertford.osmOnly, true);
let pairs = findPairs([digswell, hertford]);
assert.equal(pairs.length, 1);
assert.equal(pairs[0].kind, 'osm-beside-official');
assert.ok(pairs[0].m > 150 && pairs[0].m < 300, 'found beyond 150 m because the pin is rough');
assert.equal(findPairs([digswell, hertford], new Set([pairKey(hertford.id, digswell.id)])).length, 0, 'not-duplicates skips it');
// The same council listing with an exact pin is too far away to count.
assert.equal(findPairs([{ ...digswell, rough: false }, hertford]).length, 0);

const L = (name, extra = {}) => ({ id: name, name, lat: 0, lng: 0, osmOnly: false, osm: [], rough: false, ...extra });
assert.equal(kindOf(L('A', { osm: ['way/1'] }), L('B', { osm: ['way/1'] }), 900), 'same-osm');
assert.equal(kindOf(L('Jubilee Park Infant Play Area'), L('Jubilee Park Junior Play Area'), 0), null, 'two areas of one park');
assert.equal(kindOf(L('Holmebrook Valley Park'), L('Holmebrook Valley Park'), 0), 'similar-names');
assert.equal(kindOf(L('Horniman\'s Triangle Playground'), L('Horniman Triangle Play Park'), 62), 'similar-names');
assert.equal(kindOf(L('Bell Close Playground'), L('Swallow Close Playground'), 46), null, 'a shared street word is not a match');
assert.equal(kindOf(L('Ardal Chwarae Mochdre', { rough: true }), L('Mochdre Play Area'), 157), 'similar-names', 'Welsh and English names');
assert.equal(kindOf(L('Uplands Play Area'), L('Usk Road Play Area'), 0), 'shared-pin');
assert.equal(kindOf(L('Mile End Park Adventure Park'), L("Mile End Park Children's Pavilion"), 22), 'very-close', 'two parts of one park, but under 40 m: worth a look');
assert.equal(kindOf(L('Playground off A Road', { osmOnly: true }), L('Playground off B Road', { osmOnly: true }), 90), null, 'two mapped playgrounds');
assert.equal(kindOf(L('Playground off A Road', { osmOnly: true }), L('Playground off A Road', { osmOnly: true }), 14), 'similar-names', 'mapped twice');

// Merging.
const keep = {
  name: 'Digswell Playing Fields Play Area', lat: 51.818385, lng: -0.189675, ages: ['under-3'], equipment: [], facilities: ['fp'],
  sources: council, checked: '2026-10-20', notConfirmed: 'Exact position (mapped from the postcode, AL6 0BX), equipment, age ranges and toilets.', photo: null,
};
const drop = {
  name: 'Playground off Hertford Road', lat: 51.81946, lng: -0.19197, ages: [], equipment: ['swings'], facilities: [],
  sources: osm('way/85693330'), checked: null, notConfirmed: 'Exact position (taken from OpenStreetMap), age ranges.', photo: null,
};
const m = mergeDocs(keep, drop);
assert.equal(m.pin, 'drop', "takes the OpenStreetMap pin when ours is from a postcode");
assert.deepEqual([m.doc.lat, m.doc.lng], [51.81946, -0.19197]);
assert.equal(m.doc.notConfirmed, 'Exact position (taken from OpenStreetMap), equipment, age ranges and toilets.');
assert.equal(m.doc.sources.length, 2);
assert.deepEqual(m.doc.ages, ['under-3'], 'keeps its own details');
assert.deepEqual(m.doc.equipment, ['swings'], 'fills in what it leaves empty');
assert.equal(m.doc.name, keep.name);
assert.equal(mergeDocs(keep, drop, 'keep').doc.lat, keep.lat);
assert.equal(mergeDocs({ ...keep, notConfirmed: 'Exact position (taken from OpenStreetMap).' }, drop).pin, 'keep');
assert.throws(() => mergeDocs(drop, keep), /Keep the official listing/);

const worker = "const MERGED = {\n  'old-a': 'b',\n  'older': 'old-a',\n};\nrest";
// Older addresses that went to b now go straight to c.
assert.equal(addMerged(worker, 'b', 'c'), "const MERGED = {\n  'old-a': 'c',\n  'older': 'old-a',\n  'b': 'c',\n};\nrest");
console.log('duplicates: ok');
