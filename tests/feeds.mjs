// Council feed names: a directory's own heading must never be read as a park's name.
import assert from 'node:assert/strict';
import { namesAgree, osmIds, roughPin, samePlace, sameNamed } from '../scripts/same-place.mjs';
import { geoName, parseCsv, recordName, slugName } from '../scripts/council-feeds.mjs';

assert.equal(recordName('Church Meadows - Parks and recreation directory'), 'Church Meadows');
assert.equal(recordName('Parks and recreation directory - Church Meadows'), 'Church Meadows');
assert.equal(recordName('Tarnerland'), 'Tarnerland');
assert.equal(slugName('https://www.reigate-banstead.gov.uk/directory_record/1057478/church_meadows'), 'Church Meadows');
assert.equal(slugName('https://www.reigate-banstead.gov.uk/directory_record/1057525/arbutus_road_open_space'), 'Arbutus Road Open Space');
assert.equal(slugName('https://www.braintree.gov.uk/directory-record/100/'), '');
// Council lists copied into src/data/council-lists/ (the "list" feed).
assert.deepEqual(parseCsv('name,postcode,text\nDanson Park Playground,DA6 8HL,"Splash park, open ""May to September"""\n'), [{ name: 'Danson Park Playground', postcode: 'DA6 8HL', text: 'Splash park, open "May to September"' }]);
// Same place or a separate one close by (scripts/same-place.mjs), from Islington's adventure playgrounds.
const park = (name, osm = [], osmOnly = false) => ({ name, osm, osmOnly });
assert.equal(sameNamed('Holdbrook Old School Site', 'Holdbrook Old School Site Play Area'), true);
assert.equal(sameNamed('Cassiobury Park and Whippendell Wood', 'Cassiobury Park Playgrounds'), true);
assert.equal(sameNamed('Holdbrook Old School Site', 'Holdbrook West Play Area'), false, 'one shared word is not enough');
assert.equal(sameNamed('Playground off Gammons Lane', 'Gammons Lane'), false, 'made-up names never match');
assert.equal(sameNamed('Play area', 'Playground'), false);
assert.equal(samePlace({ name: 'Lumpy Hill Adventure Playground', osm: 'way/260462113' }, park('Caledonian Park', ['way/87685649']), 80), false, 'differently named site 80 m away is separate');
assert.equal(samePlace({ name: 'Martin Luther King Adventure Playground' }, park('Paradise Park'), 51), false);
assert.equal(samePlace({ name: 'Hayward Adventure Playground', osm: 'way/87685649' }, park('Caledonian Park', ['way/87685649']), 0), true, 'same OpenStreetMap play area');
assert.equal(samePlace({ name: 'Barnard Park Adventure Playground' }, park('Barnard Park'), 90), true, 'shared name word');
assert.equal(samePlace({ name: 'Spa Fields Playground' }, park('Three Corners Adventure Playground'), 30), true, 'within 40 m');
assert.equal(samePlace({ name: 'Cape Adventure Playground' }, park('Playground off Crouch Hill', [], true), 120), true, 'OpenStreetMap-only listing is replaced');
assert.equal(samePlace({ name: 'Playground' }, park('Paradise Park'), 90), true, 'a record with no distinctive name');
assert.equal(samePlace({ name: 'Lumpy Hill Adventure Playground' }, park('Caledonian Park'), 150), false, 'beyond 150 m');
// Rough pins (from a postcode, street or park's middle) reach 300 m, but only when the names agree.
assert.equal(roughPin('Exact position (mapped from the postcode, AL6 0BX), equipment.'), true);
assert.equal(roughPin("Exact position (approximate: the park's point on the council's map, not the play area itself)."), true);
assert.equal(roughPin('Exact position (taken from OpenStreetMap), age ranges.'), false);
assert.equal(roughPin("Exact position (from the council's map), age ranges."), false);
assert.equal(roughPin('Age ranges and toilets.'), false);
const rough = (name, osmOnly = false) => ({ name, osm: [], osmOnly, rough: true });
assert.equal(samePlace({ name: 'Playground off Hertford Road' }, rough('Digswell Playing Fields Play Area'), 198), true, 'Digswell: postcode pin 200 m off');
assert.equal(samePlace({ name: 'Baker Close Play Area' }, rough('Manstone Recreation Ground Play Area'), 220), false, 'rough pin, different names');
assert.equal(samePlace({ name: 'Playground' }, rough('Digswell Playing Fields'), 310), false, 'beyond 300 m');
assert.equal(samePlace({ name: 'Playground', rough: true }, park('Playground off Hertford Road', [], true), 250), true, 'rough council record replaces an OpenStreetMap-only listing');
assert.equal(samePlace({ name: 'Playground' }, park('Digswell Playing Fields'), 200), false, 'neither pin rough: 150 m as before');
assert.equal(namesAgree('Digswell Play Area', 'Digswell Playing Fields'), true);
assert.equal(namesAgree('Lumpy Hill', 'Caledonian Park'), false);
assert.deepEqual(osmIds([{ url: 'https://www.openstreetmap.org/way/87685649' }, { url: 'https://islington.gov.uk/x' }]), ['way/87685649']);
assert.deepEqual(parseCsv('name,park,postcode,lat,lng\nVictoria Park Tipton Playground,Victoria Park,,52.52491,-2.06243\n')[0], { name: 'Victoria Park Tipton Playground', park: 'Victoria Park', postcode: '', lat: '52.52491', lng: '-2.06243' });
// geojson names from several fields (Fife's play park layer has a street and a town, but no name).
const fife = { nameFormat: '{Street} Play Park, {Town}' };
assert.equal(geoName({ Street: 'Forth Street', Town: 'Kincardine' }, fife), 'Forth Street Play Park, Kincardine');
assert.equal(geoName({ Street: 'Forth Street', Town: null }, fife), 'Forth Street Play Park');
assert.equal(geoName({ Street: null, Town: null }, fife), '');
assert.equal(geoName({ PLAYGROUND: 'Hove Park' }, { nameField: 'PLAYGROUND' }), 'Hove Park');
console.log('feeds: ok');

// Play area sizes from council grading (scripts/sizes.mjs).
{
  const { gradeOf, sizeValue } = await import('../scripts/sizes.mjs');
  assert.equal(gradeOf('On Ipswich Borough Council\'s list of play areas. A local equipped area for play (LEAP).'), 'medium');
  assert.equal(gradeOf('A local area for play (LAP), for young children.'), 'small');
  assert.equal(gradeOf('A locally equipped area for play, as Chesterfield Borough Council describes it.'), 'medium');
  assert.equal(gradeOf('A NEAP with a LAP for toddlers'), 'large', 'the largest grade wins');
  assert.equal(gradeOf('Take a leap onto the climbing frame, or sit on your lap'), null, 'everyday words are not grades');
  assert.equal(gradeOf('A large park with a playground'), null, 'only council grades count');
  assert.equal(sizeValue('Medium'), 'medium');
  assert.equal(sizeValue('NEAP'), 'large');
  assert.equal(sizeValue(''), null);
}
