// Checks scripts/check-positions.mjs on made-up playgrounds and a made-up OpenStreetMap list, so nothing real is
// touched and no network is needed. Run by `npm test`.
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let failures = 0;
const fail = (msg) => {
  failures++;
  console.error('✗ ' + msg);
};

// Positions are given in metres north and east of a made-up origin.
const LAT = 53.2;
const LNG = -1.4;
const at = (north, east) => ({
  lat: Math.round((LAT + north / 111195) * 1e5) / 1e5,
  lng: Math.round((LNG + east / (111195 * Math.cos((LAT * Math.PI) / 180))) * 1e5) / 1e5,
});

const dir = await mkdtemp(join(tmpdir(), 'swing-by-positions-'));
const play = join(dir, 'playgrounds');
const out = join(dir, 'reports');
await mkdir(play);
const NC = 'Exact position, age ranges, play equipment, opening hours, toilets and parking.';
const park = (id, name, pos, notConfirmed = NC) =>
  writeFile(
    join(play, `${id}.json`),
    JSON.stringify({ name, region: 'derbyshire', area: 'Testtown', ...pos, ages: [], equipment: [], access: [], facilities: [], opens: '', description: '', nearby: [], sources: [{ label: 'Council', url: 'https://example.org' }], checked: '2026-10-01', notConfirmed, photo: null }, null, 2) + '\n',
  );
const osm = (id, pos, tags = {}) => ({ id, ...pos, tags: { leisure: 'playground', ...tags } });

try {
  // Already on a mapped playground (14 m away): right, so left alone.
  await park('right', 'Rightly Placed Play Area', at(10, 10));
  // 400 m from the mapped playground with the same name: moved onto it.
  await park('wrong', "Queen's Park Play Area", at(-1500, -400));
  // Two pins stacked on one spot, with two unnamed mapped playgrounds 100 m either side: can't tell which is which.
  await park('stack-1', 'Marsh Valley 1', at(2000, 0));
  await park('stack-2', 'Marsh Valley 2', at(2000, 0));
  // Nothing mapped anywhere near.
  await park('lonely', 'Lonely Rec', at(5000, 5000));
  // Its position already came from OpenStreetMap, so it is not checked even though a playground is 400 m away.
  await park('already', 'Already From OSM', at(-3000, 0), 'Exact position (taken from OpenStreetMap), age ranges.');
  // The only mapped playground nearby is private, so it doesn't count.
  await park('private', 'Private Neighbour', at(8000, 0));
  // An approximate pin 200 m from a playground with a matching name: checked, and moved.
  await park('approx', 'Hillside Play Area', at(0, 3000), 'Exact position (approximate, from the street or place name), age ranges.');
  // Pinned from the council's own map: trusted, not checked unless asked for.
  await park('council', 'Council Mapped', at(12000, 0), "Exact position (from the council's map), age ranges.");
  // 400 m from the only mapped playground, which is unnamed: could be a different playground, so a person decides.
  await park('unnamed-far', 'Meadow View', at(15000, 0));
  // 150 m from an unnamed mapped playground: close enough to move without a name.
  await park('unnamed-near', 'Brook Side', at(18000, 0));
  // Placed by hand and listed in pins-checked.json: never checked or moved, though a matching name is 200 m away.
  await park('by-hand', 'Badgers Rec', at(21000, 0));
  // Taken from OpenStreetMap, but sitting on a playground with a different name: flagged when osm pins are checked.
  await park('misnamed', 'Ashgate Play Area', at(24000, 0), 'Exact position (taken from OpenStreetMap), age ranges.');
  await writeFile(join(dir, 'checked.json'), JSON.stringify({ pins: [{ id: 'by-hand' }] }));

  await writeFile(
    join(dir, 'osm.json'),
    JSON.stringify([
      osm('way/1', at(0, 0), { name: 'Rightly Placed Play Area' }),
      osm('way/2', at(-1500, 0), { name: "Queen's Park" }),
      osm('way/3', at(2000, 100)),
      osm('way/4', at(2000, -100)),
      osm('way/5', at(-3000, 400)),
      osm('way/6', at(8000, 100), { access: 'private' }),
      osm('way/7', at(0, 3200), { name: 'Hillside' }),
      osm('way/8', at(12000, 400)),
      osm('way/9', at(15000, 400)),
      osm('way/10', at(18000, 150)),
      osm('way/11', at(21000, 200), { name: 'Badgers Recreation Ground' }),
      osm('way/12', at(24000, 10), { name: 'Hollybank Play Area' }),
    ]),
  );

  const run = (...extra) => execFileSync('node', ['scripts/check-positions.mjs', '--dir', play, '--out', out, '--osm-file', join(dir, 'osm.json'), '--checked', join(dir, 'checked.json'), ...extra], { encoding: 'utf8' });
  const read = async (id) => JSON.parse(await readFile(join(play, `${id}.json`), 'utf8'));
  const statuses = async () => Object.fromEntries(JSON.parse(await readFile(join(out, 'positions.json'), 'utf8')).map((r) => [r.id, r.status]));
  const ids = ['right', 'wrong', 'stack-1', 'stack-2', 'lonely', 'already', 'private', 'approx', 'council', 'unnamed-far', 'unnamed-near', 'by-hand', 'misnamed'];
  const snapshot = async () => JSON.stringify(await Promise.all(ids.map(read)));

  // A report-only run changes nothing.
  const before = await snapshot();
  run();
  if ((await snapshot()) !== before) fail('a report-only run changed a playground file');
  const dry = await statuses();
  if (dry.right !== 'confirmed') fail(`a pin on a mapped playground should be confirmed, got ${dry.right}`);
  if (dry.wrong !== 'move') fail(`a pin 400 m from its mapped playground should move, got ${dry.wrong}`);
  if (dry['stack-1'] !== 'ambiguous' || dry['stack-2'] !== 'ambiguous') fail(`stacked pins between two mapped playgrounds should be ambiguous, got ${dry['stack-1']} and ${dry['stack-2']}`);
  if (dry.lonely !== 'far') fail(`a pin with nothing mapped nearby should be far, got ${dry.lonely}`);
  if (dry.private !== 'far') fail(`a private mapped playground should be ignored, got ${dry.private}`);
  if (dry.approx !== 'move') fail(`an approximate pin should be checked and moved, got ${dry.approx}`);
  if (dry['unnamed-far'] !== 'ambiguous') fail(`a pin 400 m from an unnamed mapped playground should be left to a person, got ${dry['unnamed-far']}`);
  if (dry['unnamed-near'] !== 'move') fail(`a pin 150 m from an unnamed mapped playground should move, got ${dry['unnamed-near']}`);
  if ('already' in dry) fail('a pin that already came from OpenStreetMap should not be checked');
  if ('council' in dry) fail("a pin from the council's own map should not be checked unless asked for");
  if ('by-hand' in dry) fail('a pin placed by hand should never be checked');

  // --fix moves only the clear ones, and says where the position now comes from.
  const origin = { right: await read('right'), stack: await read('stack-1') };
  run('--fix');
  const wrong = await read('wrong');
  const want = at(-1500, 0);
  if (wrong.lat !== want.lat || wrong.lng !== want.lng) fail(`the wrong pin should move onto its mapped playground (${want.lat}, ${want.lng}), got ${wrong.lat}, ${wrong.lng}`);
  if (!/^Exact position \(taken from OpenStreetMap\), age ranges/.test(wrong.notConfirmed)) fail(`a moved pin should say its position is from OpenStreetMap, got: ${wrong.notConfirmed}`);
  const approx = await read('approx');
  if (!/^Exact position \(taken from OpenStreetMap\), age ranges/.test(approx.notConfirmed)) fail(`a moved approximate pin should say its position is from OpenStreetMap, got: ${approx.notConfirmed}`);
  const far = await read('unnamed-far');
  if (far.lat !== at(15000, 0).lat) fail('a pin left to a person must not be moved');
  const stack = await read('stack-1');
  if (stack.lat !== origin.stack.lat || stack.lng !== origin.stack.lng) fail('an ambiguous pin must never be moved');
  const right = await read('right');
  if (right.lat !== origin.right.lat || right.lng !== origin.right.lng) fail('a confirmed pin must not move');
  const council = await read('council');
  if (council.lat !== at(12000, 0).lat) fail("a pin from the council's own map must not move");
  if ((await read('by-hand')).lat !== at(21000, 0).lat) fail('a pin placed by hand must never move');

  // A second run finds the moved pins already done.
  run();
  const again = await statuses();
  if ('wrong' in again || 'approx' in again) fail('a pin that was moved should not be checked again');

  // Asking for the council map pins checks them too.
  run('--include', 'council-map');
  if ((await statuses()).council !== 'ambiguous') fail("--include council-map should check the council-map pin and leave it to a person, as its mapped playground is 400 m away and unnamed");

  // Looking again at OpenStreetMap pins flags one sitting on a differently named playground, and still skips hand-placed ones.
  run('--include', 'osm', '--fix');
  const osmRun = await statuses();
  if (osmRun.misnamed !== 'name') fail(`a pin on a mapped playground with a different name should be flagged, got ${osmRun.misnamed}`);
  if ('by-hand' in osmRun) fail('a pin placed by hand should never be checked, even with --include osm');
  if ((await read('misnamed')).lat !== at(24000, 0).lat) fail('a pin flagged for its name must not move');
} finally {
  await rm(dir, { recursive: true, force: true });
}

if (failures) {
  console.error(`${failures} problem(s) found in the position check`);
  process.exit(1);
}
console.log('Position check passed');
