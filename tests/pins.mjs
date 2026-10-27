// Checks the "two parents agree" rule for moving pins (worker/pins.js) and the script that moves them
// (scripts/parent-pins.mjs), on made-up playgrounds. No network needed. Run by `npm test`.
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agree, metres } from '../worker/pins.js';

let failures = 0;
const fail = (msg) => {
  failures++;
  console.error('✗ ' + msg);
};

// Positions in metres north and east of a made-up origin.
const LAT = 53.2;
const LNG = -1.4;
const at = (north, east) => ({
  lat: Math.round((LAT + north / 111195) * 1e5) / 1e5,
  lng: Math.round((LNG + east / (111195 * Math.cos((LAT * Math.PI) / 180))) * 1e5) / 1e5,
});
const row = (reporter, conn, pos) => ({ reporter, conn, ...pos });

// One parent is never enough.
if (agree([row('a', '1', at(200, 0))]) !== null) fail('one parent alone should not move a pin');
// Two households within 40 m of each other agree, on the spot between them.
const two = agree([row('a', '1', at(200, 0)), row('b', '2', at(220, 10))]);
if (!two || two.parents !== 2) fail(`two parents near each other should agree, got ${JSON.stringify(two)}`);
else if (metres(two, at(210, 5)) > 3) fail(`the agreed spot should be between the two, got ${two.lat}, ${two.lng}`);
// Two browsers on one internet connection are one household.
if (agree([row('a', '1', at(200, 0)), row('b', '1', at(205, 0))]) !== null) fail('two browsers on the same connection should count once');
// Two parents 300 m apart don't agree.
if (agree([row('a', '1', at(200, 0)), row('b', '2', at(-100, 0))]) !== null) fail('two parents far apart should not agree');
// Two say here, two say elsewhere: a tie, so nothing moves.
if (agree([row('a', '1', at(200, 0)), row('b', '2', at(210, 0)), row('c', '3', at(0, 0)), row('d', '4', at(5, 5))]) !== null)
  fail('a tie between two spots should not move the pin');
// Three say here, one says elsewhere: here wins.
const three = agree([row('a', '1', at(200, 0)), row('b', '2', at(210, 0)), row('c', '3', at(195, 10)), row('d', '4', at(0, 0))]);
if (!three || three.parents !== 3 || metres(three, at(200, 3)) > 10) fail(`three agreeing parents should beat one, got ${JSON.stringify(three)}`);

// The script moves pins parents agree on, and only those.
const dir = await mkdtemp(join(tmpdir(), 'swing-by-pins-'));
const play = join(dir, 'playgrounds');
await mkdir(play);
const park = (id, pos, notConfirmed = 'Exact position (approximate, from the street), age ranges.') =>
  writeFile(join(play, `${id}.json`), JSON.stringify({ name: id, region: 'derbyshire', area: 'Testtown', ...pos, notConfirmed }, null, 2) + '\n');
try {
  await park('wrong', at(0, 0));
  await park('right', at(0, 0));
  await park('far', at(0, 0));
  await writeFile(join(dir, 'checked.json'), JSON.stringify({ pins: [{ id: 'other', checked: '2026-10-01', note: 'by hand' }] }));
  await writeFile(
    join(dir, 'agreed.json'),
    JSON.stringify({
      parks: [
        { park: 'wrong', ...at(150, 0), parents: 2 },
        { park: 'right', ...at(10, 0), parents: 2 },
        { park: 'far', ...at(5000, 0), parents: 3 },
        { park: 'gone', ...at(150, 0), parents: 2 },
      ],
    }),
  );
  const run = (...extra) =>
    execFileSync('node', ['scripts/parent-pins.mjs', '--file', join(dir, 'agreed.json'), '--dir', play, '--checked', join(dir, 'checked.json'), '--out', join(dir, 'out'), ...extra], { encoding: 'utf8' });
  const read = async (id) => JSON.parse(await readFile(join(play, `${id}.json`), 'utf8'));

  run('--dry-run');
  if ((await read('wrong')).lat !== at(0, 0).lat) fail('a dry run should not move anything');

  run();
  const wrong = await read('wrong');
  if (wrong.lat !== at(150, 0).lat || wrong.lng !== at(150, 0).lng) fail(`an agreed pin 150 m away should move, got ${wrong.lat}, ${wrong.lng}`);
  if (wrong.notConfirmed !== 'Age ranges.') fail(`a moved pin should drop "Exact position" from Not confirmed yet, got: ${wrong.notConfirmed}`);
  if ((await read('right')).lat !== at(0, 0).lat) fail('a pin within 30 m of where parents agree should stay put');
  if ((await read('far')).lat !== at(0, 0).lat) fail('a pin more than 1 km from where parents agree should be left for a person');
  const checked = JSON.parse(await readFile(join(dir, 'checked.json'), 'utf8')).pins.map((p) => p.id);
  if (!checked.includes('wrong') || !checked.includes('other') || checked.includes('right')) fail(`only the moved pin should join the hand-checked list, got ${checked}`);
  const report = await readFile(join(dir, 'out', 'parent-pins.md'), 'utf8');
  if (!/1 moved, 2 left for a person/.test(report)) fail(`the report should count 1 moved and 2 left, got: ${report.split('\n')[2]}`);
} finally {
  await rm(dir, { recursive: true, force: true });
}

if (failures) {
  console.error(`${failures} problem(s) found in the pin check`);
  process.exit(1);
}
console.log('Pin check passed');
