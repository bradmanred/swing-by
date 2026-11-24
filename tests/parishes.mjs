// Checks the parish helpers behind the weekly "Parish councils to check" report (scripts/parishes.mjs).
import assert from 'node:assert/strict';
import { inRing, parishFinder, parishKey } from '../scripts/parishes.mjs';

// Names match however they're written: postcodes.io's "St. Neots", OpenStreetMap's "Belper CP", a council's full name.
assert.equal(parishKey('St. Neots'), parishKey('St Neots'));
assert.equal(parishKey('Belper CP'), parishKey('Belper'));
assert.equal(parishKey('Bury St Edmunds Town Council'), parishKey('Bury St. Edmunds'));
assert.equal(parishKey('Brandon & Byshottles'), parishKey('Brandon and Byshottles'));
assert.notEqual(parishKey('West Swindon'), parishKey('South Swindon'));

// A square parish with a square hole (a separate parish inside it), and a neighbour.
const square = (x0, y0, x1, y1) => [x0, y0, x1, y0, x1, y1, x0, y1];
assert.ok(inRing(0.5, 0.5, square(0, 0, 1, 1)));
assert.ok(!inRing(1.5, 0.5, square(0, 0, 1, 1)));
const find = parishFinder([
  { n: 'Outer', k: 'parish', bb: [0, 50, 1, 51], r: [square(0, 50, 1, 51), square(0.4, 50.4, 0.6, 50.6)] },
  { n: 'Inner', k: 'parish', bb: [0.4, 50.4, 0.6, 50.6], r: [square(0.4, 50.4, 0.6, 50.6)] },
  { n: 'Next door', k: 'parish', bb: [1, 50, 2, 51], r: [square(1, 50, 2, 51)] },
  { n: 'A town', k: 'town', bb: [0, 50, 2, 51], r: [square(0, 50, 2, 51)] },
]);
assert.equal(find(0.2, 50.2), 'Outer');
assert.equal(find(0.5, 50.5), 'Inner', 'a point in the hole is in the inner parish, not the outer one');
assert.equal(find(1.5, 50.5), 'Next door');
assert.equal(find(3, 50.5), null, 'outside every parish (towns and places are not parishes)');
console.log('parishes: ok');
