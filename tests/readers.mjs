// Checks the council website readers (scripts/council-readers.mjs) on small pages shaped like the real ones.
import assert from 'node:assert/strict';
import { describe, parsePark, point, jaduAZ } from '../scripts/council-readers.mjs';

// A Jadu directory record (Bromley, Hounslow, Greenwich, Rotherham…).
const jadu = `<html><head><title>Alexandra Recreation Ground - Parks in Bromley | London Borough of Bromley</title></head><body>
<nav><a href="/">Home</a> Swings and roundabouts news</nav>
<h1>Alexandra Recreation Ground - Parks in Bromley</h1>
<dl><dt>Description</dt><dd>Park with children's play area and sports facilities.</dd>
<dt>Postcode</dt><dd>SE26 5ND</dd>
<dt>Facilities</dt><dd>Childrens play area, football, toddler swings, zip wire, no toilets</dd></dl>
<input type="hidden" id="map_marker_location_1" value="51.4211495,-0.0515543" />
</body></html>`;
const a = parsePark(jadu, 'https://www.bromley.gov.uk/directory-record/911/alexandra-recreation-ground', {});
assert.equal(a.name, 'Alexandra Recreation Ground');
assert.deepEqual([a.lat, a.lng], [51.4211495, -0.0515543]);
assert.equal(a.postcode, 'SE26 5ND');
assert.deepEqual(a.equipment.sort(), ['bs', 'zw']);
assert.ok(!a.equipment.includes('rb'), 'the navigation bar is not part of the park');
assert.ok(!a.facilities.includes('wc'), '"no toilets" is not toilets');
assert.ok(a.ages.includes('under-3'));

// A Jadu record with no playground is left out, unless it came from a playgrounds category.
const wood = `<h1>Amherst Wood Open Space</h1><dl><dt>Facilities</dt><dd>Woodland walks</dd></dl>`;
assert.equal(parsePark(wood, 'https://www.bromley.gov.uk/directory-record/912/amherst-wood-open-space', {}), null);
assert.equal(parsePark(wood, 'https://www.bromley.gov.uk/directory-record/912/amherst-wood-open-space', {}, true).name, 'Amherst Wood Open Space');

// A record whose heading is just the directory's name takes the park's name from its address.
const heading = `<h1>Parks gardens and open spaces directory</h1><p>Has a playground.</p>`;
assert.equal(parsePark(heading, 'https://www.royalgreenwich.gov.uk/directory_record/3804/abbey_wood_park', {}).name, 'Abbey Wood Park');

// A LocalGov Drupal page (Croydon, Haringey): no map marker input, a "features" point instead, and no postcode.
const lg = `<title>Addington Park | Croydon Council</title><h1>Addington Park</h1>
<h2>Facilities</h2><ul><li>Historic landscape</li><li>Children's playground</li><li>Café</li><li>Sensory garden</li></ul>
<script>{"features":[{"type":"point","lat":51.356226,"lon":-0.037142}]}</script>`;
const b = parsePark(lg, 'https://www.croydon.gov.uk/node/3173/addington-park', {});
assert.equal(b.name, 'Addington Park');
assert.deepEqual([b.lat, b.lng], [51.356226, -0.037142]);
assert.equal(b.postcode, null);
assert.ok(b.facilities.includes('cf'));
assert.ok(b.access.includes('sen'));

// A park with no playground is left out even though the directory's own name ("Parks and playgrounds directory")
// is on every page.
const dirName = `<h1>Parks and playgrounds directory</h1><p>Search Parks and playgrounds directory</p><h1>Ashburton Park</h1><ul><li>Bowling green</li></ul>`;
assert.equal(parsePark(dirName, 'https://www.croydon.gov.uk/node/3173/ashburton-park', {}), null);

// A feed's own "require" and "exclude" rules.
assert.equal(parsePark(lg, 'https://x.gov.uk/p/addington-park', { require: 'splash pad' }), null);
assert.equal(parsePark(lg, 'https://x.gov.uk/p/addington-park', { exclude: '^Addington' }), null);

// Points the wrong way round are swapped; points outside the UK and Ireland are ignored.
assert.deepEqual(point('"type":"point","lat":-0.0371,"lon":51.3562'), { lat: 51.3562, lng: -0.0371 });
assert.equal(point('"type":"point","lat":40.7,"lon":-74.0'), null);

// Wording.
assert.deepEqual(describe('There is a children\'s playground, outdoor gym and tennis courts. Equipment: Cable way; Swing rope seat; See-saw.').equipment.sort(), ['gym', 'ss', 'sw', 'zw']);
assert.deepEqual(describe('A toilet block with baby changing.').facilities.sort(), ['bc', 'wc']);
assert.deepEqual(describe('The nearest toilets are in the library.').facilities, []);
assert.ok(describe('An adventure playground').ages.includes('7-12'));

// A park page with its name only in the title, a "Contact us" link in the menu and the parks office's address at the end
// (Kensington and Chelsea, Barking and Dagenham).
const rbkc = `<html><head><title>Avondale Park &#8211; Royal Borough of Kensington and Chelsea</title></head><body>
<ul><li><a href="/contact">Contact us</a></li></ul>
<h1><span>Local parks and open spaces</span></h1><p>Avondale Park</p><p>Facilities</p><ul><li>two playgrounds: under fives and ages five to 14 years</li></ul>
<p>Some more about the park's history, its trees and its wildlife area, long enough to be most of the page.</p>
<h2>Contact us</h2><p>Parks Service, The Stable Yard, Holland Park, London W8 6LU</p></body></html>`;
const r = parsePark(rbkc, 'https://www.rbkc.gov.uk/parks/your-local-park/avondale-park', { nameFrom: 'title' });
assert.equal(r.name, 'Avondale Park');
assert.equal(r.postcode, null, "the parks office's address is not the park's");
assert.ok(parsePark(rbkc, 'https://x/avondale-park', {}), 'a "Contact us" menu link does not cut the page');

// A Jadu directory's A to Z hangs off its number, with or without the directory's name in the address.
assert.equal(jaduAZ('https://www.edinburgh.gov.uk/directory/10216/play-areas'), 'https://www.edinburgh.gov.uk/directory/10216/a-to-z');
assert.equal(jaduAZ('https://www.bromley.gov.uk/directory/26'), 'https://www.bromley.gov.uk/directory/26/a-to-z');
assert.equal(jaduAZ('https://www.southlanarkshire.gov.uk/directory/150/parks_and_play_areas/'), 'https://www.southlanarkshire.gov.uk/directory/150/a-to-z');
console.log('readers: ok');

// "address": a page with no map point or postcode gives its street for the geocoder (Telford & Wrekin).
const telford = `<h1>Arleston - Windsor Road</h1><table><tr><th>Address</th><td>Adjacent 27 Windsor Road, Arleston</td></tr>
<tr><th>Telephone</th><td>01952 384384</td></tr><tr><th>Overview</th><td>Junior play area<br>Ball court</td></tr></table>`;
const tw = parsePark(telford, 'https://www.telford.gov.uk/online-directories/sports-and-leisure/find-a-playground/arleston-windsor-road/', { allPlay: true, address: 'Address[;:\\s]+([^;]{4,120})' }, true);
assert.equal(tw.where, 'Adjacent 27 Windsor Road, Arleston');
assert.equal(parsePark(telford, 'https://example.gov.uk/x/', {}, true).where, null);
