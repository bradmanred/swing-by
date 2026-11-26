// Checks the page reading in scripts/recheck-sources.mjs (the quarterly re-check that runs without Claude) on made-up
// pages: a page names a playground when all its distinctive words appear (two in three for long names), closure words only count near
// the name, "closed at dusk" isn't a closure, and setting the checked date changes nothing else. Run by `npm test`.
import assert from 'node:assert/strict';
import { assess, flat, nameWords, setChecked, official } from '../scripts/recheck-sources.mjs';

assert.deepEqual(nameWords('Gadebridge Park Play Area'), ['gadebridge']);
assert.deepEqual(nameWords('Play area'), []);

const list = flat(`<h1>Our play areas</h1><ul><li>Gadebridge Park: swings, slides and a zip wire. Gates closed at dusk.</li>
  ${'<li>Somewhere else entirely with lots of words to keep things apart from each other in this list.</li>'.repeat(12)}
  <li>Bennetts End play area is temporarily closed for refurbishment until spring.</li></ul>`);
assert.deepEqual(assess(list, 'Gadebridge Park play area'), { named: true, closure: false }, 'closure elsewhere on the page and "closed at dusk" are ignored');
const b = assess(list, "Bennett's End");
assert.equal(b.closure, true, 'closure near the name counts');
assert.match(b.said, /temporarily closed/, 'and the words are quoted for the report');
assert.equal(assess(list, 'Warners End').named, false, "every distinctive word of a short name must appear");
assert.equal(assess(list, 'Play area').named, false, 'a name with no distinctive words is never confirmed');
assert.equal(assess(flat('<p>Rumsey Fields playground has been vandalised and removed.</p>'), 'Rumsey Fields').closure, true);
assert.equal(assess(flat('<p>The Level playground is being rebuilt and will reopen in spring.</p>'), 'The Level').closure, true);
assert.deepEqual(assess(flat('<script>var closed = true; // Hazel Grove</script><p>Hazel Grove playground: swings.</p>'), 'Hazel Grove'), assess(flat('<p>Hazel Grove playground: swings.</p>'), 'Hazel Grove'), 'scripts are ignored');

const file = '{\n  "name": "X",\n  "lat": 1,\n  "checked": "2024-01-02",\n  "photo": null\n}\n';
assert.equal(setChecked(file, '2027-01-15'), file.replace('2024-01-02', '2027-01-15'));
assert.equal(setChecked(file.replace('"2024-01-02"', 'null'), '2027-01-15'), file.replace('2024-01-02', '2027-01-15'));
assert.equal(JSON.parse(setChecked('{"name":"Y"}', '2027-01-15')).checked, '2027-01-15');

assert.ok(official({ url: 'https://www.dacorum.gov.uk/play' }));
assert.ok(!official({ url: 'https://www.openstreetmap.org/way/1' }));
assert.ok(!official({ url: 'https://www.geograph.org.uk/photo/1' }));
console.log('recheck: ok');
