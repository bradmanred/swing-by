// Checks scripts/tick-box-apply.mjs, which adds tick boxes from the weekly review without a person: only known
// equipment from descriptions is added, parents' typed-in text is left for the owner, existing and "covered" tick
// boxes aren't added again, toilets and baby change never are, and at most 3 a week. Also checks the three files are
// edited in the right places. Run by `npm test`.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { addTick, plan, loadCatalogue, findItem } from '../scripts/tick-box-apply.mjs';

const labels = await readFile('src/data/labels.json', 'utf8');
const icons = await readFile('src/lib/parks.ts', 'utf8');
const config = await readFile('public/admin/config.yml', 'utf8');
const catalogue = await loadCatalogue();

const d = (name, count = 30) => ({ name, from: 'descriptions', count });
const { add, owner } = plan(
  [d('Tunnel'), d('Trim trail', 40), d('Musical play'), d('Climbing wall'), d('Cableway'), d('Springers'), d('Hamster wheel'),
    { name: 'goat', from: 'typed', count: 5, households: 4 }, { name: 'baby changing', from: 'typed', count: 9, households: 9 }],
  labels,
  catalogue,
);
assert.deepEqual(add.map((t) => t.name), ['Trim trail', 'Tunnel', 'Musical play'], 'biggest first, at most 3');
assert.ok(owner.some((s) => s.name === 'Climbing wall' && /at most 3/.test(s.why)), 'the fourth waits a week');
assert.ok(owner.some((s) => s.name === 'goat' && /parents/.test(s.why)), 'typed-in text not in the catalogue is left for the owner');
assert.ok(owner.some((s) => s.name === 'Hamster wheel' && /catalogue/.test(s.why)), 'unknown equipment is left for the owner');

// Typed-in text that is one of a catalogue item's words is added as that item, once, and covered items never are.
const typed = plan([{ name: "Spiders web", from: 'typed', count: 4, households: 3 }, d('Climbing net'), { name: 'flying fox', from: 'typed', count: 6, households: 5 }], labels, catalogue);
assert.deepEqual(typed.add.map((t) => t.code), ['net']);
assert.equal(typed.owner.length, 0);
assert.ok(![...add, ...owner].some((s) => /Cableway|Springers|baby/i.test(s.name)), 'covered, existing and toilet/baby change items are skipped');

// The catalogue: codes and icons are unique and don't clash with existing tick boxes, every item has a group, name,
// icon and words, every "covered" item names an existing tick box, and no word belongs to two items.
const L = JSON.parse(labels);
const existing = Object.values(L).flatMap((g) => Object.keys(g));
const tickNames = [...Object.values(L.equipment), ...Object.values(L.access), ...Object.values(L.facilities)];
const usedIcons = [...icons.slice(icons.indexOf('export const ICON'), icons.indexOf('\n};', icons.indexOf('export const ICON'))).matchAll(/'([^']+)'/g)].map((m) => m[1]);
const ready = catalogue.filter((k) => !k.covered);
assert.ok(ready.length >= 30, 'the catalogue has plenty ready');
assert.equal(new Set(ready.map((k) => k.code)).size, ready.length, 'catalogue codes are unique');
assert.equal(new Set(ready.map((k) => k.icon)).size, ready.length, 'catalogue icons are unique');
for (const k of ready) {
  assert.ok(['equipment', 'access', 'facilities'].includes(k.group), `${k.name}: group`);
  assert.match(k.code, /^[a-z]{2,4}$/, `${k.name}: code`);
  assert.ok(k.label && k.icon && k.words?.length, `${k.name}: label, icon and words`);
  assert.ok(!existing.includes(k.code), `${k.code} is already used in labels.json`);
  assert.ok(!usedIcons.includes(k.icon), `${k.name}: icon ${k.icon} is already used in ICON`);
  assert.ok(!/toilet|baby ?chang/i.test(k.name), 'never toilets or baby change');
}
for (const k of catalogue.filter((k) => k.covered)) assert.ok(tickNames.includes(k.covered), `${k.name}: "${k.covered}" isn't a tick box`);
const allWords = catalogue.flatMap((k) => k.words.map((w) => w.toLowerCase()));
assert.equal(new Set(allWords).size, allWords.length, 'no word belongs to two catalogue items');
assert.equal(findItem(catalogue, 'Wendy houses').code, 'ph', 'plurals match');

const out = addTick({ labels, icons, config }, findItem(catalogue, 'Tunnel'));
assert.equal(JSON.parse(out.labels).equipment.tun, 'Tunnel');
assert.match(out.icons, /\n {2}tun: '🕳️',\n {2}inc:/, 'icon goes before the access icons');
assert.match(out.config, /value: "spn" \}\n(\s+)- \{ label: "Tunnel", value: "tun" \}\n\s+- label: Accessibility/, 'option goes at the end of the equipment list');
const fac = addTick({ labels, icons, config }, { group: 'facilities', code: 'zz', label: 'Test', icon: '🧪' });
assert.match(fac.icons, /tsh: '🛖',\n {2}zz: '🧪',\n\};/, 'facility icons go at the end');
assert.match(fac.config, /- \{ label: "Test", value: "zz" \}/);
console.log('tick-box apply: ok');
