// Moves playground pins that parents agree are in the wrong place.
//
// Parents can say "the pin is in the wrong place" on any playground page and show where it really is. The Worker
// (worker/pins.js) only counts a spot as agreed once two different households have put it within 40 m of each other,
// and more households agree on it than on anywhere else. This reads those agreed spots and moves each pin:
//   - only if the agreed spot is at least 30 m and at most 1 km from the pin in the playground file
//   - at most --max pins in one run (default 20), so a flood of bad reports can't move the whole map at once
// Each moved pin goes on src/data/pins-checked.json, so the OpenStreetMap position check never moves it back.
//
//   SITE=https://swing-by.co.uk MOD_TOKEN=… node scripts/parent-pins.mjs [--dry-run] [--max 20] [--out reports]
//   node scripts/parent-pins.mjs --file agreed.json      use a saved /api/pins/agreed answer instead (tests)
//
// Run every day by .github/workflows/parent-pins.yml.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const arg = (name, dflt) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : dflt);
const SITE = process.env.SITE || 'https://swing-by.co.uk';
const TOKEN = process.env.MOD_TOKEN?.trim();
const DIR = arg('--dir', 'src/content/playgrounds');
const CHECKED = arg('--checked', 'src/data/pins-checked.json');
const OUT = arg('--out', 'reports');
const FILE = arg('--file', '');
const MAX = Number(arg('--max', 20));
const DRY = process.argv.includes('--dry-run');
const MIN_M = 30;
const MAX_M = 1000;
const today = new Date().toISOString().slice(0, 10);

const stop = (msg) => {
  console.log(`::error title=Move pins parents agree on::${msg}`);
  process.exit(1);
};
const metres = (a, b) => {
  const r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - a.lng) * r) / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(h));
};

let agreed;
if (FILE) agreed = JSON.parse(await readFile(FILE, 'utf8')).parks;
else {
  if (!TOKEN) stop('The MOD_TOKEN secret is missing. Add it under Settings > Secrets and variables > Actions, using the same moderator key as the Worker.');
  const r = await fetch(`${SITE}/api/pins/agreed`, { headers: { Authorization: `Bearer ${TOKEN}`, 'User-Agent': 'SwingBy/1.0 (https://swing-by.co.uk; moves pins parents agree on)' } }).catch(() => null);
  if (!r) stop(`Couldn't reach ${SITE}.`);
  if (r.status === 401) stop("The site didn't accept MOD_TOKEN. Check the GitHub secret matches the MOD_TOKEN secret on the Worker exactly.");
  if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) stop(`${SITE}/api/pins/agreed answered ${r.status}. Has the latest site been deployed, and db/pins.sql been run?`);
  agreed = (await r.json()).parks;
}

const checked = JSON.parse(await readFile(CHECKED, 'utf8').catch(() => '{"pins":[]}'));
const moved = [];
const skipped = [];
for (const a of agreed) {
  if (moved.length >= MAX) {
    skipped.push({ ...a, why: `more than ${MAX} pins to move in one run; it will move next time` });
    continue;
  }
  const file = join(DIR, `${a.park}.json`);
  let doc;
  try {
    doc = JSON.parse(await readFile(file, 'utf8'));
  } catch {
    skipped.push({ ...a, why: 'no playground file with that id' });
    continue;
  }
  const d = Math.round(metres(doc, a));
  if (d < MIN_M) continue; // already where parents say it is
  if (d > MAX_M) {
    skipped.push({ ...a, why: `${d} m from the pin, which is too far to move without a person checking` });
    continue;
  }
  moved.push({ park: a.park, name: doc.name, area: doc.area, from: { lat: doc.lat, lng: doc.lng }, to: { lat: a.lat, lng: a.lng }, metres: d, parents: a.parents });
  if (DRY) continue;
  doc.lat = a.lat;
  doc.lng = a.lng;
  // The position is now confirmed, so it no longer belongs in "Not confirmed yet".
  const nc = String(doc.notConfirmed ?? '').replace(/^Exact position(\s*\([^)]*\))?(, |\. )?/i, '').trim();
  doc.notConfirmed = nc ? nc[0].toUpperCase() + nc.slice(1) : '';
  await writeFile(file, JSON.stringify(doc, null, 2) + '\n');
  checked.pins = checked.pins.filter((p) => p.id !== a.park);
  checked.pins.push({ id: a.park, checked: today, note: `Moved ${d} m after ${a.parents} parents agreed where the playground is.` });
}
if (!DRY && moved.length) {
  checked.pins.sort((x, y) => x.id.localeCompare(y.id));
  await writeFile(CHECKED, JSON.stringify(checked, null, 2) + '\n');
}

const lines = [
  '# Pins moved because parents agreed',
  '',
  `${today}: ${moved.length} ${DRY ? 'would move' : 'moved'}, ${skipped.length} left for a person.`,
];
if (moved.length)
  lines.push('', '| Playground | Moved | Parents | Was | Now |', '| --- | ---: | ---: | --- | --- |',
    ...moved.map((m) => `| [${m.name} (${m.area})](${SITE}/playgrounds/${m.park}/) | ${m.metres} m | ${m.parents} | ${m.from.lat}, ${m.from.lng} | ${m.to.lat}, ${m.to.lng} |`));
if (skipped.length)
  lines.push('', '## Left for a person', '', ...skipped.map((s) => `- ${s.park}: ${s.why} (${s.lat}, ${s.lng}, ${s.parents} parents)`));
await mkdir(OUT, { recursive: true });
await writeFile(join(OUT, 'parent-pins.md'), lines.join('\n') + '\n');
if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n', { flag: 'a' });
console.log(`${DRY ? 'Would move' : 'Moved'} ${moved.length} pins; left ${skipped.length} for a person`);
