// Checks scripts/tick-box-apply.mjs, which adds tick boxes from the weekly review without a person: only known
// equipment from descriptions is added, parents' typed-in text is left for the owner, existing and "covered" tick
// boxes aren't added again, toilets and baby change never are, and at most 3 a week. Also checks the three files are
// edited in the right places. Run by `npm test`.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { addTick, plan, KNOWN } from '../scripts/tick-box-apply.mjs';

const labels = await readFile('src/data/labels.json', 'utf8');
const icons = await readFile('src/lib/parks.ts', 'utf8');
const config = await readFile('public/admin/config.yml', 'utf8');

const d = (name, count = 30) => ({ name, from: 'descriptions', count });
const { add, owner } = plan(
  [d('Tunnel'), d('Trim trail', 40), d('Musical play'), d('Climbing wall'), d('Cableway'), d('Springers'), d('Hamster wheel'),
    { name: 'goat', from: 'typed', count: 5, households: 4 }, { name: 'baby changing', from: 'typed', count: 9, households: 9 }],
  labels,
);
assert.deepEqual(add.map((t) => t.name), ['Trim trail', 'Tunnel', 'Musical play'], 'biggest first, at most 3');
assert.ok(owner.some((s) => s.name === 'Climbing wall' && /at most 3/.test(s.why)), 'the fourth waits a week');
assert.ok(owner.some((s) => s.name === 'goat' && /parents/.test(s.why)), 'typed-in text is left for the owner');
assert.ok(owner.some((s) => s.name === 'Hamster wheel' && /no code/.test(s.why)), 'unknown equipment is left for the owner');
assert.ok(![...add, ...owner].some((s) => /Cableway|Springers|baby/i.test(s.name)), 'covered, existing and toilet/baby change items are skipped');

// Codes and names in KNOWN are unique and don't clash with existing tick boxes.
const existing = Object.values(JSON.parse(labels)).flatMap((g) => Object.keys(g));
const ready = Object.values(KNOWN).filter((k) => !k.covered);
assert.equal(new Set(ready.map((k) => k.code)).size, ready.length, 'KNOWN codes are unique');
for (const k of ready) assert.ok(!existing.includes(k.code), `${k.code} is already used in labels.json`);

const out = addTick({ labels, icons, config }, KNOWN['Tunnel']);
assert.equal(JSON.parse(out.labels).equipment.tun, 'Tunnel');
assert.match(out.icons, /\n {2}tun: '🕳️',\n {2}inc:/, 'icon goes before the access icons');
assert.match(out.config, /value: "spn" \}\n(\s+)- \{ label: "Tunnel", value: "tun" \}\n\s+- label: Accessibility/, 'option goes at the end of the equipment list');
const fac = addTick({ labels, icons, config }, { group: 'facilities', code: 'zz', label: 'Test', icon: '🧪' });
assert.match(fac.icons, /tsh: '🛖',\n {2}zz: '🧪',\n\};/, 'facility icons go at the end');
assert.match(fac.config, /- \{ label: "Test", value: "zz" \}/);
console.log('tick-box apply: ok');
