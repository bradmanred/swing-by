// Council feed names: a directory's own heading must never be read as a park's name.
import assert from 'node:assert/strict';
import { parseCsv, recordName, slugName } from '../scripts/council-feeds.mjs';

assert.equal(recordName('Church Meadows - Parks and recreation directory'), 'Church Meadows');
assert.equal(recordName('Parks and recreation directory - Church Meadows'), 'Church Meadows');
assert.equal(recordName('Tarnerland'), 'Tarnerland');
assert.equal(slugName('https://www.reigate-banstead.gov.uk/directory_record/1057478/church_meadows'), 'Church Meadows');
assert.equal(slugName('https://www.reigate-banstead.gov.uk/directory_record/1057525/arbutus_road_open_space'), 'Arbutus Road Open Space');
assert.equal(slugName('https://www.braintree.gov.uk/directory-record/100/'), '');
// Council lists copied into src/data/council-lists/ (the "list" feed).
assert.deepEqual(parseCsv('name,postcode,text\nDanson Park Playground,DA6 8HL,"Splash park, open ""May to September"""\n'), [{ name: 'Danson Park Playground', postcode: 'DA6 8HL', text: 'Splash park, open "May to September"' }]);
console.log('feeds: ok');
